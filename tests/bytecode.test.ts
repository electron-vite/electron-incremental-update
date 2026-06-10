/* eslint-disable no-template-curly-in-string */
/* eslint-disable no-eval */
import { describe, expect, it } from 'bun:test'

import {
  prepare as pluginPrepare,
  createPrepareContext,
  decodeFn,
  obfuscateString,
} from '../src/vite/bytecode/utils'

function testObfuscate(str: string) {
  expect(eval(decodeFn + obfuscateString(str))).toBe(str)
}

function prepare(code: string, offset: number) {
  return pluginPrepare(code, false, createPrepareContext([]), offset)?.code
}

function prepareWithFiles(code: string, bytecodeFileNames: string[]) {
  return pluginPrepare(code, false, createPrepareContext(bytecodeFileNames), 4)?.code
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
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const test = function () {
        return _0xstr_([0x6c, 0x69, 0x70, 0x70, 0x73, 0x24], 4)[_0xstr_([0x67, 0x73, 0x72, 0x67, 0x65, 0x78], 4)](name, " ", _0xstr_([0x7b, 0x73, 0x76, 0x70, 0x68], 4));
      };"
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
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const outer = function (a) {
        const inner = function (b) {
          return _0xstr_([0x76, 0x69, 0x77, 0x79, 0x70, 0x78, 0x3e, 0x24], 4)[_0xstr_([0x67, 0x73, 0x72, 0x67, 0x65, 0x78], 4)](b);
        };
        return inner(a + _0xstr_([0x77, 0x79, 0x6a, 0x6a, 0x6d, 0x7c], 4));
      };"
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
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const message = _0xstr_([0x6c, 0x69, 0x70, 0x70, 0x73], 4);
      const func = function () {
        return _0xstr_([0x7b, 0x73, 0x76, 0x70, 0x68], 4) + _0xstr_([0x25], 4);
      };
      const obj = {
        [_0xstr_([0x6f, 0x69, 0x7d], 4)]: _0xstr_([0x7a, 0x65, 0x70, 0x79, 0x69], 4)
      };"
    `)
  })

  it('convert complex template expressions', () => {
    const code = 'const test = () => `prefix ${a + b} middle ${c} suffix ${"literal"}`'
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const test = function () {
        return _0xstr_([0x74, 0x76, 0x69, 0x6a, 0x6d, 0x7c, 0x24], 4)[_0xstr_([0x67, 0x73, 0x72, 0x67, 0x65, 0x78], 4)](a + b, _0xstr_([0x24, 0x71, 0x6d, 0x68, 0x68, 0x70, 0x69, 0x24], 4))[_0xstr_([0x67, 0x73, 0x72, 0x67, 0x65, 0x78], 4)](c, _0xstr_([0x24, 0x77, 0x79, 0x6a, 0x6a, 0x6d, 0x7c, 0x24], 4), _0xstr_([0x70, 0x6d, 0x78, 0x69, 0x76, 0x65, 0x70], 4));
      };"
    `)
  })

  it('skip import and require strings', () => {
    const code = `
      import "test1";
      const mod = require("test2");
      const dynamic = import("test3");
    `
    const result = prepare(code, 4)
    expect(result).not.toContain('_0xstr_')
    expect(result).toContain('import "test1"')
    expect(result).toContain('require("test2")')
    expect(result).toContain('import("test3")')
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
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      export const a = _0xstr_([0x7a, 0x65, 0x70, 0x79, 0x69], 4);
      export * from "module";
      export { b } from "module2";
      export default "default";"
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
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const test = function () {
        return _0xstr_([0x69, 0x77, 0x67, 0x65, 0x74, 0x69, 0x68, 0x3e, 0x24, 0x60, 0x78, 0x60, 0x72, 0x24], 4)[_0xstr_([0x67, 0x73, 0x72, 0x67, 0x65, 0x78], 4)](_0xstr_([0x77, 0x74, 0x69, 0x67, 0x6d, 0x65, 0x70], 4), _0xstr_([0x24, 0x2b, 0x75, 0x79, 0x73, 0x78, 0x69, 0x2b], 4));
      };"
    `)
  })

  it('convert with sourcemap', () => {
    const code = 'const test = () => `hello ${name}`'
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const test = function () {
        return _0xstr_([0x6c, 0x69, 0x70, 0x70, 0x73, 0x24], 4)[_0xstr_([0x67, 0x73, 0x72, 0x67, 0x65, 0x78], 4)](name);
      };"
    `)
  })

  it('convert object method keys', () => {
    const code = `
      const obj = {
        "method"() { return "value" },
        async "asyncMethod"() {}
      }
    `
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const obj = {
        [_0xstr_([0x71, 0x69, 0x78, 0x6c, 0x73, 0x68], 4)]() {
          return _0xstr_([0x7a, 0x65, 0x70, 0x79, 0x69], 4);
        },
        async [_0xstr_([0x65, 0x77, 0x7d, 0x72, 0x67, 0x51, 0x69, 0x78, 0x6c, 0x73, 0x68], 4)]() {}
      };"
    `)
  })

  it('handle custom offset parameter', () => {
    const code = 'const test = () => `hello ${"world"}`'
    const result1 = prepare(code, 1)
    const result2 = prepare(code, 10)
    expect(result1).toMatchInlineSnapshot(`
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const test = function () {
        return _0xstr_([0x69, 0x66, 0x6d, 0x6d, 0x70, 0x21], 1)[_0xstr_([0x64, 0x70, 0x6f, 0x64, 0x62, 0x75], 1)](_0xstr_([0x78, 0x70, 0x73, 0x6d, 0x65], 1));
      };"
    `)
    expect(result2).toMatchInlineSnapshot(`
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const test = function () {
        return _0xstr_([0x72, 0x6f, 0x76, 0x76, 0x79, 0x2a], 10)[_0xstr_([0x6d, 0x79, 0x78, 0x6d, 0x6b, 0x7e], 10)](_0xstr_([0x81, 0x79, 0x7c, 0x76, 0x6e], 10));
      };"
    `)
  })

  it('convert multiple consecutive transformations', () => {
    const code = `
      const arr = ["a", "b", "c"].map(x => \`item: \${x}\`)
      const func = (n) => \`number: \${n} ${'end'}\`
    `
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const arr = [_0xstr_([0x65], 4), _0xstr_([0x66], 4), _0xstr_([0x67], 4)][_0xstr_([0x71, 0x65, 0x74], 4)](function (x) {
        return _0xstr_([0x6d, 0x78, 0x69, 0x71, 0x3e, 0x24], 4)[_0xstr_([0x67, 0x73, 0x72, 0x67, 0x65, 0x78], 4)](x);
      });
      const func = function (n) {
        return _0xstr_([0x72, 0x79, 0x71, 0x66, 0x69, 0x76, 0x3e, 0x24], 4)[_0xstr_([0x67, 0x73, 0x72, 0x67, 0x65, 0x78], 4)](n, _0xstr_([0x24, 0x69, 0x72, 0x68], 4));
      };"
    `)
  })

  it('convert with no transformations returns original', () => {
    const code = 'const test = 123'
    const result = prepare(code, 4)
    expect(result).toBe(code)
  })

  it('convert member expression properties to obfuscated bracket notation', () => {
    const code = 'a.run(); const value = service.client.name'
    const result = prepare(code, 4)

    expect(result).toMatchInlineSnapshot(`
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      a[_0xstr_([0x76, 0x79, 0x72], 4)]();
      const value = service[_0xstr_([0x67, 0x70, 0x6d, 0x69, 0x72, 0x78], 4)][_0xstr_([0x72, 0x65, 0x71, 0x69], 4)];"
    `)
  })

  it('convert optional member expression properties to obfuscated bracket notation', () => {
    const code = 'const value = api?.client?.run?.()'
    const result = prepare(code, 4)

    expect(result).toMatchInlineSnapshot(`
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const value = api?.[_0xstr_([0x67, 0x70, 0x6d, 0x69, 0x72, 0x78], 4)]?.[_0xstr_([0x76, 0x79, 0x72], 4)]?.();"
    `)
  })

  it('obfuscate object definition identifier keys', () => {
    const code = 'run({ thisisalongprops: 1, short: 2 })'
    const result = prepare(code, 4)

    expect(result).toMatchInlineSnapshot(`
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      run({
        [_0xstr_([0x78, 0x6c, 0x6d, 0x77, 0x6d, 0x77, 0x65, 0x70, 0x73, 0x72, 0x6b, 0x74, 0x76, 0x73, 0x74, 0x77], 4)]: 1,
        [_0xstr_([0x77, 0x6c, 0x73, 0x76, 0x78], 4)]: 2
      });"
    `)
  })

  it('keep special and shorthand object definition keys unchanged', () => {
    const code = 'const value = 1; const obj = { value, __proto__: null }'
    const result = prepare(code, 4)

    expect(result).toMatchInlineSnapshot(`
      "const value = 1;
      const obj = {
        value,
        __proto__: null
      };"
    `)
  })

  it('rewrite require only without injecting decoder', () => {
    const code = 'const mod = require("./chunk.js")'
    const result = prepareWithFiles(code, ['chunk.js'])

    expect(result).toMatchInlineSnapshot(`"const mod = require("./chunk.jsc")"`)
  })

  it('rewrite cjs require only without injecting decoder', () => {
    const code = 'const mod = require("./chunk.cjs")'
    const result = prepareWithFiles(code, ['chunk.cjs'])

    expect(result).toMatchInlineSnapshot(`"const mod = require("./chunk.cjsc")"`)
  })

  it('keep require unchanged when prepare context has no rewrite target', () => {
    const code = 'const mod = require("./chunk.js")'
    const result = prepareWithFiles(code, [])

    expect(result).toContain('require("./chunk.js")')
    expect(result).not.toContain('_0xstr_')
  })

  it('rewrite target require paths during babel transform', () => {
    const code = 'const mod = require("./chunk.js"); const name = "value"'
    const result = prepareWithFiles(code, ['chunk.js'])

    expect(result).toMatchInlineSnapshot(`
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const mod = require("./chunk.jsc");
      const name = _0xstr_([0x7a, 0x65, 0x70, 0x79, 0x69], 4);"
    `)
  })

  it('convert template tags with literals', () => {
    const code = 'const html = () => html`<div class="${"active"}">${content}</div>`'
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      "var _templateObject;
      ;
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      function _taggedTemplateLiteral(e, t) { return t || (t = e[_0xstr_([0x77, 0x70, 0x6d, 0x67, 0x69], 4)](0)), Object[_0xstr_([0x6a, 0x76, 0x69, 0x69, 0x7e, 0x69], 4)](Object[_0xstr_([0x68, 0x69, 0x6a, 0x6d, 0x72, 0x69, 0x54, 0x76, 0x73, 0x74, 0x69, 0x76, 0x78, 0x6d, 0x69, 0x77], 4)](e, { [_0xstr_([0x76, 0x65, 0x7b], 4)]: { [_0xstr_([0x7a, 0x65, 0x70, 0x79, 0x69], 4)]: Object[_0xstr_([0x6a, 0x76, 0x69, 0x69, 0x7e, 0x69], 4)](t) } })); }
      const html = function () {
        return html(_templateObject || (_templateObject = _taggedTemplateLiteral([_0xstr_([0x40, 0x68, 0x6d, 0x7a, 0x24, 0x67, 0x70, 0x65, 0x77, 0x77, 0x41, 0x26], 4), _0xstr_([0x26, 0x42], 4), _0xstr_([0x40, 0x33, 0x68, 0x6d, 0x7a, 0x42], 4)])), _0xstr_([0x65, 0x67, 0x78, 0x6d, 0x7a, 0x69], 4), content);
      };"
    `)
  })

  it('convert computed property names with literals', () => {
    const code = 'const obj = { ["computed" + "key"]: () => "value" }'
    const result = prepare(code, 4)
    expect(result).toMatchInlineSnapshot(`
      ";
      function _0xstr_(a, b) {
        return String.fromCharCode.apply(0, a.map(function (x) {
          return x - b;
        }));
      }
      ;
      const obj = {
        [_0xstr_([0x67, 0x73, 0x71, 0x74, 0x79, 0x78, 0x69, 0x68], 4) + _0xstr_([0x6f, 0x69, 0x7d], 4)]: function () {
          return _0xstr_([0x7a, 0x65, 0x70, 0x79, 0x69], 4);
        }
      };"
    `)
  })
})
