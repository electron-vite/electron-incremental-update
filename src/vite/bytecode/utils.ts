import cp from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import * as babel from '@babel/core'
import { getPackageInfoSync } from 'local-pkg'

import { parseVersion } from '../../utils/version'

import { bytecodeGeneratorScript } from './code'

interface ElectronModuleInfo {
  version: string | undefined
  rootPath: string
}

let cachedElectronModule: ElectronModuleInfo | undefined
let cachedElectronMajorVersion: number | undefined
let cachedElectronPath: string | undefined
let cachedBytecodeCompilerPath: string | undefined

export const useStrict = "'use strict';"
export const bytecodeModuleLoader = '__loader__.js'

export function getElectronModule(): ElectronModuleInfo {
  if (!cachedElectronModule) {
    const electronModule = getPackageInfoSync('electron')
    if (!electronModule) {
      throw new Error('Electron does not installed')
    }
    cachedElectronModule = {
      version: electronModule.version,
      rootPath: electronModule.rootPath,
    }
  }

  return cachedElectronModule
}

export function getElectronMajorVersion(): number {
  if (cachedElectronMajorVersion === undefined) {
    cachedElectronMajorVersion = parseVersion(getElectronModule().version ?? '0.0.0').major
  }

  return cachedElectronMajorVersion
}

function getElectronPath(): string {
  if (cachedElectronPath) {
    return cachedElectronPath
  }

  const electronModulePath = getElectronModule().rootPath
  let electronExecPath = process.env.ELECTRON_EXEC_PATH || ''
  if (!electronExecPath) {
    const pathFile = path.join(electronModulePath, 'path.txt')
    let executablePath
    if (fs.existsSync(pathFile)) {
      executablePath = fs.readFileSync(pathFile, 'utf-8').trim()
    }
    if (executablePath) {
      electronExecPath = path.join(electronModulePath, 'dist', executablePath)
      process.env.ELECTRON_EXEC_PATH = electronExecPath
    } else {
      throw new Error('Electron executable file does not exist')
    }
  }

  cachedElectronPath = electronExecPath
  return electronExecPath
}
function getBytecodeCompilerPath(): string {
  if (cachedBytecodeCompilerPath) {
    return cachedBytecodeCompilerPath
  }

  const scriptPath = path.join(getElectronModule().rootPath, 'EIU_bytenode.cjs')
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, bytecodeGeneratorScript)
  }
  cachedBytecodeCompilerPath = scriptPath
  return scriptPath
}
export function toRelativePath(filename: string, importer: string): string {
  const relPath = path.posix.relative(path.dirname(importer), filename)
  return relPath.startsWith('.') ? relPath : `./${relPath}`
}

export function compileToBytecode(
  code: string,
  name: string,
  electronPath: string = getElectronPath(),
): Promise<Buffer | string> {
  const bytecodePath = getBytecodeCompilerPath()
  return new Promise<Buffer>((resolve, reject) => {
    const proc = cp.spawn(electronPath, [bytecodePath], {
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
      proc.stdout.on('data', (chunk) => stdoutChunks.push(chunk)).on('error', (err) => reject(err))
    }

    if (proc.stderr) {
      proc.stderr.on('data', (chunk) => stderrChunks.push(chunk)).on('error', (err) => reject(err))
    }

    proc.on('error', (err) => reject(err))

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
  }).catch((e) => `Failed to generate bytecode of [${name}], ${e}`)
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
