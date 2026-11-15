import { expect, test } from 'claude-code/testing'

import type { Ops } from '../engine/ops'
import type { SnapshotRequest } from '../engine/provider'
import { NovelProvider } from '../providers/novel/client'
import { foldPath, listNovels, NOVEL_EXTS, resolveInsideRoot } from '../providers/novel/library'
import { displayWidth, normalizeNovel, pageAt, parseNovel, wrapText } from '../providers/novel/parse'

const ROOT = '/lib'
const REQUEST: SnapshotRequest = { scope: 'viewport', maxChars: 100_000, cols: 80, rows: 24 }

type Entry = { text?: string; dir?: boolean }

function fakeLibrary(input: Record<string, string | true>): {
  ops: Ops
  saves: Map<string, unknown>
  writes: Array<{ key: string; value: unknown }>
} {
  const files = new Map<string, Entry>()
  for (const [path, value] of Object.entries(input)) {
    files.set(foldPath(path), value === true ? { dir: true } : { text: value })
  }
  const saves = new Map<string, unknown>()
  const writes: Array<{ key: string; value: unknown }> = []
  const ops = {
    root: '.',
    ask: async () => 'Allow',
    log: () => undefined,
    status: () => undefined,
    toast: () => undefined,
    fetch: async () => ({ status: 200, ok: true, headers: {}, text: '{}' }),
    spawn: (() => {}) as unknown as Ops['spawn'],
    storeGet: async (key: string) => saves.get(key),
    storeSet: async (key: string, value: unknown) => {
      writes.push({ key, value })
      saves.set(key, value)
    },
    every: () => ({ cancel: () => undefined }) as never,
    after: () => ({ cancel: () => undefined }) as never,
    openPane: async () => ({ isPlaced: true }) as never,
    closePane: async () => undefined,
    readText: async (path: string) => {
      const entry = files.get(foldPath(path))
      if (!entry || entry.dir) throw new Error('ENOENT')
      return entry.text ?? ''
    },
    listDir: async (path: string) => {
      const dir = foldPath(path)
      const prefix = dir.endsWith('/') ? dir : `${dir}/`
      const entries = []
      for (const [child, entry] of files) {
        if (!child.startsWith(prefix) || child.slice(prefix.length).includes('/')) continue
        entries.push({
          name: child.slice(prefix.length),
          kind: entry.dir ? 'dir' : 'file',
          size: (entry.text ?? '').length,
          mtimeMs: 0,
          isLink: false,
        })
      }
      return entries
    },
    statPath: async (path: string, resolve?: boolean) => {
      const folded = foldPath(path)
      const entry = files.get(folded)
      if (!entry) throw new Error('ENOENT')
      return {
        kind: entry.dir ? 'dir' : 'file',
        size: (entry.text ?? '').length,
        mtimeMs: 0,
        isLink: false,
        ...(resolve ? { realPath: folded } : {}),
      }
    },
    fillPrompt: async () => undefined,
  }
  return { ops: ops as unknown as Ops, saves, writes }
}

const FIRST = `第一章 开始

甲。

乙。

第二章 继续

丙。

丁。`

const LIBRARY: Record<string, string | true> = {
  '/lib': true,
  '/lib/01-first.txt': '第一章 开始\n\n甲。\n\n乙。\n\n第二章 继续\n\n丙。\n\n丁。',
  '/lib/02-notes.md': '# 笔记\n\n一。\n\n二。',
  '/lib/cover.png': 'png',
  '/lib/nested': true,
  '/lib/nested/03-deep.text': '第三章 深处\n\n戊。',
  '/outside.txt': '外面。',
}

const text = (paragraphs: string[], title = ''): string =>
  `${title ? `${title}\n\n` : ''}${paragraphs.join('\n\n')}\n`

