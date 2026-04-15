import { createRequire } from 'node:module'

interface PackageManifest {
  readonly version: string
}

function readPackageVersion(): string {
  const require = createRequire(import.meta.url)
  const packageManifest = require('../package.json') as PackageManifest

  return packageManifest.version
}

export const INSTRUMENTATION_VERSION = readPackageVersion()
