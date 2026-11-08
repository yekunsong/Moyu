import type { Action } from '../providers/browser/contract'

export type WritePolicy = 'confirm' | 'once' | 'auto'

export type Config = {
  allowedHosts: string[]
  writePolicy: WritePolicy
  snapshotMaxChars: number
  /** HQ capture density, 1 (fast) to 3 (sharp). */
  hqDetail: number
}

export const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1']

export function configOf(options: Record<string, unknown>): Config {
  const rawHosts = String(options.allowedHosts ?? '')
  const hosts = rawHosts
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
  const policy = options.writePolicy
  const maxChars = Number(options.snapshotMaxChars)
  const detail = Math.round(Number(options.hqDetail))
  return {
    allowedHosts: [...new Set([...LOCAL_HOSTS, ...hosts])],
    writePolicy: policy === 'once' || policy === 'auto' ? policy : 'confirm',
    snapshotMaxChars: Number.isFinite(maxChars) && maxChars > 500 ? Math.min(maxChars, 60000) : 12000,
    hqDetail: Number.isFinite(detail) ? Math.min(Math.max(detail, 1), 3) : 2,
  }
}

export function hostAllowed(config: Config, host: string): boolean {
  const needle = host.toLowerCase()
  return config.allowedHosts.some(allowed => {
    if (allowed === needle) return true
    if (allowed.startsWith('*.')) return needle.endsWith(allowed.slice(1))
    return false
  })
}

export type Classification = {
  level: 'read' | 'write' | 'navigate'
  host?: string
  submits: boolean
}

const READ_KINDS = new Set(['scroll', 'hover', 'focus', 'wait'])

export function classify(action: Action): Classification {
  if (action.kind === 'navigate') return { level: 'navigate', submits: true }
  if (action.kind === 'click' || action.kind === 'clickAt' || action.kind === 'press' ||
      action.kind === 'back' || action.kind === 'forward' || action.kind === 'reload') {
    return { level: 'write', submits: true }
  }
  if (action.kind === 'fill' || action.kind === 'select' || action.kind === 'check' || action.kind === 'uncheck') {
    return { level: 'write', submits: false }
  }
  if (READ_KINDS.has(action.kind)) return { level: 'read', submits: false }
  return { level: 'write', submits: false }
}

export type Decision =
  | { effect: 'allow'; reason: string }
  | { effect: 'confirm'; reason: string }
  | { effect: 'deny'; reason: string }

export type SessionGrant = {
  onceWritten: boolean
  hosts: Set<string>
  deniedHosts: Set<string>
  auto: boolean
}

export function newGrant(): SessionGrant {
  return { onceWritten: false, hosts: new Set(), deniedHosts: new Set(), auto: false }
}

/** A session grant matches exactly, or by a `*.` wildcard suffix. */
export function grantMatches(grants: Set<string>, host: string): boolean {
  const needle = host.toLowerCase()
  for (const granted of grants) {
    if (granted === needle) return true
    if (granted.startsWith('*.') && needle.endsWith(granted.slice(1))) return true
  }
  return false
}

export function decide(
  config: Config,
  action: Action,
  actor: 'person' | 'model',
  grant: SessionGrant,
): Decision {
  const classification = classify(action)

  if (action.kind === 'navigate') {
    let url: URL
    try {
      url = new URL(action.url)
    } catch {
      return { effect: 'deny', reason: `not a URL: ${action.url}` }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { effect: 'deny', reason: `scheme ${url.protocol} is not allowed` }
    }
    // Session grants are the person's live word and outrank the config.
    if (grantMatches(grant.deniedHosts, url.hostname)) {
      return { effect: 'deny', reason: 'host is denied for this session' }
    }
    if (grantMatches(grant.hosts, url.hostname)) {
      return { effect: 'allow', reason: 'host is allowed for this session' }
    }
    if (!hostAllowed(config, url.hostname)) {
      return { effect: 'confirm', reason: `${url.hostname} is not on the allowed-hosts list` }
    }
    return { effect: 'allow', reason: 'host is on the allowed-hosts list' }
  }

  if (actor === 'person') {
    // The person sees the page; only scheme/host rules bind them.
    if (classification.level === 'navigate') {
      return { effect: 'allow', reason: 'person navigation' }
    }
    return { effect: 'allow', reason: 'person input' }
  }

  if (classification.level === 'read') return { effect: 'allow', reason: 'read-only' }

  if (grant.auto) return { effect: 'allow', reason: 'auto policy for this session' }

  if (config.writePolicy === 'auto') return { effect: 'allow', reason: 'auto policy' }
  if (config.writePolicy === 'once') {
    if (!grant.onceWritten) return { effect: 'confirm', reason: 'first write of this session' }
    if (classification.submits) return { effect: 'confirm', reason: 'submit action' }
    return { effect: 'allow', reason: 'write already granted' }
  }
  return {
    effect: 'confirm',
    reason: classification.submits ? 'submit action' : 'write action',
  }
}

export function describeAction(action: Action): string {
  switch (action.kind) {
    case 'click':
      return `click ${action.ref}`
    case 'check':
      return `check ${action.ref}`
    case 'uncheck':
      return `uncheck ${action.ref}`
    case 'fill':
      return `fill ${action.ref} (${action.text.length} chars)`
    case 'select':
      return `select ${action.value} in ${action.ref}`
    case 'clickAt':
      return `click at ${action.x},${action.y}`
    case 'press':
      return `press ${action.key}`
    case 'scroll':
      return `scroll ${action.dx},${action.dy}`
    case 'navigate':
      return `navigate to ${action.url}`
    case 'wait': {
      const parts: string[] = []
      if (action.selector) parts.push(`selector ${action.selector}`)
      if (action.text) parts.push(`text "${action.text}"`)
      if (action.idleMs) parts.push(`network idle ${action.idleMs}ms`)
      return `wait ${parts.join(' or ') || 'for nothing'}`
    }
    default:
      return action.kind
  }
}
