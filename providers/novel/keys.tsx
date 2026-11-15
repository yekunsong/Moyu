/** Keyboard strip for the novel pane: posts the key and its modifier. */
export default function NovelKeys(
  props: { focused?: boolean },
  surface: {
    elements: Record<string, Function>
    onKey: (fn: (e: { key?: string; ctrl?: true }) => void) => () => void
    post: (data: unknown) => void
    state: { last?: string } | undefined
    setState: (s: { last?: string }) => void
  },
) {
  const { Text } = surface.elements as { Text: Function }

  surface.onKey(event => {
    const key = event.key ?? ''
    if (!key) return
    surface.post({ kind: 'key', key, ...(event.ctrl ? { ctrl: true } : {}) })
    surface.setState({ last: event.ctrl ? `ctrl+${key}` : key })
  })

  const hint = props.focused
    ? `↑↓ page · n/p chapter · a ask · ctrl+g hide${surface.state?.last ? ` · last ${surface.state.last}` : ''}`
    : 'click here to take the keyboard · Esc returns to the prompt'
  return Text({ key: 'keys', dimColor: true, color: 'inactive', children: hint })
}
