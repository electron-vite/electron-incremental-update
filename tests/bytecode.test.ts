/* eslint-disable no-template-curly-in-string */
/* eslint-disable no-eval */
import { describe, expect, it } from 'bun:test'

import { prepare, decodeFn, obfuscateString } from '../src/vite/bytecode/utils'

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

describe('combined transformations', () => {
  it('convert arrow function, template, and literal in single pass', () => {
    const code = 'const test = () => `hello ${name} ${"world"}`'
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "const test = function () {
        return _0xstr_([0x6c,0x69,0x70,0x70,0x73,0x24],4).concat(name, " ", _0xstr_([0x7b,0x73,0x76,0x70,0x68],4));
      };
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })

  it('convert nested arrow functions with literals', () => {
    const code = `
      const outer = (a) => {
        const inner = (b) => \`result: \${b}\`
        return inner(a + "suffix")
      }
    `
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "const outer = function (a) {
        const inner = function (b) {
          return _0xstr_([0x76,0x69,0x77,0x79,0x70,0x78,0x3e,0x24],4).concat(b);
        };
        return inner(a + _0xstr_([0x77,0x79,0x6a,0x6a,0x6d,0x7c],4));
      };
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })

  it('convert multiple literals in different contexts', () => {
    const code = `
      const message = "hello";
      const func = () => {
        return "world" + "!";
      };
      const obj = { "key": "value" };
    `
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "const message = _0xstr_([0x6c,0x69,0x70,0x70,0x73],4);
      const func = function () {
        return _0xstr_([0x7b,0x73,0x76,0x70,0x68],4) + _0xstr_([0x25],4);
      };
      const obj = {
        _0xstr_([0x6f,0x69,0x7d],4): _0xstr_([0x7a,0x65,0x70,0x79,0x69],4)
      };
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })

  it('convert complex template expressions', () => {
    const code = 'const test = () => `prefix ${a + b} middle ${c} suffix ${"literal"}`'
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "const test = function () {
        return _0xstr_([0x74,0x76,0x69,0x6a,0x6d,0x7c,0x24],4).concat(a + b, _0xstr_([0x24,0x71,0x6d,0x68,0x68,0x70,0x69,0x24],4)).concat(c, _0xstr_([0x24,0x77,0x79,0x6a,0x6a,0x6d,0x7c,0x24],4), _0xstr_([0x70,0x6d,0x78,0x69,0x76,0x65,0x70],4));
      };
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })

  it('skip import and require strings', () => {
    const code = `
      import "test1";
      const mod = require("test2");
      const dynamic = import("test3");
    `
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "import "test1";
      const mod = require("test2");
      const dynamic = import("test3");"
    `)
  })

  it('skip export strings', () => {
    const code = `
      export const a = "value";
      export * from "module";
      export { b } from "module2";
      export default "default";
    `
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "export const a = _0xstr_([0x7a,0x65,0x70,0x79,0x69],4);
      export * from "module";
      export { b } from "module2";
      export default "default";
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })

  it('handle empty strings', () => {
    const code = 'const empty = ""; const test = () => `${""}`'
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "const empty = "";
      const test = function () {
        return "";
      };"
    `)
  })

  it('handle special characters in strings', () => {
    const code = "const test = () => `escaped: \\\\t\\\\n ${'special'} 'quote'`"
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "const test = function () {
        return _0xstr_([0x69,0x77,0x67,0x65,0x74,0x69,0x68,0x3e,0x24,0x60,0x78,0x60,0x72,0x24],4).concat(_0xstr_([0x77,0x74,0x69,0x67,0x6d,0x65,0x70],4), _0xstr_([0x24,0x2b,0x75,0x79,0x73,0x78,0x69,0x2b],4));
      };
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })

  it('convert with sourcemap', () => {
    const code = 'const test = () => `hello ${name}`'
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "const test = function () {
        return _0xstr_([0x6c,0x69,0x70,0x70,0x73,0x24],4).concat(name);
      };
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })

  it('preserve object method keys', () => {
    const code = `
      const obj = {
        "method"() { return "value" },
        "key": "value",
        async "asyncMethod"() {}
      }
    `
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "const obj = {
        "method"() {
          return _0xstr_([0x7a,0x65,0x70,0x79,0x69],4);
        },
        _0xstr_([0x6f,0x69,0x7d],4): _0xstr_([0x7a,0x65,0x70,0x79,0x69],4),
        async "asyncMethod"() {}
      };
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })

  it('handle custom offset parameter', () => {
    const code = 'const test = () => `hello ${"world"}`'
    const result1 = prepare(code, 1)
    const result2 = prepare(code, 10)
    expect(result1).toMatchInlineSnapshot(`
      "const test = function () {
        return _0xstr_([0x69,0x66,0x6d,0x6d,0x70,0x21],1).concat(_0xstr_([0x78,0x70,0x73,0x6d,0x65],1));
      };
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
    expect(result2).toMatchInlineSnapshot(`
      "const test = function () {
        return _0xstr_([0x72,0x6f,0x76,0x76,0x79,0x2a],10).concat(_0xstr_([0x81,0x79,0x7c,0x76,0x6e],10));
      };
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })

  it('convert multiple consecutive transformations', () => {
    const code = `
      const arr = ["a", "b", "c"].map(x => \`item: \${x}\`)
      const func = (n) => \`number: \${n} ${'end'}\`
    `
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "const arr = [_0xstr_([0x65],4), _0xstr_([0x66],4), _0xstr_([0x67],4)].map(function (x) {
        return _0xstr_([0x6d,0x78,0x69,0x71,0x3e,0x24],4).concat(x);
      });
      const func = function (n) {
        return _0xstr_([0x72,0x79,0x71,0x66,0x69,0x76,0x3e,0x24],4).concat(n, _0xstr_([0x24,0x69,0x72,0x68],4));
      };
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })

  it('convert with no transformations returns original', () => {
    const code = 'const test = 123'
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`"const test = 123;"`)
  })

  it('convert template tags with literals', () => {
    const code = 'const html = () => html`<div class="${"active"}">${content}</div>`'
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "var _templateObject;
      function _taggedTemplateLiteral(e, t) { return t || (t = e.slice(0)), Object.freeze(Object.defineProperties(e, { raw: { value: Object.freeze(t) } })); }
      const html = function () {
        return html(_templateObject || (_templateObject = _taggedTemplateLiteral([_0xstr_([0x40,0x68,0x6d,0x7a,0x24,0x67,0x70,0x65,0x77,0x77,0x41,0x26],4), _0xstr_([0x26,0x42],4), _0xstr_([0x40,0x33,0x68,0x6d,0x7a,0x42],4)])), _0xstr_([0x65,0x67,0x78,0x6d,0x7a,0x69],4), content);
      };
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })

  it('convert computed property names with literals', () => {
    const code = 'const obj = { ["computed" + "key"]: () => "value" }'
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "const obj = {
        [_0xstr_([0x67,0x73,0x71,0x74,0x79,0x78,0x69,0x68],4) + _0xstr_([0x6f,0x69,0x7d],4)]: function () {
          return _0xstr_([0x7a,0x65,0x70,0x79,0x69],4);
        }
      };
      ;function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};"
    `)
  })
})
