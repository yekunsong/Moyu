import { existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CANDIDATES = [
  process.env.TRANSOM_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

function byGlob() {
  const root = join(homedir(), 'AppData/Local/ms-playwright')
  if (!existsSync(root)) return []
  const out = []
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith('chromium-')) continue
    out.push(join(root, dir, 'chrome-win64/chrome.exe'))
    out.push(join(root, dir, 'chrome-win/chrome.exe'))
  }
  return out
}

export function findBrowser() {
  const all = [...CANDIDATES.filter(Boolean), ...byGlob()]
  for (const candidate of all) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    'No Chrome/Chromium/Edge found. Set TRANSOM_CHROME to an executable path.',
  )
}

export function browserVersion(exe) {
  try {
    const out = execFileSync(exe, ['--version'], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    })
    return out.trim()
  } catch {
    return 'unknown'
  }
}
