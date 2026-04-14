/**
 * Provider setup — LoggerProvider + TracerProvider with BAT-aware resource resolution.
 *
 * TracerProvider is minimal: only used to create session root spans for
 * log-to-session correlation (traceId). No detailed message/tool spans.
 */

import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPLogExporter as GrpcLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc'
import { OTLPLogExporter as HttpLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPTraceExporter as GrpcTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { envDetector, resourceFromAttributes } from '@opentelemetry/resources'
import { Metadata } from '@grpc/grpc-js'
import type { Tracer } from '@opentelemetry/api'
import type { Logger } from '@opentelemetry/api-logs'
import type {
  BatRuntimeMetadata,
  IdentitySource,
  OtelConfig,
  OtelProtocol,
} from './config.ts'
import { INSTRUMENTATION_VERSION } from './version.ts'

const TRACKED_RESOURCE_KEYS = new Set<string>([
  'service.name',
  'group.id',
  'idc',
  'bu.code',
  'cloud.availability_zone',
  'cloud.region',
  'host.ip',
  'host.name',
])

type ResourceSource = 'resource-attributes' | IdentitySource | 'runtime'

export interface SignalRoute {
  readonly signal: 'logs' | 'traces'
  readonly enabled: boolean
  readonly endpoint: string | undefined
  readonly protocol: OtelProtocol | 'grpc'
  readonly timeoutMs: number | undefined
}

export interface ProviderResult {
  readonly loggerProvider: LoggerProvider
  readonly tracerProvider: BasicTracerProvider
  readonly logger: Logger
  readonly tracer: Tracer
  readonly warnings: readonly string[]
  readonly resourceAttributes: Readonly<Record<string, string>>
  readonly routes: Readonly<{
    logs: SignalRoute
    traces: SignalRoute
  }>
}

interface AttributeCandidate {
  readonly attribute: string
  readonly source: ResourceSource
  readonly label: string
  readonly value: string
}

function grpcMetadata(headers: Record<string, string>): Metadata {
  const metadata = new Metadata()
  for (const [key, value] of Object.entries(headers)) {
    metadata.set(key, value)
  }
  return metadata
}

function normalizeDetectedAttributes(attributes: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      normalized[key] = value.join(',')
      continue
    }
    normalized[key] = String(value)
  }
  return normalized
}

function getServiceNameLabel(source: IdentitySource): string {
  switch (source) {
    case 'env':
      return 'OTEL_SERVICE_NAME'
    case 'config-file':
      return 'otel.json serviceName'
    case 'default':
      return 'default service name'
  }
}

function runtimeCandidates(runtime: BatRuntimeMetadata): AttributeCandidate[] {
  const candidates: AttributeCandidate[] = []
  if (runtime.appId) {
    candidates.push({
      attribute: 'service.name',
      source: 'runtime',
      label: 'PAAS_APP_APPID',
      value: runtime.appId,
    })
  }
  if (runtime.groupId) {
    candidates.push({
      attribute: 'group.id',
      source: 'runtime',
      label: 'PAAS_APP_GROUPID',
      value: runtime.groupId,
    })
  }
  if (runtime.idc) {
    candidates.push({
      attribute: 'idc',
      source: 'runtime',
      label: 'CDOS_IDC',
      value: runtime.idc,
    })
  }
  if (runtime.buCode) {
    candidates.push({
      attribute: 'bu.code',
      source: 'runtime',
      label: 'CDOS_BUCODE',
      value: runtime.buCode,
    })
  }
  if (runtime.availabilityZone) {
    candidates.push({
      attribute: 'cloud.availability_zone',
      source: 'runtime',
      label: 'CDOS_AZ',
      value: runtime.availabilityZone,
    })
  }
  if (runtime.region) {
    candidates.push({
      attribute: 'cloud.region',
      source: 'runtime',
      label: 'CDOS_REGION',
      value: runtime.region,
    })
  }
  if (runtime.hostIp) {
    candidates.push({
      attribute: 'host.ip',
      source: 'runtime',
      label: 'CDOS_POD_IP',
      value: runtime.hostIp,
    })
  }
  if (runtime.hostName) {
    candidates.push({
      attribute: 'host.name',
      source: 'runtime',
      label: 'HOSTNAME',
      value: runtime.hostName,
    })
  }
  return candidates
}

function createServiceNameCandidates(config: OtelConfig): AttributeCandidate[] {
  const explicitServiceName = config.explicitResourceAttributes['service.name']
  const runtimeServiceName = config.runtimeMetadata.appId
  const serviceCandidates: AttributeCandidate[] = []

  if (explicitServiceName) {
    serviceCandidates.push({
      attribute: 'service.name',
      source: 'resource-attributes',
      label: 'OTEL_RESOURCE_ATTRIBUTES',
      value: explicitServiceName,
    })
  }

  if (config.serviceNameSource !== 'default') {
    serviceCandidates.push({
      attribute: 'service.name',
      source: config.serviceNameSource,
      label: getServiceNameLabel(config.serviceNameSource),
      value: config.serviceName,
    })
  }

  if (runtimeServiceName) {
    serviceCandidates.push({
      attribute: 'service.name',
      source: 'runtime',
      label: 'PAAS_APP_APPID',
      value: runtimeServiceName,
    })
  }

  if (config.serviceNameSource === 'default') {
    serviceCandidates.push({
      attribute: 'service.name',
      source: 'default',
      label: getServiceNameLabel(config.serviceNameSource),
      value: config.serviceName,
    })
  }

  return serviceCandidates
}

