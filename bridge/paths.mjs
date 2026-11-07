import { existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Windows keeps its historical candidates first so an existing install is
// still the one the bridge picks. Paths for other platforms are harmless here
// because `findBrowser` tests each candidate with existsSync.
const WINDOWS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

const DARWIN = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

const LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/bin/microsoft-edge',
]

// Playwright's cache moved between versions and differs per platform; fall
// back to whatever chromium-* build is present there. Windows keeps the exact
// paths it always used.
function byGlob() {
  let root
  if (process.platform === 'win32') {
    root = join(homedir(), 'AppData/Local/ms-playwright')
  } else if (process.platform === 'darwin') {
    root = join(homedir(), 'Library/Caches/ms-playwright')
  } else {
    root = join(homedir(), '.cache/ms-playwright')
  }
  if (!existsSync(root)) return []
  const out = []
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith('chromium-')) continue
    if (process.platform === 'win32') {
      out.push(join(root, dir, 'chrome-win64/chrome.exe'))
      out.push(join(root, dir, 'chrome-win/chrome.exe'))
    } else if (process.platform === 'darwin') {
      out.push(join(root, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'))
      out.push(join(root, dir, 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'))
    } else {
      out.push(join(root, dir, 'chrome-linux64/chrome'))
      out.push(join(root, dir, 'chrome-linux/chrome'))
    }
  }
  return out
}

// Ordered discovery list. TRANSOM_CHROME is read at call time so a caller (or
// a test) can set it after this module was imported. Platform-specific paths
// that do not exist on the current OS are simply skipped by `findBrowser`.
export function candidates() {
  return [
    process.env.TRANSOM_CHROME,
    ...WINDOWS,
    ...DARWIN,
    ...LINUX,
    ...byGlob(),
  ].filter(Boolean)
}

export function findBrowser() {
  for (const candidate of candidates()) {
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
