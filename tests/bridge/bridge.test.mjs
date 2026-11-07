import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { startDemo } from '../../demo/server.mjs'
import { findBrowser } from '../../bridge/paths.mjs'

const TOKEN = randomBytes(16).toString('hex')
let bridge
let base
let demo

function call(path, body) {
  return fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function json(path, body) {
  const response = await call(path, body)
  return { status: response.status, body: await response.json() }
}

before(async () => {
  demo = await startDemo(0)
  bridge = spawn(process.execPath, ['bridge/bridge.mjs'], {
    env: { ...process.env, TRANSOM_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  bridge.stderr.on('data', chunk => {
    stderr += String(chunk)
  })
  const first = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`bridge did not start: ${stderr}`)), 25000)
    bridge.stdout.on('data', chunk => {
      const line = String(chunk).split('\n')[0]
      if (!line.trim()) return
      clearTimeout(timer)
      resolve(line)
    })
    bridge.on('exit', code => reject(new Error(`bridge exited ${code}: ${stderr}`)))
  })
  const handshake = JSON.parse(first)
  assert.equal(handshake.ready, true, stderr)
  base = `http://127.0.0.1:${handshake.port}`
})

after(async () => {
  await call('/stop', {}).catch(() => {})
  bridge?.kill()
  demo?.server.close()
})

test('health reports a live browser', async () => {
  const { status, body } = await json('/health')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.match(body.version ?? '', /Chrome|Edge/i)
})

test('token is enforced', async () => {
  const response = await fetch(`${base}/health`)
  assert.equal(response.status, 401)
})

test('snapshot is structured and interactive refs exist', async () => {
  await json('/navigate', { url: demo.url })
  const { status, body } = await json('/snapshot', { scope: 'viewport', maxChars: 50000 })
  assert.equal(status, 200)
  assert.match(body.title, /Transom demo/)
  assert.ok(body.nodes.length > 10)
  const inc = body.nodes.find(node => node.name === 'Increase count')
  assert.ok(inc, 'increase button has an accessible name')
  assert.equal(inc.role, 'button')
  assert.ok(inc.interactive)
  assert.ok(body.landmarks.length > 0)
})

test('select options, link href and invalid state are in the snapshot', async () => {
  await json('/navigate', { url: demo.url })
  const snap = (await json('/snapshot', { scope: 'viewport', maxChars: 50000 })).body

  const plan = snap.nodes.find(node => node.role === 'combobox' && node.name === 'Plan')
  assert.ok(plan, 'Plan select present')
  assert.deepEqual(plan.options.map(option => option.value), ['free', 'team', 'enterprise'])
  assert.equal(plan.options.find(option => option.value === 'team').label, 'Team')
  assert.equal(plan.options.find(option => option.selected).value, 'free')

  const link = snap.nodes.find(node => node.role === 'link' && node.name.includes('Frame page'))
  assert.ok(link, 'Frame page link present')
  assert.match(link.href, /^https?:\/\/[^/]+\/frame\.html$/)

  const email = snap.nodes.find(node => node.role === 'textbox' && node.name === 'Email')
  assert.equal(email.invalid, true, 'required empty field is invalid')
})

test('a todo checkbox carries its checked state', async () => {
  await json('/navigate', { url: demo.url })
  const snap = (await json('/snapshot', { scope: 'viewport', maxChars: 50000 })).body
  const todo = snap.nodes.find(node => node.name === 'New todo')
  assert.ok(todo, 'todo input present')
  await json('/act', { action: { kind: 'fill', ref: todo.ref, text: 'Buy milk' } })
  const pressed = await json('/act', { action: { kind: 'press', key: 'Enter' } })
  assert.equal(pressed.body.ok, true)

  const after = (await json('/snapshot', { scope: 'viewport', maxChars: 50000 })).body
  const checkbox = after.nodes.find(node => node.role === 'checkbox' && node.name === 'Done: Buy milk')
  assert.ok(checkbox, 'todo checkbox present')
  assert.equal(checkbox.state.checked, false)
})

