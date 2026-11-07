/** Keyboard strip for the Transom pane: posts normalised key events. */
export default function Keys(
  props: { focused?: boolean; pending?: string },
  surface: {
    elements: Record<string, Function>
    onKey: (fn: (e: { key?: string; name?: string }) => void) => () => void
    post: (data: unknown) => void
    columns: number
    state: { last?: string } | undefined
    setState: (s: { last?: string }) => void
  },
) {
  const { Text } = surface.elements as { Text: Function }

  surface.onKey(event => {
    const key = event.key ?? event.name ?? ''
    if (!key) return
    surface.post({ kind: 'key', key })
    surface.setState({ last: key })
  })

  const hint = props.focused
    ? `keys → page  ${surface.state?.last ? `· last ${surface.state.last}` : ''}`
    : 'click here to take the keyboard · Esc returns to the prompt'
  return Text({ key: 'keys', dimColor: !props.focused, children: hint })
}
