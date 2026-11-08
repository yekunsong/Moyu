// Transom browser bridge. A supervised localhost HTTP service that owns one
// headless Chromium and speaks a narrow snapshot/act protocol to the plugin.
//
// stdout line 1 is the handshake: {"ready":true,"port":N}
// Every request carries `Authorization: Bearer <TRANSOM_TOKEN>`.
// Bind is 127.0.0.1 only; no Origin is accepted over the network.

import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'

import { Cdp } from './cdp.mjs'
import { findBrowser } from './paths.mjs'
import { ACT, INSTALL, SNAPSHOT } from './page-agent.mjs'

const TOKEN = process.env.TRANSOM_TOKEN
if (!TOKEN) {
  process.stderr.write('TRANSOM_TOKEN is required\n')
  process.exit(2)
}
const MAX_BODY = 2 * 1024 * 1024
const VIEW_COLS = 110
const VIEW_ROWS = 34
const CELL_W = 8
const CELL_H = 16
// HQ captures render at a desktop width and physical density. The pane scales
// the result once; clicks still map through the CSS size, never the pixels.
const HQ_MIN_WIDTH = 1100
const HQ_MAX_WIDTH = 3840
const HQ_MAX_HEIGHT = 2560

let chrome
let cdp
let sessionId
let targetId
let profileDir
let stopping = false
let lastError = null
let currentUrl = 'about:blank'
let currentTitle = ''
let navigations = 0
let lastActivity = Date.now()
let browserProduct = 'unknown'
// `owned` means this process launched the browser and may close it. In attach
// mode the browser belongs to the person: `/stop` only detaches.
let owned = true
let mode = 'launched'
const ATTACH_PORT = Number(process.env.TRANSOM_ATTACH_PORT) || 0
// HQ frames are files the terminal reads itself: no byte payload crosses the
// plugin, and the terminal decodes the PNG at native density. At most ten are
// kept so a once-a-second refresh cannot fill the temp dir.
let frameDir
let frameGeneration = 0
const frameFiles = []
const FRAME_LIMIT = 10
// Chrome's screencast pushes frames; the newest overwrites one rolling file so
// a streamed refresh cannot fill the temp dir. `liveFrame` is the pane-facing
// answer for GET /frame?since; `frameBox` carries the cell box of the still
// that started the stream.
let liveFrame = null
let screencastOn = false
let screencastStarting = false
// A target that refused the screencast once is not asked again until the pane
// leaves image mode; the pane then falls back to one second stills.
let screencastRefused = false
let frameBox = { columns: VIEW_COLS, rows: VIEW_ROWS, pageWidth: 0, pageHeight: 0 }
// The most recent JavaScript dialog. The default policy is to accept alerts and
// dismiss confirm/prompt immediately, so a dialog never blocks the page.
let lastDialog = null
// Network tracking starts lazily on the first wait with idleMs; until then no
// Network domain events are delivered.
let networkTracking = false
let inFlight = 0
let networkQuietAt = Date.now()

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function sanitizeText(value, limit = 120) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

// Default dialog policy: alert is accepted, confirm/prompt are dismissed.
// Whatever the type, it is answered here so the page is never left blocked.
function handleDialog(params, sid) {
  if (sid !== undefined && sid !== sessionId) return
  const type = sanitizeText(params?.type, 40) || 'unknown'
  const message = sanitizeText(params?.message, 120)
  lastDialog = { type, message, at: Date.now() }
  const accept = type === 'alert'
  cmd('Page.handleJavaScriptDialog', { accept }).catch(() => {})
}

