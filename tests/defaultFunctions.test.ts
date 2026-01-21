import { describe, expect, it } from 'bun:test'

import { defaultIsLowerVersion } from '../src/utils/version'

describe('compareVersionDefault', () => {
  it('should return true when new version is greater than old version', () => {
    expect(defaultIsLowerVersion('1.0.0', '2.0.0')).toBe(true)
    expect(defaultIsLowerVersion('1.0.0', '1.1.0')).toBe(true)
    expect(defaultIsLowerVersion('1.0.0', '1.0.1')).toBe(true)
    expect(defaultIsLowerVersion('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(true)
    expect(defaultIsLowerVersion('1.0.0-alpha.1', '1.0.0-beta.2')).toBe(true)
    expect(defaultIsLowerVersion('1.0.0-alpha.1', '1.0.0')).toBe(true)
  })

  it('should return false when old version is greater than or equal to new version', () => {
    expect(defaultIsLowerVersion('2.0.0', '1.0.0')).toBe(false)
    expect(defaultIsLowerVersion('1.1.0', '1.0.0')).toBe(false)
    expect(defaultIsLowerVersion('1.0.1', '1.0.0')).toBe(false)
    expect(defaultIsLowerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(defaultIsLowerVersion('0.5.1-beta.0', '0.4.0')).toBe(false)
    expect(defaultIsLowerVersion('1.0.0-beta.12', '1.0.0-alpha.1')).toBe(false)
  })

  it('should throw an error when given an invalid version', () => {
    expect(() => defaultIsLowerVersion('1.0', '1.0.a')).toThrowError()
    expect(() => defaultIsLowerVersion('1.0.0', '')).toThrowError()
    expect(() => defaultIsLowerVersion('1.0.0', '1.0.a')).toThrowError()
    expect(() => defaultIsLowerVersion('1.p.2', '1.0.0')).toThrowError()
    expect(() => defaultIsLowerVersion('1.0.0', 'invalid')).toThrowError()
  })
})
