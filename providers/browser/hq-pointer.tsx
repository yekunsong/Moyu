/**
 * Pointer overlay for the HQ image: reports the cell an up-click landed on.
 * The hooks module maps that cell back to CSS pixels with the frame size.
 */
export default function HqPointer(
  _props: Record<string, never>,
  surface: {
    elements: Record<string, Function>
    onPointer: (fn: (e: { type?: string; x?: number; y?: number; button?: string }) => void) => () => void
    post: (data: unknown) => void
  },
) {
  const { Text } = surface.elements as { Text: Function }

  surface.onPointer(event => {
    if (event.type !== 'up') return
    if (typeof event.x !== 'number' || typeof event.y !== 'number') return
    surface.post({ kind: 'cell', x: event.x, y: event.y })
  })

  // Draw a blank line: the hint lives in the pane footer, not over the picture.
  return Text({ key: 'hint', children: ' ' })
}
