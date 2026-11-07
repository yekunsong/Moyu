// Static server for the demo app. Bind 127.0.0.1 only, serve ./demo only.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)))
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

export function startDemo(port = 0) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const file = normalize(join(ROOT, path === '/' ? 'app.html' : path))
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden')
      return
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise(resolveListen => {
    server.listen(port, '127.0.0.1', () => {
      resolveListen({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/` })
    })
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const started = await startDemo(Number(process.env.PORT) || 8642)
  process.stdout.write(`demo on ${started.url}\n`)
}
