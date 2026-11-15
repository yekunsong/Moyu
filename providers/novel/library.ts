// Library guard and listing: only regular novels under the resolved root
// resolve, and `realPath` must stay inside it. No Node path module.
import type { Ops } from '../../engine/ops'

export const NOVEL_EXTS = new Set(['.txt', '.md', '.text'])

export type Resolved =
  | { ok: true; realPath: string; kind: string; size: number }
  | { ok: false; message: string }

export type NovelEntry = { name: string; realPath: string; kind: 'file' | 'dir' }

function separatorOf(root: string): string {
  return root.includes('\\') ? '\\' : '/'
}

function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]/.test(path)
}

/** Fold `.` and `..` in a POSIX or Windows path, keeping a leading root. */
export function foldPath(path: string): string {
  const sep = path.includes('\\') ? '\\' : '/'
  const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? ''
  const absolute = isAbsolute(path)
  const parts: string[] = []
  for (const part of path.slice(drive.length).split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0) parts.pop()
      continue
    }
    parts.push(part)
  }
  const body = parts.join(sep)
  if (drive) return `${drive}${sep}${body}`
  if (absolute) return `${sep}${body}`
  return body
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

/**
 * Resolve `input` (absolute or relative to `root`) and require it to stay
 * under the root once both are resolved. Files must carry a novel extension.
 */
export async function resolveInsideRoot(ops: Ops, root: string, input: string): Promise<Resolved> {
  const target = input.trim()
  if (!target) return { ok: false, message: 'empty path' }
  let rootStat
  try {
    rootStat = await ops.statPath(root, true)
  } catch {
    return { ok: false, message: `library root missing: ${root}` }
  }
  const rootReal = rootStat.realPath
  if (!rootReal) return { ok: false, message: `cannot resolve library root: ${root}` }
  const sep = separatorOf(rootReal)
  let stat
  if (isAbsolute(target)) {
    try {
      stat = await ops.statPath(target, true)
    } catch {
      return { ok: false, message: `not found: ${target}` }
    }
  } else {
    try {
      stat = await ops.statPath(`${rootReal}${rootReal.endsWith(sep) ? '' : sep}${target}`, true)
    } catch {
      // A path typed from the working directory often already carries the
      // root ("novels/ch1.txt"); try it as typed before giving up.
      try {
        stat = await ops.statPath(target, true)
      } catch {
        return { ok: false, message: `not found: ${target}` }
      }
    }
  }
  const realPath = stat.realPath
  if (!realPath) return { ok: false, message: `cannot resolve: ${target}` }
  const lowerRoot = rootReal.toLowerCase()
  const lowerReal = realPath.toLowerCase()
  if (lowerReal !== lowerRoot && !lowerReal.startsWith(lowerRoot + sep.toLowerCase())) {
    return { ok: false, message: `outside the library root: ${target}` }
  }
  if (stat.kind === 'file' && !NOVEL_EXTS.has(extension(realPath))) {
    return { ok: false, message: `not a novel file: ${target}` }
  }
  if (stat.kind !== 'file' && stat.kind !== 'dir') {
    return { ok: false, message: `not a file or directory: ${target}` }
  }
  return { ok: true, realPath, kind: stat.kind, size: stat.size }
}

/** Readable novels and directories directly under `dirRealPath`, by name. */
export async function listNovels(ops: Ops, root: string, dirRealPath: string): Promise<NovelEntry[]> {
  const sep = separatorOf(root)
  const entries = await ops.listDir(dirRealPath)
  const kept: NovelEntry[] = []
  for (const entry of entries) {
    if (entry.kind === 'dir') {
      kept.push({ name: entry.name, realPath: `${dirRealPath}${dirRealPath.endsWith(sep) ? '' : sep}${entry.name}`, kind: 'dir' })
    } else if (entry.kind === 'file' && NOVEL_EXTS.has(extension(entry.name))) {
      kept.push({ name: entry.name, realPath: `${dirRealPath}${dirRealPath.endsWith(sep) ? '' : sep}${entry.name}`, kind: 'file' })
    }
  }
  return kept.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
