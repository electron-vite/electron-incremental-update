import cp from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import * as babel from '@babel/core'

import { bytecodeGeneratorScript } from './code'

export const useStrict = "'use strict';"
export const bytecodeModuleLoader = '__loader__.js'

async function resolvePaths(
  customPath: string | undefined,
): Promise<{ electronPath: string; bytecodePath: string }> {
  if (!customPath || !process.__electron_path) {
    process.__electron_path = (await import('electron')).default as unknown as string
  }

  if (!process.__bytecode_compiler_path) {
    process.__bytecode_compiler_path = path.join(
      path.dirname(process.__electron_path),
      'EIU_bytenode.cjs',
    )
  }
  if (!fs.existsSync(process.__bytecode_compiler_path)) {
    fs.writeFileSync(process.__bytecode_compiler_path, bytecodeGeneratorScript)
  }
  return {
    electronPath: customPath || process.__electron_path,
    bytecodePath: process.__bytecode_compiler_path,
  }
}

export async function compileToBytecode(
  code: string,
  name: string,
  customElectronPath?: string,
): Promise<Buffer | string> {
  try {
    const { bytecodePath, electronPath } = await resolvePaths(customElectronPath)
    return await new Promise<Buffer>((resolve, reject) => {
      const proc = cp.spawn(electronPath!, [bytecodePath], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      })
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []

      if (proc.stdin) {
        proc.stdin.write(code)
        proc.stdin.end()
      }

      if (proc.stdout) {
        proc.stdout
          .on('data', (chunk_2) => stdoutChunks.push(chunk_2))
          .on('error', (err) => reject(err))
      }

      if (proc.stderr) {
        proc.stderr
          .on('data', (chunk_3) => stderrChunks.push(chunk_3))
          .on('error', (err_1) => reject(err_1))
      }

      proc.on('error', (err_2) => reject(err_2))

      proc.on('close', (exitCode) => {
        if (exitCode !== 0 || stderrChunks.length > 0) {
          const errorMessage = Buffer.concat(stderrChunks).toString('utf-8')
          reject(
            new Error(
              `Bytecode generation process exited with code ${exitCode}. Error: ${errorMessage}`,
            ),
          )
          return
        }

        resolve(Buffer.concat(stdoutChunks))
      })
    })
  } catch (e) {
    return `Failed to generate bytecode of [${name}], ${e}`
  }
}

interface ObfuscateState {
  hasTransformed?: boolean
}

export interface PrepareContext {
  requireRewrites: Record<string, string>
  hasRequireRewrites: boolean
}

export const decodeFn =
  ';function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};'

const decodeFnBody = babel.parse(decodeFn)?.program.body ?? []

function createObfuscatedStringCall(input: string, offset?: number): babel.types.CallExpression {
  const resolvedOffset = offset ?? ~~(Math.random() * 16) + 1
  const elements = input.split('').map((char) => {
    const value = char.codePointAt(0)! + resolvedOffset
    const node = babel.types.numericLiteral(value)
    node.extra = {
      raw: `0x${value.toString(16)}`,
      rawValue: value,
    }
    return node
  })

  return babel.types.callExpression(babel.types.identifier('_0xstr_'), [
    babel.types.arrayExpression(elements),
    babel.types.numericLiteral(resolvedOffset),
  ])
}

export function createPrepareContext(bytecodeFileNames: string[]): PrepareContext {
  const requireRewrites: Record<string, string> = {}

  for (const fileName of bytecodeFileNames) {
    if (!fileName.endsWith('.js')) {
      continue
    }

    const baseName = path.posix.basename(fileName)
    requireRewrites[baseName] = baseName.replace(/\.js$/, '.jsc')
  }

  return {
    requireRewrites,
    hasRequireRewrites: Object.keys(requireRewrites).length > 0,
  }
}

function rewriteRequirePath(
  requirePath: string,
  requireRewrites: Record<string, string>,
): string | undefined {
  const baseName = path.posix.basename(requirePath)
  const newBaseName = requireRewrites[baseName]

  if (!newBaseName) {
    return
  }

  return `${requirePath.slice(0, -baseName.length)}${newBaseName}`
}