async function launch() {
  frameDir = mkdtempSync(join(tmpdir(), 'transom-frame-'))
  if (ATTACH_PORT) return await launchAttached(ATTACH_PORT)
  owned = true
  mode = 'launched'
  const exe = findBrowser()
  profileDir = mkdtempSync(join(tmpdir(), 'transom-profile-'))
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--hide-scrollbars',
    '--mute-audio',
    '--window-size=1280,800',
    'about:blank',
  ]
  // On POSIX `detached` makes Chrome its own process-group leader, so shutdown
  // can signal the whole tree (`-pid`) instead of risking orphaned renderers.
  // Windows has no process groups; it keeps Job-less `chrome.kill()` plus a
  // best-effort `taskkill /T /F` fallback.
  chrome = spawn(exe, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  let stderr = ''
  chrome.stderr.on('data', chunk => {
    stderr = (stderr + String(chunk)).slice(-8000)
  })
  const portFile = join(profileDir, 'DevToolsActivePort')
  const deadline = Date.now() + 7000
  let port
  while (Date.now() < deadline) {
    try {
      const text = readFileSync(portFile, 'utf8').split('\n')
      port = Number(text[0])
      const path = text[1]
      if (port && path) {
        cdp = await Cdp.connect(`ws://127.0.0.1:${port}${path}`)
        break
      }
    } catch {
      /* not written yet */
    }
    if (chrome.exitCode !== null) {
      throw new Error(`chrome exited (${chrome.exitCode}): ${stderr.slice(-600)}`)
    }
    await sleep(120)
  }
  if (!cdp) throw new Error('chrome did not expose a DevTools port')
  try {
    const info = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json())
    browserProduct = info.Browser ?? 'unknown'
  } catch {
    /* the label is cosmetic */
  }
  cdp.onClose(() => {
    if (!stopping) lastError = 'browser connection lost'
  })

  const created = await cdp.send('Target.createTarget', { url: 'about:blank' })
  targetId = created.targetId
  const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  sessionId = attached.sessionId
  await cmd('Page.enable')
  await cmd('Runtime.enable')
  await cmd('Log.enable')
  await cmd('Emulation.setDeviceMetricsOverride', {
    width: VIEW_COLS * CELL_W,
    height: VIEW_ROWS * CELL_H,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await cmd('Page.setLifecycleEventsEnabled', { enabled: true })
  cdp.on('Page.frameNavigated', (params) => {
    if (params.frame?.id !== undefined && params.frame.parentId === undefined) {
      currentUrl = params.frame.url
      navigations += 1
    }
  })
  cdp.on('Page.javascriptDialogOpening', handleDialog)
  cdp.on('Page.screencastFrame', handleScreencastFrame)
  await evalInPage(INSTALL)
}

// Connect to a Chrome the person already started with --remote-debugging-port.
// We never create a profile, spawn a process or resize the window: the page
// stays live in the person's browser, and `/stop` only detaches our session.
async function launchAttached(port) {
  const version = await fetchJsonFromChrome(port, '/json/version')
  const wsUrl = version.webSocketDebuggerUrl
  if (!wsUrl) throw new Error(`port ${port} did not expose a DevTools WebSocket`)
  cdp = await Cdp.connect(wsUrl)
  // From here on the browser is the person's: a later failure must detach,
  // never call Browser.close.
  owned = false
  mode = 'attached'
  browserProduct = version.Browser ?? 'unknown'
  cdp.onClose(() => {
    if (!stopping) lastError = 'browser connection lost'
  })

  const targets = await fetchJsonFromChrome(port, '/json/list')
  const pageTargets = targets.filter(target => target.type === 'page')
  const plainPages = pageTargets.filter(target => !isDevtoolsTarget(target))
  // Prefer a real http(s) tab, then any non-DevTools tab, then any page tab.
  const page =
    plainPages.find(target => /^https?:/i.test(target.url ?? '')) ??
    plainPages[0] ??
    pageTargets[0]
  if (page?.id) {
    targetId = page.id
  } else {
    const created = await cdp.send('Target.createTarget', { url: 'about:blank' })
    targetId = created.targetId
  }
  const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  sessionId = attached.sessionId
  await cmd('Page.enable')
  await cmd('Runtime.enable')
  await cmd('Log.enable')
  await cmd('Page.setLifecycleEventsEnabled', { enabled: true })
  cdp.on('Page.frameNavigated', (params) => {
    if (params.frame?.id !== undefined && params.frame.parentId === undefined) {
      currentUrl = params.frame.url
      navigations += 1
    }
  })
  cdp.on('Page.javascriptDialogOpening', handleDialog)
  cdp.on('Page.screencastFrame', handleScreencastFrame)
  await evalInPage(INSTALL)
  currentUrl = page?.url ?? 'about:blank'
  currentTitle = page?.title ?? ''
  // Warm the compositor: an attached window is often behind the terminal, and
  // without a forced frame the first hq capture can wait fifteen seconds for a
  // BeginFrame that occlusion-suppressed Chrome never sends.
  await cmd('Page.bringToFront').catch(() => {})
  await capturePng(1, 4000).catch(() => {})
}

function isDevtoolsTarget(target) {
  return /^(devtools|chrome|edge|about):/i.test(target.url ?? '')
}

async function fetchJsonFromChrome(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`)
  if (!response.ok) throw new Error(`${path} answered ${response.status}`)
  return await response.json()
}

function cmd(method, params = {}, timeoutMs) {
  if (!sessionId) return Promise.reject(new Error('no page session'))
  return cdp.send(method, params, sessionId, timeoutMs)
}

// Refs live on a page global that any document load wipes. Re-install it
// before work that depends on the registry: a reload or a page-driven
// navigation must not turn the next snapshot or click into a TypeError.
async function ensureInstalled() {
  const state = await evalInPage('globalThis.__transom ? "ok" : "missing"', false)
  if (state !== 'ok') await evalInPage(INSTALL)
}

async function evalInPage(expression, awaitPromise = true) {
  const result = await cmd('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  })
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
    throw new Error(`page: ${String(detail).slice(0, 400)}`)
  }
  return result.result?.value
}

const CHROME_KEYS = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  ' ': { key: ' ', code: 'Space', vk: 32, text: ' ' },
}

async function pressKey(spec) {
  const mods = (spec.modifiers || 0) | 0
  const mapped = CHROME_KEYS[spec.key]
  if (mapped) {
    const base = { key: mapped.key, code: mapped.code, windowsVirtualKeyCode: mapped.vk, nativeVirtualKeyCode: mapped.vk, modifiers: mods }
    await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
    if (mapped.text) await cmd('Input.dispatchKeyEvent', { type: 'char', ...base, text: mapped.text, unmodifiedText: mapped.text })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    return
  }
  const key = spec.key
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : key
  const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods }
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: key.length === 1 && mods === 0 ? key : undefined })
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

function checkUrl(raw) {
  let url
  try {
    url = new URL(raw, currentUrl)
  } catch {
    throw new Error(`bad URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`scheme ${url.protocol} is not allowed (http/https only)`)
  }
  return url.href
}

