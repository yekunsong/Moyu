// A dependency-free, best-effort HTML tokenizer for the read-only provider.
// It is a contract proof, not a scraper: malformed markup degrades to text.
import type { Snapshot, SnapshotNode } from '../../engine/provider'

export type ParsedDocument = {
  title: string
  nodes: SnapshotNode[]
  landmarks: Snapshot['landmarks']
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const SKIP = new Set(['script', 'style', 'noscript', 'template'])
const BLOCK = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'label', 'dt', 'dd', 'blockquote', 'figcaption', 'caption'])
const ROLES: Record<string, string> = {
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  p: 'text', li: 'listitem', label: 'label', dt: 'text', dd: 'text', blockquote: 'text',
  figcaption: 'text', caption: 'text',
}

type Frame = { tag: string; node?: SnapshotNode; title?: boolean }

/** djb2 over the UTF-16 code units, base 36: short and stable. */
function docHash(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  return hash.toString(36)
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    const lower = name.toLowerCase()
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    const named: Record<string, string> = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '…',
    }
    return named[lower] ?? whole
  })
}

function clean(text: string): string {
  return decodeEntities(text).replace(/\s+/g, ' ').trim().slice(0, 500)
}

function attribute(raw: string, name: string): string | undefined {
  const pattern = new RegExp(String.raw`(?:^|\s)${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`, 'i')
  const match = raw.match(pattern)
  return match ? clean(match[1] ?? match[2] ?? match[3] ?? '') : undefined
}

/** Resolve a link to http(s); other schemes (javascript:, mailto:) are dropped. */
function resolveHref(href: string | undefined, baseUrl: string): string | undefined {
  if (!href) return undefined
  try {
    const url = new URL(href, baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Parse a document into snapshot nodes with refs derived from its hash.
 * Tolerant: unknown and malformed tags are ignored, and unclosed elements are
 * closed at the end.
 */
export function parseDocument(html: string, baseUrl: string): ParsedDocument {
  const hash = docHash(html)
  const nodes: SnapshotNode[] = []
  const landmarks: Snapshot['landmarks'] = []
  let title = ''
  let ordinal = 0
  let skipTag: string | undefined
  let skipDepth = 0
  const stack: Frame[] = []

  const captures = (): Frame[] => stack.filter(frame => frame.node || frame.title)

  const emit = (raw: string): void => {
    if (skipTag) return
    const text = decodeEntities(raw)
    for (const frame of captures()) {
      if (frame.title) title += text
      if (frame.node) frame.node.name += text
    }
  }

  const create = (tag: string, raw: string): void => {
    const role = ROLES[tag]
    const href = tag === 'a' ? resolveHref(attribute(raw, 'href'), baseUrl) : undefined
    if (!role && tag !== 'a') return
    const listDepth = stack.filter(frame => frame.tag === 'ul' || frame.tag === 'ol').length
    const node: SnapshotNode = {
      ref: `r${hash}:${ordinal++}`,
      role: role ?? 'link',
      name: '',
      depth: Math.min(listDepth + (tag === 'li' ? 1 : 0), 8),
      bounds: { x: 0, y: 0, w: 1, h: 1 },
    }
    if (href) node.href = href
    if (tag === 'a') node.interactive = true
    nodes.push(node)
    stack.push({ tag, node })
  }

  const finish = (frame: Frame): void => {
    if (frame.title) title = clean(title)
    if (!frame.node) return
    frame.node.name = clean(frame.node.name)
    if (frame.node.role === 'heading' && frame.node.name) {
      landmarks.push({ role: 'heading', name: frame.node.name })
    }
  }

  const tag = (raw: string): void => {
    const closing = raw.startsWith('/')
    const body = (closing ? raw.slice(1) : raw).replace(/\/$/, '').trim()
    const match = body.match(/^([a-zA-Z][a-zA-Z0-9]*)/)
    if (!match) return
    const name = match[1]!.toLowerCase()
    if (skipTag) {
      if (name === skipTag) {
        if (closing) skipDepth -= 1
        else if (!VOID.has(name)) skipDepth += 1
        if (skipDepth <= 0) skipTag = undefined
      }
      return
    }
    if (closing) {
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index]!.tag !== name) continue
        while (stack.length > index) finish(stack.pop()!)
        return
      }
      return
    }
    if (SKIP.has(name)) {
      skipTag = name
      skipDepth = 1
      return
    }
    if (VOID.has(name)) {
      if (name === 'br' || name === 'hr') emit(' ')
      return
    }
    if (name === 'title') {
      stack.push({ tag: name, title: true })
      return
    }
    if (BLOCK.has(name)) {
      // A new block closes an unfinished one, even when its tag is missing.
      while (stack.length && stack[stack.length - 1]!.node) finish(stack.pop()!)
    }
    if (ROLES[name] || name === 'a') {
      create(name, body)
      return
    }
    // Lists only carry depth, but still need to be open for children to see them.
    if (name === 'ul' || name === 'ol') stack.push({ tag: name })
  }

  let index = 0
  while (index < html.length) {
    const open = html.indexOf('<', index)
    if (open < 0) {
      emit(html.slice(index))
      break
    }
    if (open > index) emit(html.slice(index, open))
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4)
      index = end < 0 ? html.length : end + 3
      continue
    }
    if (html[open + 1] === '!' || html[open + 1] === '?') {
      const end = html.indexOf('>', open + 1)
      index = end < 0 ? html.length : end + 1
      continue
    }
    const end = html.indexOf('>', open + 1)
    if (end < 0) {
      emit(html.slice(open))
      break
    }
    const raw = html.slice(open + 1, end)
    if (raw.includes('<')) {
      // A lone '<' is text, not an opening bracket.
      emit('<')
      index = open + 1
      continue
    }
    tag(raw)
    index = end + 1
  }
  while (stack.length) finish(stack.pop()!)

  return { title, nodes: nodes.filter(node => node.name || node.href), landmarks }
}
