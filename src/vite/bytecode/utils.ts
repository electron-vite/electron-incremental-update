import * as babel from '@babel/core'
import { getPackageInfoSync } from 'local-pkg'
import cp from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { parseVersion } from '../../utils/version'
import { bytecodeGeneratorScript } from './code'

export const electronModule: {
  version: string | undefined
  rootPath: string
} = getPackageInfoSync('electron')!
export const electronMajorVersion: number = parseVersion(electronModule.version!).major
export const useStrict = "'use strict';"
export const bytecodeModuleLoader = '__loader__.js'

function getElectronPath(): string {
  const electronModulePath = electronModule.rootPath
  let electronExecPath = process.env.ELECTRON_EXEC_PATH || ''
  if (!electronExecPath) {
    if (!electronModulePath) {
      throw new Error('Electron is not installed')
    }
    const pathFile = path.join(electronModulePath, 'path.txt')
    let executablePath
    if (fs.existsSync(pathFile)) {
      executablePath = fs.readFileSync(pathFile, 'utf-8')
    }
    if (executablePath) {
      electronExecPath = path.join(electronModulePath, 'dist', executablePath)
      process.env.ELECTRON_EXEC_PATH = electronExecPath
    } else {
      throw new Error('Electron executable file is not existed')
    }
  }
  return electronExecPath
}
function getBytecodeCompilerPath(): string {
  const scriptPath = path.join(electronModule.rootPath, 'EIU_bytenode.cjs')
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, bytecodeGeneratorScript)
  }
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
  let data = Buffer.from([])

  const bytecodePath = getBytecodeCompilerPath()
  return new Promise<Buffer>((resolve, reject) => {
    const proc = cp.spawn(electronPath, [bytecodePath], {
      env: { ELECTRON_RUN_AS_NODE: '1' } as any,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    })

    if (proc.stdin) {
      proc.stdin.write(code)
      proc.stdin.end()
    }

    if (proc.stdout) {
      proc.stdout.on('data', (chunk) => (data = Buffer.concat([data, chunk])))
      proc.stdout.on('error', (err) => reject(err))
      proc.stdout.on('end', () => resolve(data))
    }

    if (proc.stderr) {
      proc.stderr.on('data', (chunk) => reject(chunk.toString()))
      proc.stderr.on('error', (err) => reject(err))
    }

    proc.addListener('error', (err) => reject(err))

    proc.on('error', (err) => reject(err))
    proc.on('exit', () => resolve(data))
  }).catch((e) => `Failed to generate bytecode of [${name}], ${e}`)
}

export function prepare(code: string, offset?: number): string {
  let hasTransformed = false

  const result = babel.transform(code, {
    plugins: [
      '@babel/plugin-transform-arrow-functions',
      '@babel/plugin-transform-template-literals',
      () => ({
        visitor: {
          StringLiteral(path: any) {
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
              const obfuscated = obfuscateString(node.value, offset)
              path.parentPath.node.computed = true
              path.replaceWith(babel.types.identifier(obfuscated))
              hasTransformed = true
              return
            }

            if (parent.type === 'ObjectProperty' && parent.key === node) {
              const obfuscated = obfuscateString(node.value, offset)
              path.parentPath.node.computed = true
              path.replaceWith(babel.types.identifier(obfuscated))
              hasTransformed = true
              return
            }
            if (!node.value.trim()) {
              return
            }
            path.replaceWith(babel.types.identifier(obfuscateString(node.value, offset)))
            hasTransformed = true
          },
        },
      }),
    ],
  })

  const transformedCode = result?.code || code

  return hasTransformed ? `${transformedCode}\n${decodeFn}` : transformedCode
}

export const decodeFn =
  ';function _0xstr_(a,b){return String.fromCharCode.apply(0,a.map(function(x){return x-b}))};'
export function obfuscateString(
  input: string,
  offset: number = ~~(Math.random() * 16) + 1,
): string {
  const hexArray = input.split('').map((c) => `0x${(c.charCodeAt(0) + offset).toString(16)}`)
  return `_0xstr_([${hexArray.join(',')}],${offset})`
}