async function waitSettled(timeoutMs = 8000) {
  const done = new Promise(resolve => {
    const timer = setTimeout(() => {
      off()
      resolve('timeout')
    }, timeoutMs)
    const off = cdp.on('Page.loadEventFired', (params, sid) => {
      if (sid !== sessionId) return
      clearTimeout(timer)
      off()
      resolve('load')
    })
  })
  return done
}

async function navigate(url) {
  const settled = waitSettled()
  await cmd('Page.navigate', { url })
  await settled
  await sleep(120)
  await evalInPage(INSTALL).catch(() => {})
  currentUrl = url
}

async function snapshot(request) {
  await ensureInstalled()
  return evalInPage(
    `(${SNAPSHOT})(${JSON.stringify({ cols: VIEW_COLS, rows: VIEW_ROWS, ...request })})`,
  )
}

// Page-side wait: polls every 100ms until the selector matches or the body
// text appears, bounded by the (already clamped) timeout.
const PAGE_WAIT = String.raw`
(async spec => {
  const started = performance.now()
  const deadline = started + spec.timeoutMs
  const description = spec.selector
    ? 'selector ' + spec.selector
    : 'text ' + JSON.stringify(spec.text)
  let found = false
  while (true) {
    try {
      if (spec.selector) found = !!document.querySelector(spec.selector)
      else found = String(document.body ? document.body.innerText : '').includes(spec.text)
    } catch {
      found = false
    }
    if (found) break
    if (performance.now() >= deadline) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return { found, elapsedMs: Math.round(performance.now() - started), description }
})
`

function clampTimeout(value, fallback = 5000) {
  const ms = Number(value)
  const wanted = Number.isFinite(ms) && ms > 0 ? ms : fallback
  return Math.min(Math.max(wanted, 500), 10000)
}

// Enabled on demand: counting from Network events is only worth its overhead
// when someone waits for idle.
async function enableNetworkTracking() {
  if (networkTracking) return
  networkTracking = true
  networkQuietAt = Date.now()
  const note = sid => {
    if (sid !== undefined && sid !== sessionId) return false
    networkQuietAt = Date.now()
    return true
  }
  cdp.on('Network.requestWillBeSent', (params, sid) => {
    if (!note(sid)) return
    inFlight += 1
  })
  cdp.on('Network.loadingFinished', (params, sid) => {
    if (!note(sid)) return
    inFlight = Math.max(0, inFlight - 1)
  })
  cdp.on('Network.loadingFailed', (params, sid) => {
    if (!note(sid)) return
    inFlight = Math.max(0, inFlight - 1)
  })
  await cmd('Network.enable')
}

