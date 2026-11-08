import { expect, test } from 'claude-code/testing'

import type { Ops } from '../engine/ops'
import type { SnapshotRequest } from '../engine/provider'
import { ReaderProvider, READER_MAX_BYTES } from '../providers/reader/client'
import { parseDocument } from '../providers/reader/parse'

const BASE = 'https://example.test/docs/page.html'

const REQUEST: SnapshotRequest = { scope: 'viewport', maxChars: 12000, cols: 80, rows: 24 }

function fakeOps(bodies: string[], status = 200): { ops: Ops; calls: string[] } {
  const calls: string[] = []
  const ops = {
    fetch: async (url: string) => {
      calls.push(url)
      return { status, ok: status >= 200 && status < 300, headers: {}, text: bodies[Math.min(calls.length - 1, bodies.length - 1)] ?? '' }
    },
    after: () => ({ cancel: () => undefined }),
  } as unknown as Ops
  return { ops, calls }
}

test('parser reads headings, links, paragraphs, lists and labels', () => {
  const document = parseDocument(
    `<title> Guide &amp; notes </title><h1>Start</h1><p>First   paragraph</p>
     <ul><li>One</li><li>Two</li></ul>
     <a href="other.html">Next page</a><label>Email address</label>`,
    BASE,
  )
  expect(document.title).toBe('Guide & notes')
  const roles = document.nodes.map(node => node.role)
  expect(roles).toContain('heading')
  expect(roles).toContain('text')
  expect(roles).toContain('listitem')
  expect(roles).toContain('link')
  expect(roles).toContain('label')
  expect(document.nodes.find(node => node.role === 'link')?.href).toBe('https://example.test/docs/other.html')
  expect(document.nodes.find(node => node.name.includes('First'))?.name).toBe('First paragraph')
  expect(document.landmarks).toContainEqual({ role: 'heading', name: 'Start' })
})

test('parser decodes entities, collapses whitespace and tolerates malformed markup', () => {
  const document = parseDocument('<h2>  A &lt;b&gt;  <p>line<br>break</p><div>ignored</span><p>&#65;&#x42;</p>', BASE)
  expect(document.nodes[0]?.name).toBe('A <b>')
  expect(document.nodes[1]?.name).toBe('line break')
  expect(document.nodes[2]?.name).toBe('AB')
  // A stray `<` with no closing bracket is kept as text.
  const loose = parseDocument('<p>a < b</p>', BASE)
  expect(loose.nodes[0]?.name).toBe('a < b')
})

test('a javascript: href is dropped but the link text remains', () => {
  const document = parseDocument('<a href="javascript:void(0)">Run</a><a href="mailto:x@y.test">Mail</a>', BASE)
  expect(document.nodes.length).toBe(2)
  expect(document.nodes[0]?.name).toBe('Run')
  expect(document.nodes[0]?.href).toBeUndefined()
  expect(document.nodes[1]?.href).toBeUndefined()
})

test('refs derive from the document hash and are stable', () => {
  const one = parseDocument('<p>same</p>', BASE)
  const two = parseDocument('<p>same</p>', BASE)
  const three = parseDocument('<p>different</p>', BASE)
  expect(one.nodes[0]?.ref).toBe(two.nodes[0]?.ref)
  expect(one.nodes[0]?.ref).not.toBe(three.nodes[0]?.ref)
  expect(one.nodes[0]?.ref).toMatch(/^r[a-z0-9]+:0$/)
})

test('snapshot fetches, parses and fills approximate bounds and viewport', async () => {
  const { ops, calls } = fakeOps(['<title>Doc</title><h1>Head</h1><p>Body</p>'])
  const provider = new ReaderProvider(ops)
  const navigated = await provider.act({ kind: 'navigate', url: BASE }, { actor: 'model' })
  expect(navigated.ok).toBe(true)
  const snapshot = await provider.snapshot(REQUEST)
  expect(calls).toEqual([BASE])
  expect(snapshot.title).toBe('Doc')
  expect(snapshot.url).toBe(BASE)
  expect(snapshot.viewport.cols).toBe(80)
  expect(snapshot.viewport.width).toBe(640)
  expect(snapshot.nodes[0]?.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  expect(snapshot.nodes[1]?.bounds.y).toBe(1)
})

test('a non-http scheme is refused', async () => {
  const { ops } = fakeOps(['x'])
  const provider = new ReaderProvider(ops)
  const result = await provider.act({ kind: 'navigate', url: 'file:///c:/x.html' }, { actor: 'model' })
  expect(result.ok).toBe(false)
  expect(result.message).toContain('scheme file:')
  const health = await provider.health()
  expect(health.ok).toBe(false)
  expect(health.error).toContain('scheme file:')
})

test('navigate refetches and changes the hash and refs', async () => {
  const { ops, calls } = fakeOps(['<p>one</p>', '<p>two</p>'])
  const provider = new ReaderProvider(ops)
  await provider.act({ kind: 'navigate', url: BASE }, { actor: 'model' })
  const first = await provider.snapshot(REQUEST)
  const navigated = await provider.act({ kind: 'navigate', url: BASE }, { actor: 'model' })
  expect(navigated.ok).toBe(true)
  expect(navigated.changed).toBe(true)
  const second = await provider.snapshot(REQUEST)
  expect(calls.length).toBe(2)
  expect(second.nodes[0]?.name).toBe('two')
  expect(second.nodes[0]?.ref).not.toBe(first.nodes[0]?.ref)
})

test('an oversized body is capped', async () => {
  const body = '<p>word</p>'.repeat(Math.ceil(READER_MAX_BYTES / 11) + 5000)
  const { ops } = fakeOps([body])
  const provider = new ReaderProvider(ops)
  await provider.act({ kind: 'navigate', url: BASE }, { actor: 'model' })
  const snapshot = await provider.snapshot({ ...REQUEST, maxChars: 2000 })
  expect(snapshot.nodes.length).toBeLessThan(700)
  expect(snapshot.truncated.nodes).toBeGreaterThan(0)
})

test('unsupported actions return a clear message', async () => {
  const { ops } = fakeOps(['<p>x</p>'])
  const provider = new ReaderProvider(ops)
  const result = await provider.act({ kind: 'click', ref: 'r1:0' }, { actor: 'model' })
  expect(result.ok).toBe(false)
  expect(result.message).toContain('text-only')
})

test('health reports the last fetch error', async () => {
  const { ops } = fakeOps(['nope'], 500)
  const provider = new ReaderProvider(ops)
  await provider.act({ kind: 'navigate', url: BASE }, { actor: 'model' })
  const health = await provider.health()
  expect(health.ok).toBe(false)
  expect(health.error).toContain('HTTP 500')
})

test('a bare snapshot without a URL fails clearly', async () => {
  const { ops } = fakeOps(['<p>x</p>'])
  const provider = new ReaderProvider(ops)
  await expect(provider.snapshot(REQUEST)).rejects.toThrow('navigate first')
})
