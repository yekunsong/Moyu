// Path discovery and process-group portability. No browser is started: these
// checks only exercise the candidate list, so they run on every platform.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { candidates, findBrowser } from '../../bridge/paths.mjs'

const LINUX_PATHS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/bin/microsoft-edge',
]

const DARWIN_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

test('TRANSOM_CHROME wins over every other candidate', t => {
  const dir = mkdtempSync(join(tmpdir(), 'transom-paths-'))
  const exe = join(dir, process.platform === 'win32' ? 'fake-chrome.exe' : 'fake-chrome')
  writeFileSync(exe, process.platform === 'win32' ? '' : '#!/bin/sh\nexit 0\n')
  chmodSync(exe, 0o755)

  const previous = process.env.TRANSOM_CHROME
  t.after(() => {
    if (previous === undefined) delete process.env.TRANSOM_CHROME
    else process.env.TRANSOM_CHROME = previous
    rmSync(dir, { recursive: true, force: true })
  })

  // Set after import: discovery must read the variable at call time.
  process.env.TRANSOM_CHROME = exe
  assert.equal(findBrowser(), exe)
  assert.equal(candidates()[0], exe)
})

test('candidates cover the Linux and macOS install locations', t => {
  const previous = process.env.TRANSOM_CHROME
  delete process.env.TRANSOM_CHROME
  t.after(() => {
    if (previous !== undefined) process.env.TRANSOM_CHROME = previous
  })

  const list = candidates()
  assert.equal(list.includes(undefined), false)
  for (const path of [...LINUX_PATHS, ...DARWIN_PATHS]) {
    assert.ok(list.includes(path), `missing candidate ${path}`)
  }

  // Windows candidates stay first, after any TRANSOM_CHROME override.
  assert.equal(list[0], 'C:/Program Files/Google/Chrome/Application/chrome.exe')
})