function rewriteSimpleRequireCalls(code: string, requireRewrites: Record<string, string>): string {
  if (!code.includes('require(')) {
    return code
  }

  return code.replace(
    /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g,
    (match, quote: string, requirePath: string) => {
      const newRequirePath = rewriteRequirePath(requirePath, requireRewrites)
      return newRequirePath ? `require(${quote}${newRequirePath}${quote})` : match
    },
  )
}

function obfuscateStringsPlugin(
  _: unknown,
  options: { offset?: number },
): babel.PluginObj<ObfuscateState> {
  return {
    visitor: {
      StringLiteral(path: babel.NodePath<babel.types.StringLiteral>, state: ObfuscateState) {
        const parent = path.parent
        const node = path.node

        if (parent.type === 'CallExpression') {
          if (parent.callee.type === 'Identifier' && parent.callee.name === 'require') {
            return
          }
          if (parent.callee.type === 'Import') {
            return
          }
        }

        if (parent.type.startsWith('Export')) {
          return
        }

        if (parent.type.startsWith('Import')) {
          return
        }

        if (parent.type === 'ObjectMethod' && parent.key === node) {
          parent.computed = true
          path.replaceWith(createObfuscatedStringCall(node.value, options.offset))
          state.hasTransformed = true
          return
        }

        if (parent.type === 'ObjectProperty' && parent.key === node) {
          parent.computed = true
          path.replaceWith(createObfuscatedStringCall(node.value, options.offset))
          state.hasTransformed = true
          return
        }

        if (!node.value.trim()) {
          return
        }

        path.replaceWith(createObfuscatedStringCall(node.value, options.offset))
        state.hasTransformed = true
      },
      Program: {
        exit(path: babel.NodePath<babel.types.Program>, state: ObfuscateState) {
          if (!state.hasTransformed) {
            return
          }

          path.unshiftContainer(
            'body',
            decodeFnBody.map((node) => babel.types.cloneNode(node)),
          )
        },
      },
    },
  }
}

function rewriteRequirePlugin(
  _: unknown,
  options: { requireRewrites: Record<string, string> },
): babel.PluginObj {
  return {
    visitor: {
      CallExpression(path: babel.NodePath<babel.types.CallExpression>) {
        if (
          !babel.types.isIdentifier(path.node.callee, { name: 'require' }) ||
          path.node.arguments.length === 0
        ) {
          return
        }

        const arg = path.node.arguments[0]
        if (!babel.types.isStringLiteral(arg)) {
          return
        }

        const newRequirePath = rewriteRequirePath(arg.value, options.requireRewrites)

        if (newRequirePath) {
          path.node.arguments[0] = babel.types.stringLiteral(newRequirePath)
        }
      },
    },
  }
}

export function prepare(
  code: string,
  minify: boolean,
  context: PrepareContext,
  offset?: number,
): babel.BabelFileResult | null {
  if (!code.includes('"') && !code.includes("'") && !code.includes('`') && !code.includes('=>')) {
    return { code }
  }

  if (context.hasRequireRewrites && !code.includes('`') && !code.includes('=>')) {
    const codeWithoutSimpleRequires = code.replace(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g, '')

    if (!codeWithoutSimpleRequires.includes('"') && !codeWithoutSimpleRequires.includes("'")) {
      return { code: rewriteSimpleRequireCalls(code, context.requireRewrites) }
    }
  }

  return babel.transform(code, {
    minified: minify,
    plugins: [
      '@babel/plugin-transform-arrow-functions',
      '@babel/plugin-transform-template-literals',
      [obfuscateStringsPlugin, { offset }],
      [rewriteRequirePlugin, { requireRewrites: context.requireRewrites }],
    ],
  })
}

export function obfuscateString(
  input: string,
  offset: number = ~~(Math.random() * 16) + 1,
): string {
  const hexArray = input.split('').map((c) => `0x${(c.codePointAt(0)! + offset).toString(16)}`)
  return `_0xstr_([${hexArray.join(',')}],${offset})`
}
