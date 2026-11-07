import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { startDemo } from '../../demo/server.mjs'

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
