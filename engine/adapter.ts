// Narrow helpers over Ops. Everything else talks to these, so an engine API
// change lands in ops.ts and here alone.
import type { Ops } from './ops'

export async function fetchJson<T>(
  ops: Ops,
  url: string,
  token: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const response = await ops.fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(response.text) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      if (response.text) message = response.text.slice(0, 400)
    }
    throw new Error(message)
  }
  return JSON.parse(response.text) as T
}

export async function ask(ops: Ops, question: string, options: string[]): Promise<string | undefined> {
  try {
    return await ops.ask(question, options)
  } catch {
    return undefined
  }
}

export async function storeGet<T>(ops: Ops, key: string): Promise<T | undefined> {
  return (await ops.storeGet(key)) as T | undefined
}

export function storeSet(ops: Ops, key: string, value: unknown): Promise<void> {
  return ops.storeSet(key, value)
}