async function waitNetworkIdle(timeoutMs, idleMs) {
  await enableNetworkTracking()
  const started = Date.now()
  const idle = Math.max(100, Math.min(Number(idleMs) || 500, timeoutMs))
  while (true) {
    const elapsed = Date.now() - started
    if (inFlight === 0 && Date.now() - networkQuietAt >= idle) {
      return { ok: true, changed: false, message: `waited ${elapsed}ms: found network idle` }
    }
    if (elapsed >= timeoutMs) {
      return { ok: false, changed: false, message: `waited ${elapsed}ms: lost network idle (${inFlight} in flight)` }
    }
    await sleep(Math.min(100, Math.max(20, timeoutMs - elapsed)))
  }
}

async function actInner(action) {
  if (action.kind === 'wait') {
    const timeoutMs = clampTimeout(action.timeoutMs)
    if (action.selector || action.text) {
      const waited = await evalInPage(
        `(${PAGE_WAIT})(${JSON.stringify({ selector: action.selector, text: action.text, timeoutMs })})`,
      )
      const description = sanitizeText(waited?.description, 160)
      const elapsed = Math.round(Number(waited?.elapsedMs) || 0)
      const found = !!waited?.found
      return {
        ok: found,
        changed: false,
        message: `waited ${elapsed}ms: ${found ? 'found' : 'lost'} ${description}`.trim(),
      }
    }
    if (Number(action.idleMs) > 0) return await waitNetworkIdle(timeoutMs, action.idleMs)
    // A timeout is a normal result, not an error; a missing condition is not.
    return { ok: false, changed: false, message: 'wait requires selector, text or idleMs' }
  }
  const simpleKinds = ['click', 'hover', 'fill', 'select', 'focus', 'check', 'uncheck']
  if (simpleKinds.includes(action.kind)) {
    await ensureInstalled()
    const result = await evalInPage(`(${ACT})(${JSON.stringify(action)})`)
    if (result?.at) {
      const x = Math.round(result.at.x)
      const y = Math.round(result.at.y)
      if (action.kind === 'click') {
        await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
        await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
        await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
      } else if (action.kind === 'hover') {
        await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      }
    }
    await sleep(60)
    return result
  }
  if (action.kind === 'clickAt') {
    // CSS pixels in the page viewport: clamp first, then describe what the
    // point really hits so a misclick stays reviewable in the audit.
    const wanted = JSON.stringify({ x: Number(action.x), y: Number(action.y) })
    const hit = await evalInPage(`(() => {
      const wanted = ${wanted}
      const clamp = (value, max) => Math.max(0, Math.min(Math.round(Number.isFinite(value) ? value : 0), max - 1))
      const x = clamp(wanted.x, innerWidth)
      const y = clamp(wanted.y, innerHeight)
      const el = document.elementFromPoint(x, y)
      let desc = 'nothing'
      if (el) {
        const tag = el.tagName.toLowerCase()
        const id = el.id ? '#' + el.id : ''
        const aria = el.getAttribute && el.getAttribute('aria-label')
        const text = String(aria || el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()
        desc = (tag + id + (text ? ' ' + text : '')).slice(0, 80)
      }
      return { x, y, desc }
    })()`)
    await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hit.x, y: hit.y })
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', buttons: 1, clickCount: 1 })
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(60)
    return {
      ok: true,
      changed: true,
      message: `clicked ${hit.desc} at ${hit.x},${hit.y}`,
      at: { x: hit.x, y: hit.y },
      element: hit.desc,
    }
  }
  if (action.kind === 'press') {
    const el = await evalInPage(`(() => { const el = document.activeElement; return el ? el.tagName : null })()`)
    await pressKey(action)
    await sleep(80)
    return { ok: true, changed: true, message: `pressed ${action.key}${el ? ` in ${el}` : ''}` }
  }
  if (action.kind === 'scroll') {
    const dx = Math.round((action.dx || 0) * 80)
    const dy = Math.round((action.dy || 0) * 80)
    const point = await evalInPage('({ x: innerWidth / 2, y: innerHeight / 2 })')
    await cmd('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Math.round(point.x),
      y: Math.round(point.y),
      deltaX: dx,
      deltaY: dy,
    })
    await sleep(80)
    return { ok: true, changed: true, message: `scrolled ${action.dx || 0},${action.dy || 0}` }
  }
  if (action.kind === 'navigate') {
    const url = checkUrl(action.url)
    await navigate(url)
    return { ok: true, changed: true, message: `navigated to ${url}`, url }
  }
  if (action.kind === 'back' || action.kind === 'forward') {
    const history = await cmd('Page.getNavigationHistory')
    const delta = action.kind === 'back' ? -1 : 1
    const entry = history.entries[history.currentIndex + delta]
    if (!entry) return { ok: false, changed: false, message: `no history entry to go ${action.kind}` }
    const settled = waitSettled()
    await cmd('Page.navigateToHistoryEntry', { entryId: entry.id })
    await settled
    await evalInPage(INSTALL).catch(() => {})
    return { ok: true, changed: true, message: `${action.kind} to ${entry.url}` }
  }
  if (action.kind === 'reload') {
    const settled = waitSettled()
    await cmd('Page.reload', {})
    await settled
    await evalInPage(INSTALL).catch(() => {})
    return { ok: true, changed: true, message: 'reloaded' }
  }
  return { ok: false, changed: false, message: `unknown action ${action.kind}` }
}

