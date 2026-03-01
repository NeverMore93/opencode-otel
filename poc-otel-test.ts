/**
 * POC: Verify OpenTelemetry JS SDK works in Bun runtime
 * Run: bun run poc-otel-test.ts
 */

import { trace, SpanStatusCode, context } from "@opentelemetry/api"
import { BasicTracerProvider, SimpleSpanProcessor, InMemorySpanExporter, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"

console.log("=== POC: Bun + OpenTelemetry SDK Compatibility Test ===\n")

const results: Array<{ test: string; pass: boolean }> = []

// Test 1: TracerProvider + InMemoryExporter
console.log("[Test 1] Creating TracerProvider with InMemorySpanExporter...")
let provider: BasicTracerProvider
let inMemoryExporter: InMemorySpanExporter
try {
  inMemoryExporter = new InMemorySpanExporter()
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(inMemoryExporter)],
  })
  console.log("[Test 1] PASS")
  results.push({ test: "TracerProvider creation", pass: true })
} catch (e) {
  console.error("[Test 1] FAIL -", e)
  results.push({ test: "TracerProvider creation", pass: false })
  process.exit(1)
}

// Test 2: Create span with attributes and events
console.log("\n[Test 2] Creating span with attributes and events...")
try {
  const tracer = provider.getTracer("opencode-bat", "0.0.1")
  const span = tracer.startSpan("test-session-event", {
    attributes: {
      "opencode.session.id": "test-session-123",
      "opencode.event.type": "message.updated",
      "opencode.app.id": "100071240",
    },
  })
  span.addEvent("message.received", { "message.type": "user" })
  span.setStatus({ code: SpanStatusCode.OK })
  span.end()

  const spans = inMemoryExporter.getFinishedSpans()
  if (spans.length === 1 && spans[0].name === "test-session-event") {
    console.log("[Test 2] PASS")
    console.log("  Name:", spans[0].name)
    console.log("  Attributes:", JSON.stringify(spans[0].attributes))
    console.log("  Events:", spans[0].events.length)
    console.log("  TraceID:", spans[0].spanContext().traceId)
    results.push({ test: "Span creation + attributes + events", pass: true })
  } else {
    throw new Error(`Expected 1 span, got ${spans.length}`)
  }
} catch (e) {
  console.error("[Test 2] FAIL -", e)
  results.push({ test: "Span creation + attributes + events", pass: false })
}

// Test 3: Nested spans (parent-child)
console.log("\n[Test 3] Nested spans (session -> message -> tool)...")
try {
  inMemoryExporter.reset()
  const tracer = provider.getTracer("opencode-bat", "0.0.1")

  const sessionSpan = tracer.startSpan("session")
  const sessionCtx = trace.setSpan(context.active(), sessionSpan)

  const messageSpan = tracer.startSpan("chat.message", { attributes: { "message.role": "user" } }, sessionCtx)
  messageSpan.end()

  const toolSpan = tracer.startSpan("tool.execute", { attributes: { "tool.name": "bash" } }, sessionCtx)
  toolSpan.end()

  sessionSpan.end()

  const spans = inMemoryExporter.getFinishedSpans()
  const hasParent = spans.filter(s => s.parentSpanId).length === 2
  if (spans.length === 3 && hasParent) {
    console.log("[Test 3] PASS -", spans.length, "spans with parent-child relationships")
    for (const s of spans) {
      console.log(`  ${s.name}: parent=${s.parentSpanId?.slice(0, 8) ?? "root"}`)
    }
    results.push({ test: "Nested spans (parent-child)", pass: true })
  } else {
    throw new Error(`Expected 3 spans with 2 having parents`)
  }
} catch (e) {
  console.error("[Test 3] FAIL -", e)
  results.push({ test: "Nested spans (parent-child)", pass: false })
}

// Test 4: OTLP HTTP Exporter instantiation
console.log("\n[Test 4] OTLPTraceExporter (HTTP) instantiation...")
try {
  const otlpExporter = new OTLPTraceExporter({
    url: "http://bat-otel-collector.fx.ctripcorp.com:8080/v1/traces",
  })
  console.log("[Test 4] PASS - OTLPTraceExporter created")
  results.push({ test: "OTLP HTTP Exporter instantiation", pass: true })
} catch (e) {
  console.error("[Test 4] FAIL -", e)
  results.push({ test: "OTLP HTTP Exporter instantiation", pass: false })
}

// Test 5: ConsoleSpanExporter
console.log("\n[Test 5] ConsoleSpanExporter output...")
try {
  const consoleProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
  })
  const tracer = consoleProvider.getTracer("console-test")
  const span = tracer.startSpan("bun-console-test")
  span.setAttribute("runtime", "bun")
  span.end()
  console.log("[Test 5] PASS")
  results.push({ test: "ConsoleSpanExporter", pass: true })
} catch (e) {
  console.error("[Test 5] FAIL -", e)
  results.push({ test: "ConsoleSpanExporter", pass: false })
}

// Test 6: Env var reading
console.log("\n[Test 6] OTEL environment variables...")
const envVars = ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", "OTEL_SERVICE_NAME"]
for (const v of envVars) {
  console.log(`  ${v}: ${process.env[v] ?? "(not set)"}`)
}
console.log("[Test 6] PASS")
results.push({ test: "Env var reading", pass: true })

// Summary
console.log("\n=== POC Summary ===")
const passed = results.filter(r => r.pass).length
const total = results.length
console.log(`Results: ${passed}/${total} tests passed\n`)
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"} - ${r.test}`)
}
console.log(`\nConclusion: ${passed === total ? "Path A (OTEL plugin) is FEASIBLE in Bun!" : "Some tests failed - investigate before proceeding."}`)
