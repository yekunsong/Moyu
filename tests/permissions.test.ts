import { expect, test } from 'claude-code/testing'

import { classify, configOf, decide, hostAllowed, newGrant } from '../hub/permissions'

const config = configOf({ allowedHosts: 'example.com, *.example.org', writePolicy: 'confirm' })

test('local hosts are always allowed', () => {
  expect(hostAllowed(config, 'localhost')).toBe(true)
  expect(hostAllowed(config, '127.0.0.1')).toBe(true)
})

test('listed and wildcard hosts are allowed, others are not', () => {
  expect(hostAllowed(config, 'example.com')).toBe(true)
  expect(hostAllowed(config, 'docs.example.org')).toBe(true)
  expect(hostAllowed(config, 'evil.example.net')).toBe(false)
})

test('scheme check refuses file and javascript', () => {
  const grant = newGrant()
  expect(decide(config, { kind: 'navigate', url: 'file:///c:/x' }, 'model', grant).effect).toBe('deny')
  expect(decide(config, { kind: 'navigate', url: 'javascript:alert(1)' }, 'model', grant).effect).toBe('deny')
})

test('unlisted host asks before navigating', () => {
  const grant = newGrant()
  expect(decide(config, { kind: 'navigate', url: 'https://unknown.test/' }, 'model', grant).effect).toBe('confirm')
})

test('person actions pass without confirmation', () => {
  const grant = newGrant()
  expect(decide(config, { kind: 'click', ref: 't1' }, 'person', grant).effect).toBe('allow')
})

test('model reads pass, writes ask, submits always ask', () => {
  const grant = newGrant()
  expect(decide(config, { kind: 'scroll', dx: 0, dy: 2 }, 'model', grant).effect).toBe('allow')
  expect(decide(config, { kind: 'fill', ref: 't1', text: 'x' }, 'model', grant).effect).toBe('confirm')
  const once = configOf({ writePolicy: 'once' })
  expect(decide(once, { kind: 'fill', ref: 't1', text: 'x' }, 'model', grant).effect).toBe('confirm')
  grant.onceWritten = true
  expect(decide(once, { kind: 'fill', ref: 't1', text: 'x' }, 'model', grant).effect).toBe('allow')
  expect(decide(once, { kind: 'press', key: 'Enter' }, 'model', grant).effect).toBe('confirm')
})

test('auto and session grant allow writes', () => {
  const grant = newGrant()
  grant.auto = true
  expect(decide(config, { kind: 'click', ref: 't1' }, 'model', grant).effect).toBe('allow')
  expect(decide(configOf({ writePolicy: 'auto' }), { kind: 'click', ref: 't1' }, 'model', newGrant()).effect).toBe('allow')
})

test('classification marks submits', () => {
  expect(classify({ kind: 'click', ref: 't1' }).submits).toBe(true)
  expect(classify({ kind: 'fill', ref: 't1', text: '' }).submits).toBe(false)
})