// A dialog that was just answered is part of this action's story: a click that
// opened an alert should say so in its audit message.
const DIALOG_WINDOW_MS = 2000

async function act(action) {
  const result = await actInner(action)
  if (
    lastDialog &&
    Date.now() - lastDialog.at <= DIALOG_WINDOW_MS &&
    result &&
    typeof result.message === 'string'
  ) {
    result.message = `${result.message} (dialog ${lastDialog.type}: ${lastDialog.message})`
  }
  return result
}

async function health() {
  const alive = !!cdp && !cdp.isClosed && (!owned || chrome?.exitCode === null)
  let title = currentTitle
  if (alive) {
    try {
      title = await evalInPage('document.title', false)
    } catch {
      /* page busy */
    }
  }
  return {
    ok: alive,
    chrome: !!chrome,
    mode,
    version: browserProduct,
    url: currentUrl,
    title,
    navigations,
    error: lastError,
    lastDialog,
  }
}

const DECODE_PNG = String.raw`
(async args => {
  const image = new Image()
  image.src = 'data:image/png;base64,' + args.png
  await image.decode()
  const columns = args.columns
  const rows = args.rows
  const canvas = new OffscreenCanvas(columns, rows * 2)
  const context = canvas.getContext('2d')
  context.imageSmoothingEnabled = true
  context.drawImage(image, 0, 0, columns, rows * 2)
  const pixels = context.getImageData(0, 0, columns, rows * 2).data
  const words = new Uint32Array(columns * rows * 3)
  const at = (x, y) => (y * columns + x) * 4
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const top = at(x, y * 2)
      const bottom = at(x, y * 2 + 1)
      const bg = (pixels[top] << 16) | (pixels[top + 1] << 8) | pixels[top + 2]
      const fg = (pixels[bottom] << 16) | (pixels[bottom + 1] << 8) | pixels[bottom + 2]
      const index = (y * columns + x) * 3
      words[index] = 0x2584
      words[index + 1] = fg
      words[index + 2] = bg
    }
  }
  const bytes = new Uint8Array(words.buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return { cells: btoa(binary), columns, rows }
})
`

async function raster(request) {
  const width = Math.max(20, Math.min(Number(request.cols) || VIEW_COLS, 512))
  const height = Math.max(5, Math.min(Number(request.rows) || VIEW_ROWS, 256))
  // An attached browser belongs to the person: never resize its window. The
  // capture keeps the current viewport and is packed into the requested cells.
  if (owned) {
    await cmd('Emulation.setDeviceMetricsOverride', {
      width: width * CELL_W,
      height: height * CELL_H,
      deviceScaleFactor: 1,
      mobile: false,
    })
  }
  try {
    const captured = await capturePng()
    return await evalInPage(`(${DECODE_PNG})(${JSON.stringify({ png: captured.data, columns: width, rows: height })})`)
  } finally {
    if (owned) await restoreMetrics()
  }
}

// Chrome stops producing frames for an occluded window; the first capture after
// attach often waits for one that never comes. A single retry forces the next
// BeginFrame and almost always succeeds, so a minimised or covered window does
// not turn into a dead hq mode.
async function capturePng(attempt = 0, timeoutMs = undefined) {
  try {
    return await cmd(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false, fromSurface: true },
      timeoutMs,
    )
  } catch (error) {
    if (attempt >= 1) throw error
    return await capturePng(attempt + 1, timeoutMs)
  }
}

