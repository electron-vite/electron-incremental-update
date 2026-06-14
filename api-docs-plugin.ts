import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'rolldown'

interface MemberProp {
  name: string
  type?: string
  jsdoc: string
  optional: boolean
  defaultValue?: string
}

interface ApiSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'const'
  jsdoc: string
  signature: string
  paramTypes?: Record<string, string>
  members?: MemberProp[]
  extendsTypes?: string[]
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

interface FormattedJSDoc {
  description: string
  example: string | null
}

function formatInlineTags(text: string): string {
  // Convert {@link Target} to [\`Target\`](#target)
  return text.replace(/\{@link\s+([^}]+)\}/g, (_, target) => {
    const slug = target.trim().toLowerCase()
    return `[\`${target.trim()}\`](#${slug})`
  })
}

function formatJSDoc(raw: string, paramTypes?: Record<string, string>): FormattedJSDoc {
  const parts: string[] = []
  const params: { name: string; type?: string; desc: string }[] = []
  let example: string | null = null
  let remaining = raw

  // Extract the main description (everything before the first @tag), keep line breaks
  const firstTag = remaining.search(/@\w+/)
  if (firstTag > 0) {
    parts.push(
      formatInlineTags(
        remaining
          .slice(0, firstTag)
          .replace(/\n{2,}/g, '\n')
          .trim(),
      ),
    )
    remaining = remaining.slice(firstTag)
  } else if (firstTag === -1) {
    return {
      description: formatInlineTags(remaining.replace(/\n{2,}/g, '\n').trim()),
      example: null,
    }
  }

  // Extract @param, @example, @returns, @default, etc. (not @link — inline tag)
  const tags = remaining.split(/(?=\s*@(?!link)\w+)/g)
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (!trimmed) {
      continue
    }
    if (trimmed.startsWith('@example')) {
      example = trimmed.replace(/^@example\s*/, '').trim()
    } else if (trimmed.startsWith('@param')) {
      const content = trimmed.replace(/^@param\s*/, '')
      const spaceIdx = content.indexOf(' ')
      const name = spaceIdx > 0 ? content.slice(0, spaceIdx) : content
      const desc =
        spaceIdx > 0
          ? formatInlineTags(
              content
                .slice(spaceIdx + 1)
                .replace(/\n/g, ' ')
                .replace(/^-\s*/, '')
                .trim(),
            )
          : ''
      params.push({ name, type: paramTypes?.[name], desc })
    } else if (trimmed.startsWith('@returns') || trimmed.startsWith('@return')) {
      parts.push(`- ${formatInlineTags(trimmed.replace(/\n/g, ' ').trim())}`)
    } else if (trimmed.startsWith('@default')) {
      parts.push(`- ${formatInlineTags(trimmed.replace(/\n/g, ' ').trim())}`)
    } else if (trimmed.startsWith('@see')) {
      const see = trimmed.replace(/^@see\s*/, '').trim()
      parts.push(`*See also:* ${formatInlineTags(see)}`)
    } else {
      // Handle {@link ...} inline tags in orphan text, and strip stray @link prefixes
      parts.push(formatInlineTags(trimmed.replace(/^@link\s*/, '')))
    }
  }

  // Render params as table
  if (params.length > 0) {
    parts.push('')
    const hasTypes = params.some((p) => p.type)
    if (hasTypes) {
      parts.push('| Parameter | Type | Description |')
      parts.push('|-----------|------|-------------|')
      for (const p of params) {
        parts.push(`| \`${p.name}\` | \`${p.type || ''}\` | ${p.desc} |`)
      }
    } else {
      parts.push('| Parameter | Description |')
      parts.push('|-----------|-------------|')
      for (const p of params) {
        parts.push(`| \`${p.name}\` | ${p.desc} |`)
      }
    }
  }

  return { description: parts.join('\n'), example }
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
    const extendsTypes = extractExtends(code, decl)

    if (decl.type === 'FunctionDeclaration' && decl.id) {
      name = decl.id.name
    } else if (decl.type === 'ClassDeclaration' && decl.id) {
      name = decl.id.name
      kind = 'class'
    } else if (decl.type === 'TSInterfaceDeclaration' && decl.id) {
      name = decl.id.name
      kind = 'interface'
      if (!jsdoc) {
        const members = extractMembers(code, decl)
        if (members.length > 0) {
          symbols.push({ name, kind, jsdoc: '', signature, members, extendsTypes })
        }
        return
      }
    } else if (decl.type === 'TSTypeAliasDeclaration' && decl.id) {
      name = decl.id.name
      kind = 'type'
      if (!jsdoc && decl.typeAnnotation?.type === 'TSTypeLiteral') {
        const members = extractMembersFromTypeLiteral(code, decl.typeAnnotation)
        if (members.length > 0) {
          symbols.push({ name, kind: 'interface', jsdoc: '', signature, members, extendsTypes })
        }
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
      symbols.push({
        name,
        kind,
        jsdoc,
        signature,
        paramTypes: extractParamTypes(code, decl),
        extendsTypes,
      })
    } else if (name && kind === 'type') {
      symbols.push({ name, kind, jsdoc: jsdoc || '', signature, extendsTypes })
    }
  }

  function extractExtends(code: string, decl: any): string[] | undefined {
    const result: string[] = []
    if (decl.superClass?.id) {
      result.push(code.slice(decl.superClass.id.start, decl.superClass.id.end))
    }
    if (decl.superTypeArguments?.params) {
      for (const p of decl.superTypeArguments.params) {
        const typeName = code.slice(p.start, p.end)
        if (typeName && !result.includes(typeName)) {
          result.push(typeName)
        }
      }
    }
    if (decl.extends && Array.isArray(decl.extends)) {
      for (const ext of decl.extends) {
        if (ext.expression) {
          const typeName = code.slice(ext.expression.start, ext.expression.end)
          if (typeName) {
            result.push(typeName)
          }
        } else if (ext.id) {
          result.push(code.slice(ext.id.start, ext.id.end))
        }
      }
    }
    return result.length > 0 ? result : undefined
  }

  function extractParamTypes(code: string, decl: any): Record<string, string> | undefined {
    if (!decl.params || !Array.isArray(decl.params)) {
      return undefined
    }
    const types: Record<string, string> = {}
    for (const param of decl.params) {
      let paramName: string | undefined
      let typeSource: string | undefined
      if (param.type === 'Identifier') {
        paramName = param.name
        typeSource = param.typeAnnotation ? getTypeSource(code, param.typeAnnotation) : undefined
      } else if (param.type === 'AssignmentPattern' && param.left?.type === 'Identifier') {
        paramName = param.left.name
        typeSource = param.left.typeAnnotation
          ? getTypeSource(code, param.left.typeAnnotation)
          : undefined
      }
      if (paramName && typeSource) {
        types[paramName] = typeSource
      }
    }
    return Object.keys(types).length > 0 ? types : undefined
  }

  function getTypeSource(code: string, typeAnnotation: any): string {
    const raw = typeAnnotation.typeAnnotation
      ? code.slice(typeAnnotation.typeAnnotation.start, typeAnnotation.typeAnnotation.end)
      : code.slice(typeAnnotation.start, typeAnnotation.end)
    return raw
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .trim()
  }

  function extractMembers(code: string, decl: any): MemberProp[] {
    if (!decl.body?.body || !Array.isArray(decl.body.body)) {
      return []
    }
    return extractMembersList(code, decl.body.body)
  }

  function extractMembersFromTypeLiteral(code: string, typeLiteral: any): MemberProp[] {
    if (!typeLiteral.members || !Array.isArray(typeLiteral.members)) {
      return []
    }
    return extractMembersList(code, typeLiteral.members)
  }

  function extractMembersList(code: string, memberList: any[]): MemberProp[] {
    const members: MemberProp[] = []
    for (const member of memberList) {
      const propJsdoc = findJSDocBefore(code, member.start)
      if (!propJsdoc) {
        continue
      }
      const key = member.key
      if (!key) {
        continue
      }
      let propName: string | undefined
      if (key.type === 'Identifier') {
        propName = key.name
      } else if (key.type === 'Literal') {
        propName = String(key.value)
      }
      if (!propName) {
        continue
      }
      const optional = !!member.optional
      const typeSource = member.typeAnnotation
        ? getTypeSource(code, member.typeAnnotation)
        : undefined
      // Extract @default value and remove from jsdoc
      let defaultValue: string | undefined
      let cleanJsdoc = propJsdoc
      const defaultMatch = propJsdoc.match(/@default\s+(.+?)(?:\n|$)/)
      if (defaultMatch) {
        defaultValue = defaultMatch[1].trim()
        cleanJsdoc = propJsdoc.replace(/\s*@default\s+.+?(?:\n|$)/, '')
      }
      members.push({
        name: propName,
        type: typeSource,
        jsdoc: formatInlineTags(cleanJsdoc.replace(/\n/g, ' ').trim()),
        optional,
        defaultValue,
      })
    }
    return members
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
    const { description, example } = formatJSDoc(sym.jsdoc, sym.paramTypes)
    lines.push(`#### \`${sym.name}\``)
    lines.push('')
    if (description) {
      lines.push(description)
      lines.push('')
    }
    if (sym.extendsTypes && sym.extendsTypes.length > 0) {
      const links = sym.extendsTypes.map((t) => `[\`${t}\`](#${t.toLowerCase()})`).join(', ')
      lines.push(`*Extends:* ${links}`)
      lines.push('')
    }
    if (sym.members && sym.members.length > 0) {
      const hasTypes = sym.members.some((m) => m.type)
      const hasDefaults = sym.members.some((m) => m.defaultValue !== undefined)
      const headers = ['Property']
      if (hasTypes) {
        headers.push('Type')
      }
      if (hasDefaults) {
        headers.push('Default')
      }
      headers.push('Description')
      const headerRow = `| ${headers.join(' | ')} |`
      const sepRow = `|${headers.map((h) => '-'.repeat(h.length + 2)).join('|')}|`
      lines.push(headerRow)
      lines.push(sepRow)
      for (const m of sym.members) {
        const cells = [`\`${m.name}${m.optional ? '?' : ''}\``]
        if (hasTypes) {
          cells.push(`\`${m.type || ''}\``)
        }
        if (hasDefaults) {
          cells.push(m.defaultValue ? `\`${m.defaultValue}\`` : '—')
        }
        cells.push(m.jsdoc)
        lines.push(`| ${cells.join(' | ')} |`)
      }
      lines.push('')
    }
    lines.push('```ts')
    lines.push(sym.signature)
    lines.push('```')
    if (example) {
      // Strip existing code fences to avoid nesting
      const cleanExample = example.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '')
      lines.push('')
      lines.push('**Example:**')
      lines.push('')
      lines.push('```ts')
      lines.push(cleanExample)
      lines.push('```')
    }
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
