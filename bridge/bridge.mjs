// Transom browser bridge. A supervised localhost HTTP service that owns one
// headless Chromium and speaks a narrow snapshot/act protocol to the plugin.
//
// stdout line 1 is the handshake: {"ready":true,"port":N}
// Every request carries `Authorization: Bearer <TRANSOM_TOKEN>`.
// Bind is 127.0.0.1 only; no Origin is accepted over the network.

import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

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
let browserProduct = 'unknown'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function launch() {
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
  chrome = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let stderr = ''
  chrome.stderr.on('data', chunk => {
    stderr = (stderr + String(chunk)).slice(-8000)
  })
  const portFile = join(profileDir, 'DevToolsActivePort')
  const deadline = Date.now() + 20000
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
  await evalInPage(INSTALL)
}

function cmd(method, params = {}, timeoutMs) {
  if (!sessionId) return Promise.reject(new Error('no page session'))
  return cdp.send(method, params, sessionId, timeoutMs)
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
  return evalInPage(
    `(${SNAPSHOT})(${JSON.stringify({ cols: VIEW_COLS, rows: VIEW_ROWS, ...request })})`,
  )
}

async function act(action) {
  const simpleKinds = ['click', 'hover', 'fill', 'select', 'focus']
  if (simpleKinds.includes(action.kind)) {
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
    return { ok: true, changed: true, message: `${action.kind} to ${entry.url}` }
  }
  if (action.kind === 'reload') {
    const settled = waitSettled()
    await cmd('Page.reload', {})
    await settled
    return { ok: true, changed: true, message: 'reloaded' }
  }
  return { ok: false, changed: false, message: `unknown action ${action.kind}` }
}

async function health() {
  const alive = !!cdp && !cdp.isClosed && chrome?.exitCode === null
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
    version: browserProduct,
    url: currentUrl,
    title,
    navigations,
    error: lastError,
  }
}

async function shot(request) {
  const width = Math.max(40, Math.min(Number(request.cols) || VIEW_COLS, 512))
  const height = Math.max(10, Math.min(Number(request.rows) || VIEW_ROWS, 256))
  await cmd('Emulation.setDeviceMetricsOverride', {
    width: width * CELL_W,
    height: height * CELL_H,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const captured = await cmd('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  })
  return { pngBase64: captured.data, cols: width, rows: height }
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
  'POST /stop': async () => {
    void shutdown(0)
    return { ok: true }
  },
}

const server = createServer(async (req, res) => {
  const auth = req.headers.authorization
  if (auth !== `Bearer ${TOKEN}`) {
    send(res, 401, { ok: false, error: 'unauthorized' })
    return
  }
  const key = `${req.method} ${new URL(req.url, 'http://x').pathname}`
  const route = ROUTES[key]
  if (!route) {
    send(res, 404, { ok: false, error: `no route ${key}` })
    return
  }
  try {
    const body = req.method === 'POST' ? await readBody(req) : {}
    const result = await route(body)
    send(res, 200, result)
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 1200)
    lastError = message
    send(res, 500, { ok: false, error: message })
  }
})

async function shutdown(code) {
  if (stopping) return
  stopping = true
  try {
    if (cdp && !cdp.isClosed) await cdp.send('Browser.close', {}, undefined, 3000).catch(() => {})
  } catch {
    /* ignore */
  }
  cdp?.close()
  if (chrome && chrome.exitCode === null) {
    try {
      chrome.kill()
    } catch {
      /* ignore */
    }
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

process.on('SIGTERM', () => void shutdown(0))
process.on('SIGINT', () => void shutdown(0))
process.on('uncaughtException', error => {
  process.stderr.write(String(error?.stack ?? error) + '\n')
  lastError = String(error?.message ?? error)
})
