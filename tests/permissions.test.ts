import { expect, test } from 'claude-code/testing'

import { classify, configOf, decide, hostAllowed, newGrant } from '../hub/permissions'

const config = configOf({ allowedHosts: 'example.com, *.example.org', writePolicy: 'confirm' })

test('hqDetail defaults to 2 and clamps to 1-3', () => {
  expect(configOf({}).hqDetail).toBe(2)
  expect(configOf({ hqDetail: 0 }).hqDetail).toBe(1)
  expect(configOf({ hqDetail: 9 }).hqDetail).toBe(3)
  expect(configOf({ hqDetail: 2.4 }).hqDetail).toBe(2)
  expect(configOf({ hqDetail: 'nope' }).hqDetail).toBe(2)
})

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

test('session grants override the config for navigation', () => {
  const grant = newGrant()
  grant.hosts.add('elsewhere.test')
  expect(decide(config, { kind: 'navigate', url: 'https://elsewhere.test/' }, 'model', grant)).toEqual({
    effect: 'allow',
    reason: 'host is allowed for this session',
  })

  grant.deniedHosts.add('example.com')
  expect(decide(config, { kind: 'navigate', url: 'https://example.com/' }, 'model', grant)).toEqual({
    effect: 'deny',
    reason: 'host is denied for this session',
  })
  // Deny outranks a config allowlist and the local default.
  grant.deniedHosts.add('localhost')
  expect(decide(config, { kind: 'navigate', url: 'http://localhost/' }, 'person', grant).effect).toBe('deny')

  // Wildcard grants match like the config allowlist.
  const wildcard = newGrant()
  wildcard.hosts.add('*.example.org')
  expect(decide(config, { kind: 'navigate', url: 'https://docs.example.org/' }, 'model', wildcard).effect).toBe('allow')
})

test('a link href is judged before a click runs', () => {
  const grant = newGrant()
  const click = { kind: 'click' as const, ref: 't5' }
  // A non-http scheme is denied even though the click itself is a valid write.
  expect(decide(config, click, 'model', grant, 'javascript:alert(1)').effect).toBe('deny')
  // A session-denied host never clicks.
  grant.deniedHosts.add('evil.test')
  expect(decide(config, click, 'model', grant, 'https://evil.test/x').effect).toBe('deny')
})

test('a person link click to an unlisted host asks too', () => {
  const decision = decide(config, { kind: 'click', ref: 't5' }, 'person', newGrant(), 'https://unknown.test/')
  expect(decision.effect).toBe('confirm')
  // A denied host still blocks the person.
  const grant = newGrant()
  grant.deniedHosts.add('unknown.test')
  expect(decide(config, { kind: 'click', ref: 't5' }, 'person', grant, 'https://unknown.test/').effect).toBe('deny')
})

test('an unlisted link destination is confirmed even under auto', () => {
  const grant = newGrant()
  grant.auto = true
  const decision = decide(
    configOf({ writePolicy: 'auto' }),
    { kind: 'clickAt', x: 10, y: 20 },
    'model',
    grant,
    'https://unknown.test/page',
  )
  expect(decision).toEqual({
    effect: 'confirm',
    reason: 'link to unknown.test is not on the allowed-hosts list',
  })
})

test('a listed link destination follows the write policy', () => {
  const click = { kind: 'click' as const, ref: 't5' }
  const confirmConfig = configOf({ allowedHosts: 'example.com', writePolicy: 'confirm' })
  expect(decide(confirmConfig, click, 'model', newGrant(), 'https://example.com/').effect).toBe('confirm')
  const autoConfig = configOf({ allowedHosts: 'example.com', writePolicy: 'auto' })
  expect(decide(autoConfig, click, 'model', newGrant(), 'https://example.com/').effect).toBe('allow')
  // A click submits, so `once` still asks after its first write.
  const grant = newGrant()
  grant.onceWritten = true
  const onceConfig = configOf({ allowedHosts: 'example.com', writePolicy: 'once' })
  expect(decide(onceConfig, click, 'model', grant, 'https://example.com/').effect).toBe('confirm')
})

test('session grants override the link allowlist', () => {
  const click = { kind: 'click' as const, ref: 't5' }
  const granted = newGrant()
  granted.hosts.add('elsewhere.test')
  expect(decide(configOf({ writePolicy: 'auto' }), click, 'model', granted, 'https://elsewhere.test/x').effect).toBe('allow')

  // A session deny outranks a config-allowed destination.
  const denied = newGrant()
  denied.deniedHosts.add('example.com')
  expect(decide(config, click, 'model', denied, 'https://example.com/').effect).toBe('deny')
})

test('classification marks submits', () => {
  expect(classify({ kind: 'check', ref: 't1' }).submits).toBe(false)
  expect(classify({ kind: 'uncheck', ref: 't1' }).level).toBe('write')
  expect(classify({ kind: 'click', ref: 't1' }).submits).toBe(true)
  expect(classify({ kind: 'fill', ref: 't1', text: '' }).submits).toBe(false)
})