function resolveAttribute(
  attribute: string,
  candidates: AttributeCandidate[],
  warnings: string[],
): string | undefined {
  const chosen = candidates[0]
  if (!chosen) return undefined

  for (const rejected of candidates.slice(1)) {
    if (rejected.value === chosen.value) continue
    warnings.push(
      `${attribute} resolved to "${chosen.value}" from ${chosen.label}; ignoring "${rejected.value}" from ${rejected.label}`,
    )
  }

  return chosen.value
}

export function resolveSignalRoutes(config: OtelConfig): {
  logs: SignalRoute
  traces: SignalRoute
} {
  return {
    logs: Object.freeze({
      signal: 'logs',
      enabled: config.logsEndpoint !== undefined,
      endpoint: config.logsEndpoint,
      protocol: config.logsProtocol,
      timeoutMs: config.timeoutMs,
    }),
    traces: Object.freeze({
      signal: 'traces',
      enabled: config.tracesEndpoint !== undefined,
      endpoint: config.tracesEndpoint,
      protocol: config.tracesProtocol,
      timeoutMs: config.timeoutMs,
    }),
  }
}

export function resolveResourceAttributes(
  config: OtelConfig,
  detectedAttributes = envDetector.detect().attributes as Record<string, unknown>,
): {
  attributes: Readonly<Record<string, string>>
  warnings: readonly string[]
} {
  const warnings: string[] = []
  const normalizedDetected = normalizeDetectedAttributes(detectedAttributes)
  const resourceAttributes: Record<string, string> = {}

  for (const [key, value] of Object.entries(normalizedDetected)) {
    if (!TRACKED_RESOURCE_KEYS.has(key)) {
      resourceAttributes[key] = value
    }
  }

  for (const [key, value] of Object.entries(config.explicitResourceAttributes)) {
    resourceAttributes[key] = value
  }

  const runtimeByAttribute = new Map<string, AttributeCandidate>(
    runtimeCandidates(config.runtimeMetadata).map((candidate) => [candidate.attribute, candidate]),
  )

  const serviceName = resolveAttribute('service.name', createServiceNameCandidates(config), warnings)
  if (serviceName) {
    resourceAttributes['service.name'] = serviceName
  }

  const trackedKeys = [
    'group.id',
    'idc',
    'bu.code',
    'cloud.availability_zone',
    'cloud.region',
    'host.ip',
    'host.name',
  ] as const

  for (const key of trackedKeys) {
    const explicitValue = config.explicitResourceAttributes[key]
    const candidates: AttributeCandidate[] = []
    if (explicitValue) {
      candidates.push({
        attribute: key,
        source: 'resource-attributes',
        label: 'OTEL_RESOURCE_ATTRIBUTES',
        value: explicitValue,
      })
    }

    const runtimeCandidate = runtimeByAttribute.get(key)
    if (runtimeCandidate) {
      candidates.push(runtimeCandidate)
    }

    const value = resolveAttribute(key, candidates, warnings)
    if (value) {
      resourceAttributes[key] = value
    }
  }

  return {
    attributes: Object.freeze(resourceAttributes),
    warnings,
  }
}

export function initProviders(config: OtelConfig): ProviderResult {
  const routes = resolveSignalRoutes(config)
  const resourceResolution = resolveResourceAttributes(config)
  const resource = resourceFromAttributes(resourceResolution.attributes)
  const hasHeaders = Object.keys(config.headers).length > 0
  const metadata = hasHeaders ? grpcMetadata({ ...config.headers }) : undefined
  const logProcessors: BatchLogRecordProcessor[] = []
  if (routes.logs.enabled && config.logsEndpoint) {
    const logExporter = config.logsProtocol === 'grpc'
      ? new GrpcLogExporter({
          url: config.logsEndpoint,
          metadata,
          timeoutMillis: config.timeoutMs,
        })
      : new HttpLogExporter({
          url: config.logsEndpoint,
          headers: hasHeaders ? { ...config.headers } : undefined,
          timeoutMillis: config.timeoutMs,
        })

    logProcessors.push(new BatchLogRecordProcessor(logExporter))
  }

  const loggerProvider = new LoggerProvider({ resource, processors: logProcessors })
  const logger = loggerProvider.getLogger('opencode-otel', INSTRUMENTATION_VERSION)

  const spanProcessors: import('@opentelemetry/sdk-trace-base').SpanProcessor[] = []
  if (routes.traces.enabled && config.tracesEndpoint) {
    const traceExporter = new GrpcTraceExporter({
      url: config.tracesEndpoint,
      metadata,
      timeoutMillis: config.timeoutMs,
    })
    spanProcessors.push(new BatchSpanProcessor(traceExporter))
  }

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors,
  })
  const tracer = tracerProvider.getTracer('opencode-otel', INSTRUMENTATION_VERSION)

  return {
    loggerProvider,
    tracerProvider,
    logger,
    tracer,
    warnings: resourceResolution.warnings,
    resourceAttributes: resourceResolution.attributes,
    routes: Object.freeze({
      logs: routes.logs,
      traces: routes.traces,
    }),
  }
}
