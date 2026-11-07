import type { Ops } from '../../engine/ops'

import type { Action } from './contract'
import type { Hub, ViewRow } from '../../hub/hub'

const ROLE_GLYPH: Record<string, string> = {
  button: '▸', link: '↗', textbox: '▭', searchbox: '▭', checkbox: '☑', radio: '◉',
  combobox: '▾', listbox: '▾', heading: '#', image: '▣', img: '▣', text: '·',
  navigation: '≡', main: '‖', form: '⊞', dialog: '❐', row: '‐', iframe: '❐',
}

export async function pressRow(ops: Ops, hub: Hub, row: ViewRow): Promise<string | undefined> {
  // The pane draws an Input for textbox/searchbox rows; this ask is only the
  // fallback for a surface without an inline control.
  if (row.role === 'textbox' || row.role === 'searchbox') {
    const answer = await ops
      .ask(`New value for "${row.label}"? Type it under Other, or pick one of these.`, [
        'Keep current',
        'Clear field',
      ])
      .catch(() => undefined)
    if (answer === undefined || answer === 'Keep current') return undefined
    const text = answer === 'Clear field' ? '' : answer
    const { result } = await hub.act({ kind: 'fill', ref: row.ref, text }, 'person')
    return result.message
  }

  // A combobox/listbox with structured options gets an inline Select; the ask
  // path stays only for one without options.
  if ((row.role === 'combobox' || row.role === 'listbox') && !row.options?.length) {
    const answer = await ops
      .ask(`Which value for "${row.label}"? Type it under Other, or pick one of these.`, [
        'Keep current',
        'Clear selection',
      ])
      .catch(() => undefined)
    if (answer === undefined || answer === 'Keep current') return undefined
    const value = answer === 'Clear selection' ? '' : answer
    const { result } = await hub.act({ kind: 'select', ref: row.ref, value }, 'person')
    return result.message
  }

  const action: Action = { kind: 'click', ref: row.ref }
  const { result } = await hub.act(action, 'person')
  return result.message
}

export function glyphFor(row: ViewRow): string {
  return ROLE_GLYPH[row.role] ?? '·'
}