test('click, fill, select and submit work through refs', async () => {
  await json('/navigate', { url: demo.url })
  const snap = (await json('/snapshot', { maxChars: 50000 })).body
  const inc = snap.nodes.find(node => node.name === 'Increase count')
  await json('/act', { action: { kind: 'click', ref: inc.ref } })
  const afterClick = (await json('/snapshot', { maxChars: 50000 })).body
  const status = afterClick.nodes.find(node => node.role === 'status')
  assert.ok(status, 'the counter has a status role')
  assert.equal(status.name, '1')

  const email = afterClick.nodes.find(node => node.role === 'textbox' && node.name === 'Email')
  await json('/act', { action: { kind: 'fill', ref: email.ref, text: 'a@b.c' } })
  const filled = (await json('/snapshot', { maxChars: 50000 })).body
  const filledEmail = filled.nodes.find(node => node.name === 'Email')
  assert.equal(filledEmail.value, 'a@b.c')
  assert.equal(filledEmail.invalid, undefined, 'a filled required field is no longer invalid')

  const plan = filled.nodes.find(node => node.role === 'combobox')
  await json('/act', { action: { kind: 'select', ref: plan.ref, value: 'team' } })

  const submit = (await json('/snapshot', { maxChars: 50000 })).body.nodes.find(
    node => node.role === 'button' && node.submits,
  )
  assert.ok(submit, 'a submit button is marked')
  const pressed = await json('/act', { action: { kind: 'click', ref: submit.ref } })
  assert.equal(pressed.body.ok, true)
})

test('clickAt clicks at viewport pixels and clamps out-of-bounds points', async () => {
  await json('/navigate', { url: demo.url })
  const snap = (await json('/snapshot', { maxChars: 50000 })).body
  const inc = snap.nodes.find(node => node.name === 'Increase count')
  assert.ok(inc, 'increase button present')
  const x = Math.round(inc.bounds.x + inc.bounds.w / 2)
  const y = Math.round(inc.bounds.y + inc.bounds.h / 2)

  const clicked = await json('/act', { action: { kind: 'clickAt', x, y } })
  assert.equal(clicked.status, 200)
  assert.equal(clicked.body.ok, true)
  assert.equal(clicked.body.changed, true)
  assert.match(clicked.body.message, /clicked /)
  assert.match(clicked.body.message, /Increase count/)

  const after = (await json('/snapshot', { maxChars: 50000 })).body
  const status = after.nodes.find(node => node.role === 'status')
  assert.equal(status.name, '1')

  const clamped = await json('/act', { action: { kind: 'clickAt', x: -50, y: -50 } })
  assert.equal(clamped.status, 200)
  assert.equal(clamped.body.ok, true)
  assert.match(clamped.body.message, /at 0,0$/)
})

test('shadow DOM and same-origin frames are reachable', async () => {
  await json('/navigate', { url: demo.url })
  const snap = (await json('/snapshot', { scope: 'document', maxChars: 200000 })).body
  assert.ok(snap.nodes.some(node => node.name.includes('Shadow counter') || node.name === '0'))
  assert.ok(snap.nodes.some(node => node.name === 'Frame button'))
})

test('password values are masked', async () => {
  await json('/navigate', { url: demo.url })
  const first = (await json('/snapshot', { scope: 'document', maxChars: 80000 })).body
  const field = first.nodes.find(node => node.name === 'Password')
  await json('/act', { action: { kind: 'fill', ref: field.ref, text: 'hunter2' } })
  const snap = (await json('/snapshot', { scope: 'document', maxChars: 80000 })).body
  const password = snap.nodes.find(node => node.name === 'Password')
  assert.equal(password.value, '••••')
})

test('stale refs are reported, not clicked blindly', async () => {
  const snap = (await json('/snapshot', { maxChars: 50000 })).body
  const inc = snap.nodes.find(node => node.name === 'Increase count')
  await json('/navigate', { url: demo.url })
  await json('/navigate', { url: `${demo.url}frame.html` })
  const result = await json('/act', { action: { kind: 'click', ref: inc.ref } })
  assert.equal(result.body.ok, false)
  assert.equal(result.body.stale, true)
})