async function pageSize() {
  try {
    return await evalInPage('({ width: innerWidth, height: innerHeight })', false)
  } catch {
    return { width: VIEW_COLS * CELL_W, height: VIEW_ROWS * CELL_H }
  }
}

async function restoreMetrics() {
  await cmd('Emulation.setDeviceMetricsOverride', {
    width: VIEW_COLS * CELL_W,
    height: VIEW_ROWS * CELL_H,
    deviceScaleFactor: 1,
    mobile: false,
  }).catch(() => {})
}

async function shot(request) {
  const width = Math.max(40, Math.min(Number(request.cols) || VIEW_COLS, 512))
  const height = Math.max(10, Math.min(Number(request.rows) || VIEW_ROWS, 256))
  if (owned) {
    await cmd('Emulation.setDeviceMetricsOverride', {
      width: width * CELL_W,
      height: height * CELL_H,
      deviceScaleFactor: 1,
      mobile: false,
    })
  }
  try {
    const captured = await capturePng()
    const result = { pngBase64: captured.data, cols: width, rows: height }
    if (!owned) {
      const size = await pageSize()
      return { ...result, pageWidth: size.width, pageHeight: size.height }
    }
    return result
  } finally {
    if (owned) await restoreMetrics()
  }
}

function detailOf(value) {
  const detail = Math.round(Number(value ?? 2))
  if (!Number.isFinite(detail)) return 2
  return Math.min(3, Math.max(1, detail))
}

function positivePixels(value) {
  const pixels = Math.round(Number(value))
  return Number.isFinite(pixels) && pixels > 0 ? pixels : undefined
}

// Chrome stops the stream unless every frame is acknowledged, including frames
// that arrive after the pane left image mode. The newest frame overwrites the
// one rolling file; nothing accumulates on disk.
function handleScreencastFrame(params, sid) {
  if (sid !== undefined && sid !== sessionId) return
  const ack = params?.sessionId
  if (ack !== undefined) {
    cmd('Page.screencastFrameAck', { sessionId: ack }).catch(() => {})
  }
  if (!screencastOn || !frameDir || !params?.data) return
  const bytes = Buffer.from(params.data, 'base64')
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return
  const file = join(frameDir, 'live.png')
  try {
    writeFileSync(file, bytes)
  } catch {
    return
  }
  const metadata = params.metadata ?? {}
  frameGeneration += 1
  liveFrame = {
    file,
    generation: frameGeneration,
    columns: frameBox.columns,
    rows: frameBox.rows,
    // The metadata's device size is the CSS viewport; the PNG header carries
    // the (possibly downscaled) physical pixels. Clicks map through the CSS
    // size, exactly as they do for a still.
    pageWidth: positivePixels(metadata.deviceWidth) ?? frameBox.pageWidth,
    pageHeight: positivePixels(metadata.deviceHeight) ?? frameBox.pageHeight,
    pixelWidth: bytes.readUInt32BE(16),
    pixelHeight: bytes.readUInt32BE(20),
  }
}

// Started by the first POST /frame: the still is the reliable first frame, and
// the stream takes over from there. A target that refuses the screencast leaves
// the still path untouched and makes GET /frame answer `same`.
async function startScreencast(maxWidth, maxHeight) {
  if (screencastOn || screencastStarting || screencastRefused) return
  screencastStarting = true
  try {
    await cmd(
      'Page.startScreencast',
      {
        format: 'png',
        maxWidth: Math.max(1, positivePixels(maxWidth) ?? 1),
        maxHeight: Math.max(1, positivePixels(maxHeight) ?? 1),
        everyNthFrame: 2,
      },
      4000,
    )
    screencastOn = true
    screencastRefused = false
  } catch {
    screencastOn = false
    screencastRefused = true
  } finally {
    screencastStarting = false
  }
}

async function stopScreencast() {
  const wasOn = screencastOn || screencastStarting
  screencastOn = false
  screencastStarting = false
  screencastRefused = false
  liveFrame = null
  if (frameDir) {
    try {
      unlinkSync(join(frameDir, 'live.png'))
    } catch {
      /* never written */
    }
  }
  if (wasOn && cdp && !cdp.isClosed) await cmd('Page.stopScreencast', {}, 1000).catch(() => {})
}