test('parseNovel splits chapters on headings and records paragraph offsets', () => {
  const novel = parseNovel('第一章 开始\n\n甲。\n\n乙。\n\n第二章 继续\n\n丙。')
  expect(novel.chapters.length).toBe(2)
  expect(novel.chapters[0]?.title).toBe('第一章 开始')
  expect(novel.chapters[1]?.title).toBe('第二章 继续')
  expect(novel.chapters[0]?.paragraphs.map(paragraph => paragraph.text)).toEqual(['甲。', '乙。'])
  expect(novel.chapters[0]?.paragraphs[0]?.offset).toBeGreaterThan(novel.chapters[0]!.headingOffset)
})

test('parseNovel recognizes CHAPTER, markdown and numbered headings', () => {
  const novel = parseNovel('CHAPTER 1 Dawn\n\nA.\n\n# Second\n\nB.\n\n2) Third\n\nC.')
  expect(novel.chapters.map(chapter => chapter.title)).toEqual(['CHAPTER 1 Dawn', 'Second', 'Third'])
})

test('a document with no heading is one untitled chapter', () => {
  const novel = parseNovel('第一段。\n\n第二段。')
  expect(novel.chapters.length).toBe(1)
  expect(novel.chapters[0]?.title).toBe('')
  expect(novel.chapters[0]?.paragraphs.length).toBe(2)
  expect(novel.title).toBe('第一段。')
})

test('a short first line becomes the title, a long one does not', () => {
  expect(parseNovel('夜航\n\n正文。').title).toBe('夜航')
  expect(parseNovel(`${'x'.repeat(61)}\n\n正文。`).title).toBe('')
})

test('the hash is stable and follows the text', () => {
  const one = parseNovel('甲。')
  const two = parseNovel('甲。')
  const three = parseNovel('乙。')
  expect(one.hash).toBe(two.hash)
  expect(one.hash).not.toBe(three.hash)
  expect(one.hash).toMatch(/^[a-z0-9]+$/)
})

test('normalization folds CRLF, drops a BOM and controls but keeps tabs', () => {
  expect(normalizeNovel('\uFEFF甲\r\n乙\r丙\u0000\u0007\t丁')).toBe('甲\n乙\n丙\t丁')
})

test('paragraphs are capped at 2000 characters', () => {
  const novel = parseNovel('x'.repeat(3000))
  expect(novel.chapters[0]?.paragraphs[0]?.text.length).toBe(2000)
})

test('display width counts CJK and emoji as two and wraps on it', () => {
  expect(displayWidth('ab')).toBe(2)
  expect(displayWidth('中a😀')).toBe(5)
  expect(wrapText('abcdef', 3)).toEqual(['abc', 'def'])
  expect(wrapText('中中中', 4)).toEqual(['中中', '中'])
  expect(wrapText('a😀b', 2)).toEqual(['a', '😀', 'b'])
})

test('pageAt emits heading and paragraph nodes with ascending bounds', () => {
  const novel = parseNovel(text(['甲甲甲。', '乙乙乙。'], '第一章 标题'))
  const page = pageAt(novel, {}, 80, 24, 10_000)
  expect(page.offset).toBe(novel.chapters[0]!.paragraphs[0]!.offset)
  expect(page.nodes[0]?.role).toBe('heading')
  expect(page.nodes[0]?.name).toBe('第一章 标题')
  expect(page.nodes[0]?.interactive).toBe(false)
  expect(page.nodes[1]?.role).toBe('paragraph')
  expect(page.nodes[1]?.ref).toMatch(/^p\d+$/)
  expect(page.nodes[1]?.interactive).toBe(true)
  expect(page.nodes[1]!.bounds.y).toBeGreaterThan(page.nodes[0]!.bounds.y)
  expect(page.hasPrev).toBe(false)
})

test('pageAt stops at maxChars and reports paging across chapters', () => {
  const novel = parseNovel(text(['甲'.repeat(200), '乙'.repeat(200)], '第一章 标题'))
  const page = pageAt(novel, {}, 20, 100, 60)
  const chars = page.nodes.reduce((sum, node) => sum + node.name.replace(/\n/g, '').length, 0)
  expect(chars).toBeLessThanOrEqual(60)
  expect(page.hasNext).toBe(true)
  const next = pageAt(novel, { offset: page.end }, 20, 100, 60)
  expect(next.offset).toBeGreaterThan(page.offset)
  expect(next.hasPrev).toBe(true)
})