test('non-http schemes are refused', async () => {
  const { status, body } = await json('/navigate', { url: 'file:///C:/Windows/win.ini' })
  assert.equal(status, 500)
  assert.match(body.error, /scheme/i)
})

test('press dispatches keys', async () => {
  await json('/navigate', { url: demo.url })
  const snap = (await json('/snapshot', { maxChars: 50000 })).body
  const todo = snap.nodes.find(node => node.name === 'New todo')
  await json('/act', { action: { kind: 'click', ref: todo.ref } })
  const result = await json('/act', { action: { kind: 'press', key: 'Enter' } })
  assert.equal(result.body.ok, true)
})

test('raster returns packed cells at the requested size', async () => {
  await json('/navigate', { url: demo.url })
  const { status, body } = await json('/raster', { cols: 40, rows: 12 })
  assert.equal(status, 200)
  assert.equal(body.columns, 40)
  assert.equal(body.rows, 12)
  const bytes = Buffer.from(body.cells, 'base64')
  assert.equal(bytes.length, 40 * 12 * 12)
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, 40 * 12 * 3)
  assert.equal(words[0], 0x2584)
  assert.ok(words[1] <= 0xffffff)
  assert.ok(words[2] <= 0xffffff)
})

test('screenshot returns a PNG', async () => {
  await json('/navigate', { url: demo.url })
  const { status, body } = await json('/shot', { cols: 40, rows: 12 })
  assert.equal(status, 200)
  const bytes = Buffer.from(body.pngBase64, 'base64')
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
})

test('frame writes a real PNG file and prunes old generations', async () => {
  await json('/navigate', { url: demo.url })
  const first = await json('/frame', { cols: 40, rows: 12 })
  assert.equal(first.status, 200)
  assert.deepEqual(
    { columns: first.body.columns, rows: first.body.rows, pageWidth: first.body.pageWidth, pageHeight: first.body.pageHeight },
    { columns: 40, rows: 12, pageWidth: 320, pageHeight: 192 },
  )
  assert.ok(existsSync(first.body.file), 'the frame file exists')
  const bytes = readFileSync(first.body.file)
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG signature')

  const second = await json('/frame', { cols: 40, rows: 12 })
  assert.ok(second.body.generation > first.body.generation, 'generation increases')

  // Ten more captures prune the earliest file and keep at most ten.
  for (let i = 0; i < 10; i += 1) await json('/frame', { cols: 20, rows: 5 })
  const files = readdirSync(dirname(first.body.file)).filter(name => name.endsWith('.png'))
  assert.ok(files.length <= 10, `at most ten frames, saw ${files.length}`)
  assert.equal(existsSync(first.body.file), false, 'the oldest frame was pruned')
})

test('frame clamps the requested cell box and caps the pixel size', async () => {
  const tiny = await json('/frame', { cols: 2, rows: 1 })
  assert.equal(tiny.body.columns, 20)
  assert.equal(tiny.body.rows, 5)

  const big = await json('/frame', { cols: 400, rows: 400 })
  assert.equal(big.body.columns, 200)
  assert.equal(big.body.rows, 120)
  assert.ok(big.body.pageWidth <= 2000)
  assert.ok(big.body.pageHeight <= 1200)
  assert.equal(existsSync(big.body.file), true)
})

test('a javascript alert is accepted, recorded and does not block the page', async () => {
  await json('/navigate', { url: demo.url })
  const snap = (await json('/snapshot', { maxChars: 50000 })).body
  const alertButton = snap.nodes.find(node => node.name === 'Show alert')
  assert.ok(alertButton, 'alert button present')

  const clicked = await json('/act', { action: { kind: 'click', ref: alertButton.ref } })
  assert.equal(clicked.body.ok, true)
  assert.match(clicked.body.message, /dialog alert: demo alert/)

  // If the dialog were still open, this evaluation and the health title read
  // would hang or fail.
  const after = await json('/snapshot', { maxChars: 50000 })
  assert.equal(after.status, 200)
  assert.match(after.body.title, /Transom demo/)

  const health = (await json('/health')).body
  assert.equal(health.lastDialog.type, 'alert')
  assert.equal(health.lastDialog.message, 'demo alert')
})

