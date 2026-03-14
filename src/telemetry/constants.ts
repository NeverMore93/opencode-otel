/**
 * Shared constants for opencode-otel.
 *
 * Centralises tracer/logger names, version, and numeric defaults that were
 * previously scattered across multiple files.
 */

import pkg from '../../package.json'

export const TRACER_NAME: string = pkg.name
export const TRACER_VERSION: string = pkg.version
export const LOGGER_NAME: string = pkg.name
export const DEFAULT_MAX_LEN = 256
export const SHUTDOWN_TIMEOUT_MS = 5_000