test('pageAt clamps to the chapter and marks the last page', () => {
  const novel = parseNovel(text(['甲。', '乙。'], '第一章 标题'))
  const page = pageAt(novel, { offset: 999_999 }, 80, 24, 10_000)
  expect(page.offset).toBe(novel.chapters[0]!.paragraphs[1]!.offset)
  expect(page.hasNext).toBe(false)
})

test('resolveInsideRoot accepts files under the root and rejects outside paths', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const inside = await resolveInsideRoot(ops, ROOT, '01-first.txt')
  expect(inside.ok).toBe(true)
  if (inside.ok) expect(inside.realPath).toBe('/lib/01-first.txt')
  const absolute = await resolveInsideRoot(ops, ROOT, '/lib/02-notes.md')
  expect(absolute.ok).toBe(true)
  const outside = await resolveInsideRoot(ops, ROOT, '../outside.txt')
  expect(outside.ok).toBe(false)
  if (!outside.ok) expect(outside.message).toContain('outside')
  const sibling = await resolveInsideRoot(ops, ROOT, '/libber/01-first.txt')
  expect(sibling.ok).toBe(false)
})

test('a path typed with the root prefix also resolves from the working directory', async () => {
  const { ops } = fakeLibrary({ '/proj': true, '/proj/novels': true, '/proj/novels/x.txt': '甲。' })
  // The fake only knows absolute keys; play the engine resolving relatives
  // from the working directory.
  const wrapped = {
    ...ops,
    statPath: (path: string, resolve?: boolean) => ops.statPath(path.startsWith('/') ? path : `/proj/${path}`, resolve),
  } as Ops
  const prefixed = await resolveInsideRoot(wrapped, '/proj/novels', 'novels/x.txt')
  expect(prefixed.ok).toBe(true)
  const bare = await resolveInsideRoot(wrapped, '/proj/novels', 'x.txt')
  expect(bare.ok).toBe(true)
})

test('resolveInsideRoot rejects unsupported extensions and missing roots', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const wrong = await resolveInsideRoot(ops, ROOT, 'cover.png')
  expect(wrong.ok).toBe(false)
  if (!wrong.ok) expect(wrong.message).toContain('not a novel file')
  const missing = await resolveInsideRoot(ops, '/gone', 'x.txt')
  expect(missing.ok).toBe(false)
})

test('listNovels keeps only novels and directories, sorted by name', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const entries = await listNovels(ops, ROOT, '/lib')
  expect(entries.map(entry => entry.name)).toEqual(['01-first.txt', '02-notes.md', 'nested'])
  expect(entries.every(entry => NOVEL_EXTS.has(entry.name.slice(entry.name.lastIndexOf('.'))) || entry.kind === 'dir')).toBe(true)
})

test('opening a file parses it and snapshots its first page', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  const result = await provider.open('01-first.txt')
  expect(result.ok).toBe(true)
  const snapshot = await provider.snapshot(REQUEST)
  expect(snapshot.title).toBe('第一章 开始')
  expect(snapshot.nodes[0]?.role).toBe('heading')
  expect(snapshot.nodes.some(node => node.role === 'paragraph')).toBe(true)
})

test('clicking a paragraph selects it without a page change', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  await provider.open('01-first.txt')
  const snapshot = await provider.snapshot(REQUEST)
  const paragraph = snapshot.nodes.find(node => node.role === 'paragraph')!
  const result = await provider.act({ kind: 'click', ref: paragraph.ref }, { actor: 'person' })
  expect(result.ok).toBe(true)
  expect(result.changed).toBe(true)
  expect(result.message).toContain('selected')
})

