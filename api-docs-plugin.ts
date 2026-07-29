import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'rolldown'

interface ApiSymbol {
  name: string | undefined
  kind: 'function' | 'class' | 'interface' | 'type' | 'const'
  jsdoc: string
  signature: string
}

interface ModuleExports {
  [moduleName: string]: ApiSymbol[]
}

const ROOT = path.resolve(import.meta.dirname!)

const ENTRY_POINTS: Record<string, string> = {
  entry: path.join(ROOT, 'src/entry/index.ts'),
  provider: path.join(ROOT, 'src/provider/index.ts'),
  utils: path.join(ROOT, 'src/utils/index.ts'),
  vite: path.join(ROOT, 'src/vite/index.ts'),
}

function resolveRelativeImport(importPath: string, fromDir: string): string | null {
  const extensions = ['.ts', '/index.ts']
  for (const ext of extensions) {
    const full = path.resolve(fromDir, importPath + ext)
    if (fs.existsSync(full)) {
      return full
    }
  }
  return null
}

function followReExports(entryFile: string): string[] {
  const visited = new Set<string>()
  const result: string[] = []
  const queue = [entryFile]

  while (queue.length > 0) {
    const file = queue.shift()!
    const resolved = path.resolve(file)
    if (visited.has(resolved)) {
      continue
    }
    visited.add(resolved)
    result.push(resolved)

    const content = fs.readFileSync(resolved, 'utf-8')
    // Match `export * from`, `export { } from`, `export type * from`, `export type { } from`
    const reExportRegex =
      /export\s+(?:type\s+)?(?:\*\s+from\s+['"]([^'"]+)['"]|\{[^}]*\}\s*from\s+['"]([^'"]+)['"])/g
    let match: RegExpExecArray | null
    while ((match = reExportRegex.exec(content)) !== null) {
      const importPath = match[1] || match[2]
      if (importPath?.startsWith('.')) {
        const resolvedImport = resolveRelativeImport(importPath, path.dirname(resolved))
        if (resolvedImport && !visited.has(resolvedImport)) {
          queue.push(resolvedImport)
        }
      }
    }
  }

  return result
}

function findJSDocBefore(code: string, position: number): string | null {
  // Scan backwards from position, skipping whitespace
  let i = position - 1
  while (i >= 0 && (code[i] === ' ' || code[i] === '\n' || code[i] === '\r' || code[i] === '\t')) {
    i--
  }
  // Check for closing */
  if (i < 1 || code[i] !== '/' || code[i - 1] !== '*') {
    return null
  }
  // Find opening /**
  const end = i + 1
  let start = code.lastIndexOf('/**', end)
  if (start === -1) {
    return null
  }
  // Make sure only whitespace between the comment and the previous non-comment content
  const beforeComment = code.slice(0, start).trimEnd()
  if (beforeComment.endsWith('*/')) {
    return null
  } // Not directly before: there's another comment in between
  const raw = code.slice(start + 3, end - 2)
  // Clean up JSDoc text, preserve line breaks for @example blocks
  const text = raw
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .filter((line) => !line.startsWith('@type'))
    .join('\n')
    .trim()
  return text || null
}

function formatJSDocComment(jsdoc: string): string {
  if (!jsdoc) {
    return ''
  }
  return ['/**', ...jsdoc.split('\n').map((line) => (line ? ` * ${line}` : ' *')), ' */'].join('\n')
}

function getSignatureSource(code: string, exportNode: any): string {
  const decl = exportNode.declaration
  if (!decl) {
    return code.slice(exportNode.start, exportNode.end)
  }

  // For FunctionDeclaration and ClassDeclaration, truncate at body
  if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
    if (decl.body && decl.body.start !== undefined) {
      return `${code.slice(exportNode.start, decl.body.start).trimEnd()} { /* ... */ }`
    }
  }

  return code.slice(exportNode.start, exportNode.end)
}

