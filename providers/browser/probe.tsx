/** Probe surface module: reports pointer and key events to the hooks module. */
export default function Probe(
  props: { ticks?: number },
  surface: {
    elements: Record<string, Function>
    onPointer: (fn: (e: PointerEvent) => void) => () => void
    onKey: (fn: (e: KeyEvent) => void) => () => void
    post: (data: unknown) => void
    columns: number
    rows: number
    state: { last: string } | undefined
    setState: (s: { last: string }) => void
  },
) {
  const { Box, Text } = surface.elements as {
    Box: Function
    Text: Function
  }

  surface.onPointer(ev => {
    surface.post({ type: ev.type, x: ev.fine?.x ?? ev.x, y: ev.fine?.y ?? ev.y })
    surface.setState({ last: `${ev.type} @ ${(ev.fine?.x ?? ev.x).toFixed(2)},${(ev.fine?.y ?? ev.y).toFixed(2)}` })
  })
  surface.onKey(ev => {
    surface.post({ type: 'key', key: ev.key ?? ev.name })
    surface.setState({ last: `key ${ev.key ?? ev.name ?? '?'}` })
  })

  const rows = Math.max(1, surface.rows)
  const cols = Math.max(1, surface.columns)
  const cells: unknown[] = []
  for (let y = 0; y < rows; y++) {
    let line = ''
    for (let x = 0; x < cols; x++) line += (x + y) % 10 === 0 ? '+' : '·'
    cells.push(Text({ key: `r${y}`, children: line }))
  }

  return Box(
    { key: 'root', flexDirection: 'column' },
    Text({ key: 'head', children: `cols ${cols} rows ${rows} ticks ${props.ticks ?? 0} ${surface.state?.last ?? ''}` }),
    ...cells,
  )
}

type PointerEvent = {
  type: string
  x: number
  y: number
  fine?: { x: number; y: number }
}
type KeyEvent = { key?: string; name?: string }