test('paging keys move a page and persist progress', async () => {
  const { ops, saves } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  await provider.open('01-first.txt')
  await provider.snapshot({ ...REQUEST, cols: 10, rows: 2 })
  const down = await provider.act({ kind: 'press', key: 'down' }, { actor: 'person' })
  expect(down.ok).toBe(true)
  expect(down.changed).toBe(true)
  expect(down.message).toMatch(/^page \d+\/\d+$/)
  const novel = parseNovel(FIRST)
  const saved = saves.get(`moyu.progress.${novel.hash}`) as { offset: number }
  expect(saved.offset).toBeGreaterThan(0)
  const up = await provider.act({ kind: 'press', key: 'up' }, { actor: 'person' })
  expect(up.ok).toBe(true)
  expect(up.changed).toBe(true)
})

test('a three-row page still advances and reaches the next chapter', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  await provider.open('01-first.txt')
  const small = { ...REQUEST, cols: 60, rows: 3 }
  await provider.snapshot(small)
  const start = (await provider.snapshot(small)).viewport.scrollY
  const down = await provider.act({ kind: 'press', key: 'down' }, { actor: 'person' })
  expect(down.ok).toBe(true)
  const page = await provider.snapshot(small)
  expect(page.viewport.scrollY).toBeGreaterThan(start)
  expect(page.title).toBe('第二章 继续')
  const back = await provider.act({ kind: 'press', key: 'p' }, { actor: 'person' })
  expect(back.ok).toBe(true)
})

test('home, end and n/p move within and between chapters', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  await provider.open('01-first.txt')
  const novel = parseNovel(FIRST)
  const end = await provider.act({ kind: 'press', key: 'end' }, { actor: 'person' })
  expect(end.ok).toBe(true)
  const after = await provider.snapshot(REQUEST)
  expect(after.viewport.scrollY).toBe(novel.chapters[0]!.paragraphs[1]!.offset)
  const home = await provider.act({ kind: 'press', key: 'home' }, { actor: 'person' })
  expect(home.ok).toBe(true)
  const next = await provider.act({ kind: 'press', key: 'n' }, { actor: 'person' })
  expect(next.ok).toBe(true)
  expect(next.message).toContain('chapter 2/2')
  const previous = await provider.act({ kind: 'press', key: 'p' }, { actor: 'person' })
  expect(previous.ok).toBe(true)
  expect(previous.message).toContain('chapter 1/2')
})

test('commands turn pages and jump to a chapter or offset', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  await provider.open('01-first.txt')
  await provider.snapshot({ ...REQUEST, cols: 10, rows: 2 })
  const turned = await provider.act({ kind: 'command', name: 'page', args: { delta: 1 } }, { actor: 'model' })
  expect(turned.ok).toBe(true)
  const novel = parseNovel(FIRST)
  const chapter = await provider.act({ kind: 'command', name: 'chapter', args: { index: 1 } }, { actor: 'model' })
  expect(chapter.ok).toBe(true)
  const at = await provider.snapshot(REQUEST)
  expect(at.viewport.scrollY).toBe(novel.chapters[1]!.paragraphs[0]!.offset)
  const goto = await provider.act(
    { kind: 'command', name: 'goto', args: { offset: novel.chapters[0]!.paragraphs[1]!.offset } },
    { actor: 'model' },
  )
  expect(goto.ok).toBe(true)
  const back = await provider.snapshot(REQUEST)
  expect(back.viewport.scrollY).toBe(novel.chapters[0]!.paragraphs[1]!.offset)
})

test('find returns at most 20 excerpts and no matches is empty', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  await provider.open('01-first.txt')
  const found = await provider.act({ kind: 'command', name: 'find', args: { text: '章' } }, { actor: 'model' })
  expect(found.ok).toBe(true)
  expect(found.text?.split('\n').length).toBeLessThanOrEqual(20)
  expect(found.text).toContain('章')
  const none = await provider.act({ kind: 'command', name: 'find', args: { text: '没有' } }, { actor: 'model' })
  expect(none.text).toBe('')
  expect(none.message).toContain('0 matches')
})

