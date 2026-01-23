/* eslint-disable no-template-curly-in-string */
/* eslint-disable no-eval */
import { describe, expect, it } from 'bun:test'

import {
  convertArrowFunctionAndTemplate,
  convertLiteral,
  decodeFn,
  obfuscateString,
} from '../src/vite/bytecode/utils'

function testObfuscate(str: string) {
  expect(eval(decodeFn + obfuscateString(str))).toBe(str)
}

describe('obfuscate', () => {
  it('obfuscate normal', () => {
    testObfuscate('hello world')
  })

  it('obfuscate escape', () => {
    testObfuscate('\\\{}\'"`')
  })
})

describe('arrow to function', () => {
  it('convert normal', () => {
    const code = 'const test = () => `hello ${1} world`'
    expect(convertArrowFunctionAndTemplate(code).code).toMatchInlineSnapshot(`
      "const test = function () {
        return "hello ".concat(1, " world");
      };"
    `)
  })
  it('convert template tag', () => {
    const code = 'sql`select * from ${table}`'
    expect(convertArrowFunctionAndTemplate(code).code).toMatchInlineSnapshot(`
      "var _templateObject;
      function _taggedTemplateLiteral(e, t) { return t || (t = e.slice(0)), Object.freeze(Object.defineProperties(e, { raw: { value: Object.freeze(t) } })); }
      sql(_templateObject || (_templateObject = _taggedTemplateLiteral(["select * from ", ""])), table);"
    `)
  })
  it('convert multiple line template tag', () => {
    const code = `\`
    no new version for $\{test}
    \``
    expect(convertArrowFunctionAndTemplate(code).code).toMatchInlineSnapshot(
      `""\\n    no new version for ".concat(test, "\\n    ");"`,
    )
  })
})

describe('convert', () => {
  it('convert normal', () => {
    const code = 'const test = "hello world";test'
    const result = convertLiteral(code, false, 4).code
    expect(result).toMatchInlineSnapshot(`
      "const test = _0xstr_([0x6c,0x69,0x70,0x70,0x73,0x24,0x7b,0x73,0x76,0x70,0x68],4);test
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
    expect(eval(result)).toBe('hello world')
  })

  it('convert escape', () => {
    const code = `const test = '\\\\{}\\'"\`';test`
    const result = convertLiteral(code, false, 4).code
    expect(result).toMatchInlineSnapshot(`
      "const test = _0xstr_([0x60,0x7f,0x81,0x2b,0x26,0x64],4);test
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
    expect(eval(result)).toBe('\\{}\'"`')
  })

  it('convert export variable', () => {
    const code = `export const test = 'hello world';`
    const result = convertLiteral(code, false, 4).code
    expect(result).toMatchInlineSnapshot(`
      "export const test = _0xstr_([0x6c,0x69,0x70,0x70,0x73,0x24,0x7b,0x73,0x76,0x70,0x68],4);
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
      `)
  })

  it('convert string key', () => {
    const code = `const test = {
  'test': 1,
  zxc(a = 1) { console.log(a) },
  "asd"() { },
  "qwe": function() { }
}`
    const result = convertLiteral(code, false, 4).code
    expect(result).toMatchInlineSnapshot(`
      "const test = {
        [_0xstr_([0x78,0x69,0x77,0x78],4)]: 1,
        zxc(a = 1) { console.log(a) },
        "asd"() { },
        [_0xstr_([0x75,0x7b,0x69],4)]: function() { }
      }
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })

  it('skip convert import', () => {
    const code = `import test from 'test';`
    const result = convertLiteral(code, false, 4).code
    expect(result).toMatchInlineSnapshot(`"import test from 'test';"`)
  })

  it('skip convert inline import', () => {
    const code = `const data = await import('./test');`
    const result = convertLiteral(code, false, 4).code
    expect(result).toMatchInlineSnapshot(`"const data = await import('./test');"`)
  })

  it('skip convert require', () => {
    const code = `const data = require('./test');`
    const result = convertLiteral(code, false, 4).code
    expect(result).toMatchInlineSnapshot(`"const data = require('./test');"`)
  })

  it('skip convert export path', () => {
    const code = `export * from 'test';`
    const result = convertLiteral(code, false, 4).code
    expect(result).toMatchInlineSnapshot(`"export * from 'test';"`)
  })

  it('skip convert default export ', () => {
    const code = `var a = 1;export default a`
    const result = convertLiteral(code, false, 4).code
    expect(result).toMatchInlineSnapshot(`"var a = 1;export default a"`)
  })

  it('skip convert all export', () => {
    const code = `export * as b from 'test';`
    const result = convertLiteral(code, false, 4).code
    expect(result).toMatchInlineSnapshot(`"export * as b from 'test';"`)
  })

  it('skip convert member export', () => {
    const code = `export {c} from 'test';`
    const result = convertLiteral(code, false, 4).code
    expect(result).toMatchInlineSnapshot(`"export {c} from 'test';"`)
  })
})
