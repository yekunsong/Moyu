// Writes .claude-plugin/icon.png (512x512 RGBA) with no dependencies.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const SIZE = 512
const pixels = Buffer.alloc(SIZE * SIZE * 4)

const rounded = (x, y, w, h, r) => {
  const cx = Math.min(Math.max(x, r), w - r)
  const cy = Math.min(Math.max(y, r), h - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

const put = (x, y, r, g, b, a = 255) => {
  const i = (y * SIZE + x) * 4
  pixels[i] = r
  pixels[i + 1] = g
  pixels[i + 2] = b
  pixels[i + 3] = a
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // Rounded dark tile.
    if (!rounded(x, y, SIZE, SIZE, 96)) continue
    const shade = 24 + Math.round((x / SIZE) * 10)
    put(x, y, shade, shade + 2, shade + 6)

    // A transom: a framed pane split by a mullion, warm light inside.
    const inset = 96
    const inner = x > inset && x < SIZE - inset && y > inset + 24 && y < SIZE - inset - 24
    if (inner) {
      const frame = x < inset + 22 || x > SIZE - inset - 22 || y < inset + 46 || y > SIZE - inset - 46
      const mullion = Math.abs(x - SIZE / 2) < 9
      const transomBar = y > inset + 24 + 120 && y < inset + 24 + 136
      if (frame || mullion || transomBar) put(x, y, 236, 226, 212)
      else {
        const glow = 1 - Math.hypot(x - SIZE * 0.35, y - SIZE * 0.62) / (SIZE * 0.8)
        put(x, y, 196, 84, 34 + Math.round(glow * 40))
      }
    }
  }
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = buffer => {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
header[8] = 8 // bit depth
header[9] = 6 // RGBA
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0 // filter none
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

writeFileSync('.claude-plugin/icon.png', png)
process.stdout.write(`icon ${SIZE}x${SIZE}, ${png.length} bytes\n`)
