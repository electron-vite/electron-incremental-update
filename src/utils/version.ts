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

/**
 * Parse version string to {@link Version}, like `0.2.0-beta.1`
 * @param version version string
 */
export function parseVersion(version: string): Version {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z0-9.-]+))?/i.exec(version)
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
    let [stage, _v] = match[4].split('.')
    ret.stage = stage
    ret.stageVersion = Number(_v) || -1
  }
  if (
    Number.isNaN(major) ||
    Number.isNaN(minor) ||
    Number.isNaN(patch) ||
    Number.isNaN(ret.stageVersion)
  ) {
    throw new TypeError(`Invalid version: ${version}`)
  }
  return ret
}

function compareStrings(str1: string, str2: string): boolean {
  if (str1 === '') {
    return str2 !== ''
  } else if (str2 === '') {
    return true
  }
  return str1 < str2
}

/**
 * Default function to check the old version is less than new version
 * @param oldVer old version string
 * @param newVer new version string
 */
export function defaultIsLowerVersion(oldVer: string, newVer: string): boolean {
  const oldV = parseVersion(oldVer)
  const newV = parseVersion(newVer)

  for (let key of Object.keys(oldV) as Extract<keyof Version, string>[]) {
    if (key === 'stage' && compareStrings(oldV[key], newV[key])) {
      return true
    } else if (oldV[key] !== newV[key]) {
      return oldV[key] < newV[key]
    }
  }

  return false
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
