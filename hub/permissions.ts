import type { Action } from '../providers/browser/contract'

export type WritePolicy = 'confirm' | 'once' | 'auto'

export type Config = {
  allowedHosts: string[]
  writePolicy: WritePolicy
  snapshotMaxChars: number
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
  return {
    allowedHosts: [...new Set([...LOCAL_HOSTS, ...hosts])],
    writePolicy: policy === 'once' || policy === 'auto' ? policy : 'confirm',
    snapshotMaxChars: Number.isFinite(maxChars) && maxChars > 500 ? Math.min(maxChars, 60000) : 12000,
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

const READ_KINDS = new Set(['scroll', 'hover', 'focus'])

export function classify(action: Action): Classification {
  if (action.kind === 'navigate') return { level: 'navigate', submits: true }
  if (action.kind === 'click' || action.kind === 'press' || action.kind === 'back' ||
      action.kind === 'forward' || action.kind === 'reload') {
    return { level: 'write', submits: true }
  }
  if (action.kind === 'fill' || action.kind === 'select') return { level: 'write', submits: false }
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
  auto: boolean
}

export function newGrant(): SessionGrant {
  return { onceWritten: false, hosts: new Set(), auto: false }
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
    if (!hostAllowed(config, url.hostname)) {
      return { effect: 'confirm', reason: `${url.hostname} is not on the allowed-hosts list` }
    }
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
    case 'fill':
      return `fill ${action.ref} with "${action.text.slice(0, 40)}"`
    case 'select':
      return `select ${action.value} in ${action.ref}`
    case 'press':
      return `press ${action.key}`
    case 'scroll':
      return `scroll ${action.dx},${action.dy}`
    case 'navigate':
      return `navigate to ${action.url}`
    default:
      return action.kind
  }
}
