// Pure novel parsing and paging: normalize a document, split it into chapters
// and paragraphs with their offsets, then wrap and pack one viewport page.
// No dependencies; the provider supplies only the text.
import type { SnapshotNode } from '../../engine/provider'

export type Paragraph = { offset: number; text: string }
export type Chapter = { index: number; title: string; headingOffset: number; paragraphs: Paragraph[] }
export type Novel = { hash: string; title: string; chapters: Chapter[] }
export type PageHint = { chapterIndex?: number; offset?: number }
export type Page = {
  chapterIndex: number
  offset: number
  /** Offset just past the last character on the page. */
  end: number
  nodes: SnapshotNode[]
  hasPrev: boolean
  hasNext: boolean
}

export const PARAGRAPH_MAX = 2000
export const TITLE_MAX = 60

// `第N章/回/节/卷`, `CHAPTER N`, an ATX heading, or a numbered line.
const HEADING = /^(?:第\s*[0-9零〇一二三四五六七八九十百千万两]+\s*[章回节卷]|CHAPTER\s+\d+\b|#{1,6}\s+\S|\d+[.)、]\s+\S)/i

/** djb2 over the UTF-16 code units, base 36: short and stable. */
function docHash(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  return hash.toString(36)
}

/** CRLF folds to LF, a BOM goes, and controls other than tab and newline go. */
export function normalizeNovel(text: string): string {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

function headingTitle(line: string): string {
  return line.trim().replace(/^#{1,6}\s+/, '').replace(/^\d+[.)、]\s+/, '').trim().slice(0, 120)
}

function shortTitle(text: string): string {
  const line = text.split('\n').find(candidate => candidate.trim() !== '')
  if (!line) return ''
  const title = headingTitle(line)
  return title.length <= TITLE_MAX ? title : ''
}

/**
 * Normalize `text` and split it into chapters of paragraphs. A document with
 * no heading is one untitled chapter. Paragraph offsets index the normalized
 * text; each paragraph is capped at `PARAGRAPH_MAX` characters.
 */
export function parseNovel(text: string): Novel {
  const normalized = normalizeNovel(text)
  const hash = docHash(normalized)
  const chapters: Chapter[] = []
  let paragraphs: Paragraph[] = []
  let pieces: Array<{ offset: number; text: string }> = []
  let headingOffset = 0
  let title = ''

  const flushParagraph = () => {
    if (pieces.length === 0) return
    const start = pieces[0]!.offset
    const body = pieces.map(piece => piece.text).join(' ').slice(0, PARAGRAPH_MAX)
    if (body) paragraphs.push({ offset: start, text: body })
    pieces = []
  }

  const flushChapter = (nextHeadingOffset: number, nextTitle: string) => {
    flushParagraph()
    if (paragraphs.length > 0 || title) {
      chapters.push({ index: chapters.length, title, headingOffset, paragraphs })
    }
    paragraphs = []
    headingOffset = nextHeadingOffset
    title = nextTitle
  }

  let lineOffset = 0
  let first = true
  for (const line of normalized.split('\n')) {
    const offset = lineOffset
    lineOffset += line.length + 1
    if (line.trim() === '') {
      flushParagraph()
      continue
    }
    if (HEADING.test(line)) {
      flushChapter(offset, headingTitle(line))
      first = false
      continue
    }
    const leading = line.length - line.trimStart().length
    pieces.push({ offset: offset + leading, text: line.trim() })
    if (first) {
      // Text before the first heading belongs to an untitled chapter.
      headingOffset = offset
      first = false
    }
  }
  flushParagraph()
  // A preamble has no title, but real chapters (and a whole untitled document)
  // are kept even when empty.
  if (paragraphs.length > 0 || title || chapters.length === 0) {
    chapters.push({ index: chapters.length, title, headingOffset, paragraphs })
  }
  if (chapters.length === 0) chapters.push({ index: 0, title: '', headingOffset: 0, paragraphs: [] })
  for (let index = 0; index < chapters.length; index++) chapters[index]!.index = index
  return { hash, title: shortTitle(normalized), chapters }
}

/** Terminal columns a code point takes: 2 for CJK and emoji, else 1. */
export function charWidth(code: number): number {
  if (code === 0) return 0
  return (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
    ? 2
    : 1
}

/** Display width of `text`, in terminal columns. */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) width += charWidth(char.codePointAt(0) ?? 0)
  return width
}

/** Split `text` into lines no wider than `cols`, never splitting a code point. */
export function wrapText(text: string, cols: number): string[] {
  const width = Math.max(1, Math.floor(cols))
  const lines: string[] = []
  for (const source of text.split('\n')) {
    let line = ''
    let used = 0
    for (const char of source) {
      const cost = charWidth(char.codePointAt(0) ?? 0)
      if (line !== '' && used + cost > width) {
        lines.push(line)
        line = ''
        used = 0
      }
      line += char
      used += cost
    }
    if (line !== '' || lines.length === 0) lines.push(line)
  }
  return lines
}

/**
 * The page at `hint`, wrapped to `cols`, packed into at most `rows` rows and
 * `maxChars` characters. The page never starts before its chapter's first
 * paragraph. At least one wrapped line is always returned while text remains.
 */
export function pageAt(novel: Novel, hint: PageHint, cols: number, rows: number, maxChars: number): Page {
  const chapters = novel.chapters
  const chapterIndex = Math.min(Math.max(0, Math.floor(hint.chapterIndex ?? 0)), Math.max(0, chapters.length - 1))
  const chapter = chapters[chapterIndex]!
  const chapterStart = chapter.paragraphs[0]?.offset ?? chapter.headingOffset
  const last = chapter.paragraphs[chapter.paragraphs.length - 1]
  const chapterEnd = last ? last.offset : chapterStart
  const startOffset = Math.max(chapterStart, Math.min(Math.floor(hint.offset ?? chapterStart), chapterEnd))
  const width = Math.max(1, Math.floor(cols))
  const height = Math.max(1, Math.floor(rows))
  const budget = Math.max(1, Math.floor(maxChars))
  const nodes: SnapshotNode[] = []
  let offset = startOffset
  let end = startOffset
  let row = 0
  let used = 0
  let done = false

  if (offset <= chapterStart && chapter.title) {
    nodes.push({
      ref: `c${chapterIndex}`,
      role: 'heading',
      name: chapter.title,
      depth: 0,
      interactive: false,
      bounds: { x: 0, y: 0, w: 1, h: 1 },
    })
    row = 1
    used = chapter.title.length
    // A heading alone must not stall paging: leave one row for prose.
    if (row >= height) row = Math.max(0, height - 1)
  }

  let index = chapter.paragraphs.findIndex(paragraph => paragraph.offset + paragraph.text.length > offset)
  if (index < 0) index = chapter.paragraphs.length
  for (let position = index; position < chapter.paragraphs.length && !done; position++) {
    const paragraph = chapter.paragraphs[position]!
    const local = Math.max(0, offset - paragraph.offset)
    const remaining = paragraph.text.slice(local)
    if (!remaining) continue
    const nodeRow = row
    const taken: string[] = []
    let consumed = 0
    for (const line of wrapText(remaining, width)) {
      if (row >= height) {
        done = true
        break
      }
      if (used + line.length > budget && taken.length > 0) {
        done = true
        break
      }
      taken.push(line)
      row += 1
      used += line.length
      consumed += line.length
      if (used >= budget) {
        done = true
        break
      }
    }
    if (taken.length > 0) {
      nodes.push({
        ref: `p${paragraph.offset}`,
        role: 'paragraph',
        name: taken.join('\n'),
        depth: 0,
        interactive: true,
        bounds: { x: 0, y: nodeRow, w: 1, h: 1 },
      })
      end = paragraph.offset + local + consumed
    }
  }

  return {
    chapterIndex,
    offset: startOffset,
    end,
    nodes,
    hasPrev: startOffset > chapterStart || chapterIndex > 0,
    hasNext: end < chapterEnd || chapterIndex < chapters.length - 1,
  }
}