function extractExports(code: string, ast: any): ApiSymbol[] {
  const symbols: ApiSymbol[] = []

  function processExport(exportNode: any): void {
    const jsdoc = findJSDocBefore(code, exportNode.start)
    if (jsdoc && /(?:^|\s)@deprecated(?:\s|$)/.test(jsdoc)) {
      return
    }

    const decl = exportNode.declaration
    if (!decl) {
      return
    }

    let name: string | undefined
    let kind: ApiSymbol['kind'] = 'function'
    const signature = getSignatureSource(code, exportNode)

    if (decl.type === 'FunctionDeclaration' && decl.id) {
      name = decl.id.name
    } else if (decl.type === 'ClassDeclaration' && decl.id) {
      name = decl.id.name
      kind = 'class'
    } else if (decl.type === 'TSInterfaceDeclaration' && decl.id) {
      name = decl.id.name
      kind = 'interface'
      if (!jsdoc) {
        symbols.push({ name, kind, jsdoc: '', signature })
        return
      }
    } else if (decl.type === 'TSTypeAliasDeclaration' && decl.id) {
      name = decl.id.name
      kind = 'type'
      if (!jsdoc && decl.typeAnnotation?.type === 'TSTypeLiteral') {
        symbols.push({ name, kind: 'interface', jsdoc: '', signature })
        return
      }
    } else if (decl.type === 'VariableDeclaration') {
      for (const varDecl of decl.declarations) {
        if (varDecl.id?.type === 'Identifier') {
          const varSignature = varDecl.init
            ? `export const ${varDecl.id.name} = ${code.slice(varDecl.init.start, varDecl.init.end)}`
            : `export const ${varDecl.id.name}: ${code.slice(varDecl.id.typeAnnotation?.start ?? varDecl.id.end, varDecl.id.typeAnnotation?.end ?? varDecl.id.end)}`
          if (jsdoc) {
            symbols.push({
              name: varDecl.id.name,
              kind: 'const',
              jsdoc,
              signature: varSignature,
            })
          }
        }
      }
      return
    }

    if (name && jsdoc) {
      symbols.push({ name, kind, jsdoc, signature })
    } else if (name && kind === 'type') {
      symbols.push({ name, kind, jsdoc: jsdoc || '', signature })
    }
  }

  function walkNode(node: any): void {
    if (!node || typeof node !== 'object') {
      return
    }

    if (node.type === 'ExportNamedDeclaration' && node.declaration) {
      processExport(node)
    } else if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
      processExport(node)
    }

    for (const key of Object.keys(node)) {
      const child = node[key]
      if (Array.isArray(child)) {
        for (const item of child) {
          walkNode(item)
        }
      } else if (child && typeof child === 'object' && child.type) {
        walkNode(child)
      }
    }
  }

  if (ast?.body && Array.isArray(ast.body)) {
    for (const stmt of ast.body) {
      walkNode(stmt)
    }
  }

  return symbols
}

function generateMarkdownDocs(symbols: ApiSymbol[]): string {
  if (symbols.length === 0) {
    return '_No JSDoc comments found._'
  }

  const lines: string[] = []

  for (const sym of symbols) {
    lines.push(`#### \`${sym.name}\``)
    lines.push('')
    lines.push('```ts')
    if (sym.jsdoc) {
      lines.push(formatJSDocComment(sym.jsdoc))
    }
    lines.push(sym.signature)
    lines.push('```')
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

function updateApiMd(allExports: ModuleExports, apiMdPath: string): void {
  let content = fs.readFileSync(apiMdPath, 'utf-8')

  for (const [module, symbols] of Object.entries(allExports)) {
    const markerStart = `<!-- AUTO-GENERATED:${module.toUpperCase()}:START -->`
    const markerEnd = `<!-- AUTO-GENERATED:${module.toUpperCase()}:END -->`

    const generated = generateMarkdownDocs(symbols)

    const regex = new RegExp(`${escapeRegex(markerStart)}[\\s\\S]*?${escapeRegex(markerEnd)}`, 'g')
    content = content.replace(regex, `${markerStart}\n${generated}\n${markerEnd}`)
  }

  fs.writeFileSync(apiMdPath, content)
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function apiDocsPlugin(): Plugin {
  return {
    name: 'api-docs',
    async buildStart() {
      const allExports: ModuleExports = {}

      for (const [module, entryFile] of Object.entries(ENTRY_POINTS)) {
        const files = followReExports(entryFile)
        const symbols: ApiSymbol[] = []

        for (const file of files) {
          const code = fs.readFileSync(file, 'utf-8')
          try {
            // this.parse is provided by tsdown/rolldown runtime (oxc)
            const ast = this.parse(code, {
              lang: 'ts',
            })
            const fileSymbols = extractExports(code, ast)
            symbols.push(...fileSymbols)
          } catch {
            // Silently skip files that can't be parsed
          }
        }

        allExports[module] = symbols
      }

      const apiMdPath = path.join(ROOT, 'API.md')
      if (fs.existsSync(apiMdPath)) {
        updateApiMd(allExports, apiMdPath)
      }
    },
  }
}
