import type { Ops } from '../../engine/ops'

import type { Action } from './contract'
import type { Hub, ViewRow } from '../../hub/hub'

const ROLE_GLYPH: Record<string, string> = {
  button: '▸', link: '↗', textbox: '▭', searchbox: '▭', checkbox: '☑', radio: '◉',
  combobox: '▾', listbox: '▾', heading: '#', image: '▣', img: '▣', text: '·',
  navigation: '≡', main: '‖', form: '⊞', dialog: '❐', row: '‐', iframe: '❐',
}

export async function pressRow(ops: Ops, hub: Hub, row: ViewRow): Promise<string | undefined> {
  if (row.role === 'textbox' || row.role === 'searchbox') {
    const answer = await ops
      .ask(`Value for “${row.label}”? Type a new value under Other.`, [
        row.value ? `Keep “${row.value.slice(0, 40)}”` : 'Keep empty',
      ])
      .catch(() => undefined)
    if (answer === undefined) return undefined
    if (answer.startsWith('Keep ') || answer === (row.value ?? '')) return undefined
    const { result } = await hub.act({ kind: 'fill', ref: row.ref, text: answer }, 'person')
    return result.message
  }

  if (row.role === 'combobox' || row.role === 'listbox') {
    const answer = await ops
      .ask(`Choose an option for “${row.label}” (type the value under Other).`, ['Keep current'])
      .catch(() => undefined)
    if (answer === undefined || answer === 'Keep current') return undefined
    const { result } = await hub.act({ kind: 'select', ref: row.ref, value: answer }, 'person')
    return result.message
  }

  const action: Action = { kind: 'click', ref: row.ref }
  const { result } = await hub.act(action, 'person')
  return result.message
}

export function glyphFor(row: ViewRow): string {
  return ROLE_GLYPH[row.role] ?? '·'
}