test('wait finds an element that appears after a delay', async () => {
  await json('/navigate', { url: demo.url })
  const snap = (await json('/snapshot', { maxChars: 50000 })).body
  const later = snap.nodes.find(node => node.name === 'Append later')
  assert.ok(later, 'delayed button present')
  const clicked = await json('/act', { action: { kind: 'click', ref: later.ref } })
  assert.equal(clicked.body.ok, true)

  const waited = await json('/act', { action: { kind: 'wait', selector: '#later-node', timeoutMs: 3000 } })
  assert.equal(waited.status, 200)
  assert.equal(waited.body.ok, true)
  assert.equal(waited.body.changed, false)
  assert.match(waited.body.message, /found selector #later-node/)
})

test('wait returns ok false on a normal timeout', async () => {
  await json('/navigate', { url: demo.url })
  const started = Date.now()
  const waited = await json('/act', {
    action: { kind: 'wait', text: 'this text never appears anywhere', timeoutMs: 600 },
  })
  assert.equal(waited.status, 200)
  assert.equal(waited.body.ok, false)
  assert.equal(waited.body.changed, false)
  assert.match(waited.body.message, /lost|timeout/)
  assert.ok(Date.now() - started < 2500, 'timeout is clamped and does not hang')
})

test('wait resolves immediately for a selector already present', async () => {
  await json('/navigate', { url: demo.url })
  const waited = await json('/act', { action: { kind: 'wait', selector: '#inc', timeoutMs: 5000 } })
  assert.equal(waited.body.ok, true)
  assert.match(waited.body.message, /waited \d+ms: found selector #inc/)
})

test('refs do not rebind to elements on a new page', async () => {
  await json('/navigate', { url: demo.url })
  const first = (await json('/snapshot', { maxChars: 80000 })).body
  const inc = first.nodes.find(node => node.name === 'Increase count')
  await json('/navigate', { url: `${demo.url}frame.html` })
  const result = await json('/act', { action: { kind: 'click', ref: inc.ref } })
  assert.equal(result.body.ok, false)
  assert.equal(result.body.stale, true)
})

test('a covered target is reported, not clicked through', async () => {
  await json('/navigate', { url: demo.url })
  const snap = (await json('/snapshot', { scope: 'document', maxChars: 200000 })).body
  const pay = snap.nodes.find(node => node.name === 'Pay $500')
  assert.ok(pay, 'pay button present')
  const result = await json('/act', { action: { kind: 'click', ref: pay.ref } })
  assert.equal(result.body.ok, false)
  assert.equal(result.body.covered, true)
  assert.match(result.body.message, /covered/)
})

test('password fields stay masked regardless of attribute case or labels', async () => {
  await json('/navigate', { url: demo.url })
  let snap = (await json('/snapshot', { scope: 'document', maxChars: 200000 })).body
  const pin = snap.nodes.find(node => node.name === 'PIN')
  assert.ok(pin)
  await json('/act', { action: { kind: 'fill', ref: pin.ref, text: 'secret9' } })

  snap = (await json('/snapshot', { scope: 'document', maxChars: 200000 })).body
  const after = snap.nodes.find(node => node.name === 'PIN')
  assert.equal(after.value, '••••')
  assert.ok(!snap.nodes.some(node => node.name === 'secret9'), 'no password leaks as a name')
  assert.ok(!snap.nodes.some(node => node.value === 'secret9'))
})

// --- Attach mode -----------------------------------------------------------
// A second Chrome, started by the test exactly as a person would start one,
// plus a second bridge that must connect without owning it.

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitForVersion(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let last = 'not tried'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return await response.json()
      last = `status ${response.status}`
    } catch (error) {
      last = String(error?.message ?? error)
    }
    await sleep(150)
  }
  throw new Error(`Chrome did not expose port ${port}: ${last}`)
}