test('annotate anchors a note after its paragraph and caps it', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  await provider.open('01-first.txt')
  const novel = parseNovel(FIRST)
  const ref = `p${novel.chapters[0]!.paragraphs[0]!.offset}`
  const result = await provider.act(
    { kind: 'command', name: 'annotate', args: { ref, text: `${'注'.repeat(700)}` } },
    { actor: 'model' },
  )
  expect(result.ok).toBe(true)
  const snapshot = await provider.snapshot(REQUEST)
  const index = snapshot.nodes.findIndex(node => node.ref === ref)
  const note = snapshot.nodes[index + 1]!
  expect(note.role).toBe('annotation')
  expect(note.depth).toBe(1)
  expect(note.interactive).toBe(false)
  expect(note.name.startsWith('· AI ')).toBe(true)
  expect(note.name.length).toBe(('· AI '.length) + 600)
})

test('space and b turn pages like the pager keys', async () => {
  const { ops, saves } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  await provider.open('01-first.txt')
  await provider.snapshot({ ...REQUEST, cols: 10, rows: 2 })
  const next = await provider.act({ kind: 'press', key: ' ' }, { actor: 'person' })
  expect(next.ok).toBe(true)
  const saved = saves.get(`moyu.progress.${parseNovel(FIRST).hash}`) as { offset: number }
  expect(saved.offset).toBeGreaterThan(0)
  const back = await provider.act({ kind: 'press', key: 'b' }, { actor: 'person' })
  expect(back.ok).toBe(true)
})

test('a snapshot persists a clamped position and stop drops the book', async () => {
  const { ops, saves } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  await provider.open('01-first.txt')
  // Force the saved position past the chapter end; the snapshot clamps it and
  // writes the settled position back.
  const novel = parseNovel(FIRST)
  saves.set(`moyu.progress.${novel.hash}`, { chapterIndex: 0, offset: 9999 })
  await provider.open('01-first.txt')
  await provider.snapshot(REQUEST)
  const saved = saves.get(`moyu.progress.${novel.hash}`) as { offset: number }
  expect(saved.offset).toBe(novel.chapters[0]!.paragraphs[1]!.offset)
  await provider.stop()
  await expect(provider.snapshot(REQUEST)).rejects.toThrow('no file open')
})

test('reopening resumes saved chapter and offset', async () => {
  const { ops, saves } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  const novel = parseNovel(FIRST)
  const offset = novel.chapters[1]!.paragraphs[0]!.offset
  saves.set(`moyu.progress.${novel.hash}`, { chapterIndex: 1, offset })
  await provider.open('01-first.txt')
  const snapshot = await provider.snapshot(REQUEST)
  expect(snapshot.title).toBe('第二章 继续')
  expect(snapshot.viewport.scrollY).toBe(offset)
})

test('a directory opens as a listing and find is guarded without a file', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  expect((await provider.act({ kind: 'command', name: 'find', args: { text: '甲' } }, { actor: 'model' })).ok).toBe(false)
  const listing = await provider.open('.')
  expect(listing.ok).toBe(true)
  const snapshot = await provider.snapshot(REQUEST)
  expect(snapshot.nodes.every(node => node.role === 'file')).toBe(true)
  expect(snapshot.nodes.map(node => node.name)).toContain('nested/')
  const opened = await provider.act({ kind: 'click', ref: 'f0' }, { actor: 'person' })
  expect(opened.ok).toBe(true)
  const after = await provider.snapshot(REQUEST)
  expect(after.title).toBe('第一章 开始')
})

test('an outside path fails and health carries the error', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  const result = await provider.open('../outside.txt')
  expect(result.ok).toBe(false)
  const health = await provider.health()
  expect(health.ok).toBe(false)
  expect(health.error).toContain('outside')
  const absolute = await provider.open('/outside.txt')
  expect(absolute.ok).toBe(false)
})

test('capabilities come from the meta and unknown actions are refused', async () => {
  const { ops } = fakeLibrary(LIBRARY)
  const provider = new NovelProvider(ops, ROOT)
  expect(provider.meta.id).toBe('novel')
  expect(provider.meta.capabilities.text).toBe(true)
  await provider.open('01-first.txt')
  const unknown = await provider.act({ kind: 'command', name: 'nope' }, { actor: 'model' })
  expect(unknown.ok).toBe(false)
  expect(unknown.message).toContain('unknown command')
})