// No long-polling: answer with the newest streamed frame when it is newer than
// `since`, otherwise say nothing changed.
function liveFrameAnswer(url) {
  const raw = Number(url?.searchParams?.get('since'))
  const since = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
  if (liveFrame && liveFrame.generation > since) return { ...liveFrame, same: false }
  // `streaming` lets the pane tell "nothing new yet" apart from "this target
  // cannot stream", and use the one-second still path in the latter case.
  return { same: true, generation: frameGeneration, streaming: screencastOn }
}

// A frame for the pane's image tier: written to a private PNG file and
// addressed by path, so the terminal reads exactly this capture. The CSS
// viewport keeps the cell box's aspect ratio, floored at a desktop width, and
// `deviceScaleFactor` multiplies the capture to the pane's physical density.
async function frame(request) {
  const columns = Math.max(20, Math.min(Number(request.cols) || VIEW_COLS, 200))
  const rows = Math.max(5, Math.min(Number(request.rows) || VIEW_ROWS, 120))
  let detail = detailOf(request.detail)
  let pageWidth = Math.max(columns * CELL_W, HQ_MIN_WIDTH)
  let pageHeight = Math.round((pageWidth * rows * CELL_H) / (columns * CELL_W))
  // Fit inside the pixel budget by dropping detail first; only then shrink the
  // width, deriving the height so the aspect ratio never changes.
  while (detail > 1 && (pageWidth * detail > HQ_MAX_WIDTH || pageHeight * detail > HQ_MAX_HEIGHT)) {
    detail -= 1
  }
  if (pageWidth * detail > HQ_MAX_WIDTH || pageHeight * detail > HQ_MAX_HEIGHT) {
    const scale = Math.min(HQ_MAX_WIDTH / (pageWidth * detail), HQ_MAX_HEIGHT / (pageHeight * detail))
    pageWidth = Math.max(columns * CELL_W, Math.floor(pageWidth * scale))
    pageHeight = Math.round((pageWidth * rows * CELL_H) / (columns * CELL_W))
  }
  if (owned) {
    await cmd('Emulation.setDeviceMetricsOverride', {
      width: pageWidth,
      height: pageHeight,
      deviceScaleFactor: detail,
      mobile: false,
    })
  }
  const captured = await capturePng()
  if (!owned) {
    // Attached: the capture is the person's real viewport at its natural
    // density, so the pane's click mapping must use that CSS size rather than
    // the requested cell box.
    const size = await pageSize()
    pageWidth = size.width
    pageHeight = size.height
  }
  const bytes = Buffer.from(captured.data, 'base64')
  // The PNG header carries the true capture size; report it rather than
  // trusting the requested metrics.
  const pixelWidth = bytes.readUInt32BE(16)
  const pixelHeight = bytes.readUInt32BE(20)
  frameGeneration += 1
  const file = join(frameDir, `f${frameGeneration}.png`)
  writeFileSync(file, bytes)
  frameFiles.push(file)
  while (frameFiles.length > FRAME_LIMIT) {
    const old = frameFiles.shift()
    try {
      unlinkSync(old)
    } catch {
      /* already gone */
    }
  }
  // The desktop viewport and its density deliberately stay in place: the pane
  // maps clicks through pageWidth/pageHeight, so reverting here would move the
  // page out from under the next click. /frame/stop restores them when the
  // pane leaves image mode.
  frameBox = { columns, rows, pageWidth, pageHeight }
  const maxWidth = owned ? pageWidth * detail : pixelWidth
  const maxHeight = owned ? pageHeight * detail : pixelHeight
  await startScreencast(maxWidth, maxHeight)
  return { file, generation: frameGeneration, columns, rows, pageWidth, pageHeight, pixelWidth, pixelHeight }
}

// Leaving image mode stops the stream, drops the rolling frame and returns the
// owned page to the cell-box viewport the other tiers assume; attach mode never
// changed the viewport.
async function stopFrame() {
  await stopScreencast()
  if (owned) await restoreMetrics()
  return { ok: true }
}

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

async function readBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const ROUTES = {
  'GET /health': async () => await health(),
  'POST /snapshot': async body => await snapshot(body),
  'POST /act': async body => await act(body.action ?? body),
  'POST /navigate': async body => {
    const url = checkUrl(body.url)
    await navigate(url)
    return { ok: true, url }
  },
  'POST /shot': async body => await shot(body),
  'POST /raster': async body => await raster(body),
  'POST /frame': async body => await frame(body),
  'GET /frame': async (_body, url) => liveFrameAnswer(url),
  'POST /frame/stop': async () => await stopFrame(),
  'POST /stop': async () => {
    void shutdown(0)
    return { ok: true }
  },
}

