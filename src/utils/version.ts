export interface Version {
  /**
   * `4` of `4.3.2-beta.1`
   */
  major: number
  /**
   * `3` of `4.3.2-beta.1`
   */
  minor: number
  /**
   * `2` of `4.3.2-beta.1`
   */
  patch: number
  /**
   * `beta` of `4.3.2-beta.1`
   */
  stage: string
  /**
   * `1` of `4.3.2-beta.1`
   */
  stageVersion: number
}

interface PrereleaseIdentifier {
  raw: string
  numeric: number | undefined
}

const REG_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z0-9]+)(?:\.(\d+))?)?$/i
/**
 * Parse version string to {@link Version}, like `0.2.0-beta.1`
 * @param version version string
 */
export function parseVersion(version: string): Version {
  const match = REG_VERSION.exec(version)
  if (!match) {
    throw new TypeError(`invalid version: ${version}`)
  }
  const [major, minor, patch] = match.slice(1, 4).map(Number)
  const ret = {
    major,
    minor,
    patch,
    stage: '',
    stageVersion: -1,
  }
  if (match[4]) {
    ret.stage = match[4]
    ret.stageVersion = match[5] === undefined ? -1 : Number(match[5])
  }
  if (
    Number.isNaN(major) ||
    Number.isNaN(minor) ||
    Number.isNaN(patch) ||
    Number.isNaN(ret.stageVersion)
  ) {
    throw new TypeError(`Invalid version: ${version}`)
  }
  return ret as Version
}

function parsePrerelease(version: Version): PrereleaseIdentifier[] {
  if (!version.stage) {
    return []
  }

  return [version.stage, version.stageVersion === -1 ? undefined : String(version.stageVersion)]
    .filter((value): value is string => value !== undefined)
    .flatMap((value) => value.split('.'))
    .map((raw) => {
      const numeric = /^\d+$/.test(raw) ? Number(raw) : undefined
      return { raw, numeric }
    })
}

function comparePrerelease(oldV: Version, newV: Version): boolean {
  const oldParts = parsePrerelease(oldV)
  const newParts = parsePrerelease(newV)

  if (oldParts.length === 0 || newParts.length === 0) {
    return oldParts.length > 0 && newParts.length === 0
  }

  const length = Math.max(oldParts.length, newParts.length)
  for (let i = 0; i < length; i++) {
    const oldPart = oldParts[i]
    const newPart = newParts[i]

    if (!oldPart) {
      return true
    }
    if (!newPart) {
      return false
    }
    if (oldPart.raw === newPart.raw) {
      continue
    }
    if (oldPart.numeric !== undefined && newPart.numeric !== undefined) {
      return oldPart.numeric < newPart.numeric
    }
    if (oldPart.numeric !== undefined) {
      return true
    }
    if (newPart.numeric !== undefined) {
      return false
    }
    return oldPart.raw < newPart.raw
  }

  return false
}

/**
 * Default function to check the old version is less than new version
 * @param oldVer old version string
 * @param newVer new version string
 */
export function defaultIsLowerVersion(oldVer: string, newVer: string): boolean {
  const oldV = parseVersion(oldVer)
  const newV = parseVersion(newVer)

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (oldV[key] !== newV[key]) {
      return oldV[key] < newV[key]
    }
  }

  return comparePrerelease(oldV, newV)
}

/**
 * Update info json
 */
export interface UpdateInfo {
  /**
   * Update Asar signature
   */
  signature: string
  /**
   * Minimum version
   */
  minimumVersion: string
  /**
   * Target version
   */
  version: string
}

/**
 * {@link UpdateInfo} with beta
 */
export type UpdateJSON = UpdateInfo & {
  /**
   * Beta update info
   */
  beta: UpdateInfo
}

const is = (j: any): boolean => !!(j && j.minimumVersion && j.signature && j.version)

/**
 * Check is `UpdateJSON`
 * @param json any variable
 */
export function isUpdateJSON(json: object): json is UpdateJSON {
  return json && is(json) && is((json as any).beta)
}

/**
 * Default function to generate `UpdateJSON`
 * @param existingJson exising update json
 * @param signature sigature
 * @param version target version
 * @param minimumVersion minimum version
 */
export function defaultVersionJsonGenerator(
  existingJson: UpdateJSON,
  signature: string,
  version: string,
  minimumVersion: string,
): UpdateJSON {
  existingJson.beta = {
    version,
    minimumVersion,
    signature,
  }
  if (!parseVersion(version).stage) {
    existingJson.version = version
    existingJson.minimumVersion = minimumVersion
    existingJson.signature = signature
  }

  return existingJson
}