async function startAttachedBridge(extraEnv) {
  const token = randomBytes(16).toString('hex')
  const child = spawn(process.execPath, ['bridge/bridge.mjs'], {
    env: { ...process.env, TRANSOM_TOKEN: token, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += String(chunk)
  })
  const first = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`attached bridge did not start: ${stderr}`)), 25000)
    child.stdout.on('data', chunk => {
      const line = String(chunk).split('\n')[0].trim()
      if (!line) return
      clearTimeout(timer)
      resolve(line)
    })
    child.on('exit', code => reject(new Error(`attached bridge exited ${code}: ${stderr}`)))
  })
  const handshake = JSON.parse(first)
  if (!handshake.ready) throw new Error(handshake.error ?? stderr)
  const base = `http://127.0.0.1:${handshake.port}`
  const request = async (path, body) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  return { child, base, request }
}

// Chrome on Windows is a process tree; taskkill /T is the reliable way to
// leave nothing behind. On POSIX the child is spawned detached, so its pid is
// the process group.
async function killTree(child) {
  if (!child || child.pid === undefined || child.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      killer.once('error', resolve)
      killer.once('exit', resolve)
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

async function waitExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null) return
  await new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    child.once('exit', finish)
    setTimeout(finish, timeoutMs)
  })
}

test('attach mode mirrors a running Chrome and /stop leaves it alive', async () => {
  const port = await freePort()
  const profile = mkdtempSync(join(tmpdir(), 'transom-attach-test-'))
  const chrome = spawn(
    findBrowser(),
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' },
  )
  let attached
  try {
    const version = await waitForVersion(port)
    assert.match(version.Browser ?? '', /Chrome|Edge/i)

    attached = await startAttachedBridge({ TRANSOM_ATTACH_PORT: String(port) })
    const health = await attached.request('/health')
    assert.equal(health.body.ok, true)
    assert.equal(health.body.mode, 'attached', 'health reports attach mode')
    assert.equal(health.body.chrome, false, 'the bridge did not spawn Chrome')

    const navigated = await attached.request('/navigate', { url: demo.url })
    assert.equal(navigated.status, 200)

    const before = (await attached.request('/snapshot', { scope: 'viewport', maxChars: 50000 })).body
    assert.match(before.title, /Transom demo/)
    const inc = before.nodes.find(node => node.name === 'Increase count')
    assert.ok(inc, 'increase button present in the attached page')

    const clicked = await attached.request('/act', { action: { kind: 'click', ref: inc.ref } })
    assert.equal(clicked.body.ok, true)
    const afterClick = (await attached.request('/snapshot', { maxChars: 50000 })).body
    assert.equal(afterClick.nodes.find(node => node.role === 'status').name, '1')

    // A frame must not resize the person's window, and it maps clicks to the
    // real innerWidth/innerHeight rather than the requested cell box.
    const frame = await attached.request('/frame', { cols: 40, rows: 12 })
    assert.equal(frame.status, 200)
    assert.equal(existsSync(frame.body.file), true)
    assert.deepEqual([...readFileSync(frame.body.file).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
    const afterFrame = (await attached.request('/snapshot', { maxChars: 50000 })).body
    assert.equal(afterFrame.viewport.width, before.viewport.width, 'viewport width unchanged')
    assert.equal(afterFrame.viewport.height, before.viewport.height, 'viewport height unchanged')
    assert.equal(frame.body.pageWidth, before.viewport.width)
    assert.equal(frame.body.pageHeight, before.viewport.height)

    // /stop only detaches: Chrome must still answer on its debugging port.
    const stopped = await attached.request('/stop', {})
    assert.equal(stopped.body.ok, true)
    await waitExit(attached.child)
    await sleep(500)
    const still = await fetch(`http://127.0.0.1:${port}/json/version`)
    assert.equal(still.ok, true, 'the attached browser is still running')
    assert.ok((await still.json()).webSocketDebuggerUrl, 'its DevTools endpoint still answers')
  } finally {
    if (attached) {
      attached.child.kill()
      await waitExit(attached.child)
    }
    await killTree(chrome)
    await waitExit(chrome)
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 })
  }
})