function tokenOk(header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice(7))
  const want = Buffer.from(TOKEN)
  if (given.length !== want.length) return false
  return timingSafeEqual(given, want)
}

const server = createServer(async (req, res) => {
  // The plugin's fetch sends no Origin. A browser page trying to reach the
  // loopback bridge always sends one; refuse it even with a leaked token.
  if (req.headers.origin !== undefined) {
    send(res, 403, { ok: false, error: 'origin not allowed' })
    return
  }
  if (!tokenOk(req.headers.authorization)) {
    send(res, 401, { ok: false, error: 'unauthorized' })
    return
  }
  const parsed = new URL(req.url, 'http://x')
  const key = `${req.method} ${parsed.pathname}`
  const route = ROUTES[key]
  if (!route) {
    send(res, 404, { ok: false, error: `no route ${key}` })
    return
  }
  try {
    if (req.method === 'POST' || key !== 'GET /health') lastActivity = Date.now()
    const body = req.method === 'POST' ? await readBody(req) : {}
    const result = await route(body, parsed)
    send(res, 200, result)
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 1200)
    lastError = message
    send(res, 500, { ok: false, error: message })
  }
})

// Stop a browser this process launched. Called only when `owned`: an attached
// browser belongs to the person and must survive `/stop`.
async function stopOwnedChrome() {
  if (!chrome || chrome.exitCode !== null) return
  const pid = chrome.pid
  if (process.platform === 'win32') {
    try {
      chrome.kill()
    } catch {
      /* already gone */
    }
    await sleep(300)
    // npm-level child trees (renderers, crashpad) can outlive chrome.exe;
    // taskkill is best effort and must never fail shutdown.
    try {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.on('error', () => {})
    } catch {
      /* taskkill unavailable */
    }
    return
  }
  // POSIX: the child is a process-group leader (spawned detached), so the
  // negative pid reaches Chrome and every renderer it started.
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    /* group already gone */
  }
  await sleep(800)
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    /* group already gone */
  }
}

async function shutdown(code) {
  if (stopping) return
  stopping = true
  // The stream ends before its frames disappear; a SIGTERM right after /stop
  // must not leave a temp dir or a screencast session behind.
  await stopScreencast()
  // Frames are ours alone: drop them now, so a SIGTERM right after /stop
  // cannot leave a temp dir behind. The Chrome profile waits for the child.
  if (frameDir) {
    try {
      rmSync(frameDir, { recursive: true, force: true, maxRetries: 2 })
    } catch {
      /* already gone */
    }
    frameDir = undefined
  }
  if (owned) {
    try {
      if (cdp && !cdp.isClosed) await cdp.send('Browser.close', {}, undefined, 3000).catch(() => {})
    } catch {
      /* ignore */
    }
    cdp?.close()
    await stopOwnedChrome()
  } else {
    // Attached: leave the person's browser exactly as it was. Detach our
    // flattened session (best effort) and drop the socket.
    try {
      if (cdp && !cdp.isClosed && sessionId) {
        await cdp.send('Target.detachFromTarget', { sessionId }, undefined, 1500).catch(() => {})
      }
    } catch {
      /* ignore */
    }
    cdp?.close()
  }
  setTimeout(() => {
    if (profileDir) rmSync(profileDir, { recursive: true, force: true, maxRetries: 2 })
    process.exit(code)
  }, 250)
}

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  try {
    await launch()
    process.stdout.write(JSON.stringify({ ready: true, port }) + '\n')
  } catch (error) {
    process.stderr.write(String(error?.stack ?? error) + '\n')
    send_to_stdout({ ready: false, error: String(error?.message ?? error) })
    void shutdown(1)
  }
})

function send_to_stdout(value) {
  process.stdout.write(JSON.stringify(value) + '\n')
}

// A bridge whose page nobody touches for ten minutes is recycled; health
// polls by the supervisor do not count as activity.
const idle = setInterval(() => {
  if (Date.now() - lastActivity > 10 * 60 * 1000) {
    process.stderr.write('bridge: idle for 10 minutes, stopping\n')
    void shutdown(0)
  }
}, 60 * 1000)
idle.unref?.()

process.on('SIGTERM', () => void shutdown(0))
process.on('SIGINT', () => void shutdown(0))
process.on('uncaughtException', error => {
  process.stderr.write(String(error?.stack ?? error) + '\n')
  lastError = String(error?.message ?? error)
})
