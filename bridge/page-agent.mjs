// Page-side code. Everything here is injected with Runtime.evaluate: a string
// holding a function body, called with the action/request as its argument.
// Keep it dependency-free and hold no state across reloads except the ref
// registry below, which is deliberately durable across snapshots.

export const INSTALL = String.raw`
(() => {
  if (globalThis.__transom) return 'installed'
  const state = {
    next: 1,
    // A document generation keeps refs from a previous navigation from
    // rebinding to a different element on the new page.
    gen: Math.random().toString(36).slice(2, 8),
    byRef: new Map(),
    refOf: new WeakMap(),
  }
  globalThis.__transom = state

  const refFor = el => {
    let ref = state.refOf.get(el)
    if (ref && state.byRef.get(ref) === el) return ref
    ref = state.gen + ':' + state.next++
    state.refOf.set(el, ref)
    state.byRef.set(ref, el)
    if (state.byRef.size > 5000) {
      const first = state.byRef.keys().next().value
      state.byRef.delete(first)
    }
    return ref
  }
  state.refFor = refFor

  const deepQueryAll = (root, selector, out = []) => {
    for (const el of root.querySelectorAll(selector)) out.push(el)
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) deepQueryAll(el.shadowRoot, selector, out)
    }
    return out
  }
  const deepQuery = (selector, root = document) => deepQueryAll(root, selector)[0] ?? null
  globalThis.__transomQuery = deepQuery
})()
`

export const SNAPSHOT = String.raw`
(async request => {
  const state = globalThis.__transom
  const chars = { used: 0 }
  const nodes = []
  const landmarks = []
  const seen = new Set()
  const maxNodes = Math.min(request.maxNodes || 400, 2000)
  const maxChars = Math.min(request.maxChars || 120000, 400000)
  const scope = request.scope === 'document' ? 'document' : 'viewport'

  const viewport = {
    cols: request.cols || 0,
    rows: request.rows || 0,
    scrollX: Math.round(window.scrollX),
    scrollY: Math.round(window.scrollY),
    width: window.innerWidth,
    height: window.innerHeight,
    docWidth: document.documentElement.scrollWidth,
    docHeight: document.documentElement.scrollHeight,
  }

  const INTERACTIVE = new Set(['BUTTON','A','INPUT','SELECT','TEXTAREA','SUMMARY','LABEL'])
  const BLOCK = new Set(['P','LI','TD','TH','H1','H2','H3','H4','H5','H6','PRE','BLOCKQUOTE','DD','DT','FIGCAPTION'])

  const explicitRole = el => el.getAttribute && el.getAttribute('role')
  const roleOf = el => {
    const explicit = explicitRole(el)
    if (explicit) return explicit
    const tag = el.tagName
    if (tag === 'A') return el.hasAttribute('href') ? 'link' : 'text'
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button'
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase()
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button'
      if (type === 'search') return 'searchbox'
      if (type === 'password') return 'textbox'
      if (type === 'range') return 'slider'
      if (type === 'file') return 'button'
      return 'textbox'
    }
    if (tag === 'SELECT') return el.multiple ? 'listbox' : 'combobox'
    if (tag === 'TEXTAREA') return 'textbox'
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') return 'heading'
    if (tag === 'IMG' || tag === 'PICTURE') return 'image'
    if (tag === 'NAV') return 'navigation'
    if (tag === 'MAIN') return 'main'
    if (tag === 'HEADER') return 'banner'
    if (tag === 'FOOTER') return 'contentinfo'
    if (tag === 'ASIDE') return 'complementary'
    if (tag === 'FORM') return 'form'
    if (tag === 'DIALOG') return 'dialog'
    if (tag === 'UL' || tag === 'OL') return 'list'
    if (tag === 'TABLE') return 'table'
    if (tag === 'TR') return 'row'
    if (tag === 'IFRAME') return 'iframe'
    if (el.isContentEditable) return 'textbox'
    if (tag === 'CANVAS' || tag === 'VIDEO' || tag === 'SVG') return 'img'
    if (BLOCK.has(tag)) return 'text'
    return ''
  }

  const isInteractive = el =>
    INTERACTIVE.has(el.tagName) ||
    el.isContentEditable ||
    (el.hasAttribute && (el.hasAttribute('onclick') || el.hasAttribute('tabindex'))) ||
    ['button','link','textbox','searchbox','checkbox','radio','combobox','listbox','slider','option','switch'].includes(explicitRole(el) || '')

  const isPassword = el =>
    el.tagName === 'INPUT' && String(el.getAttribute('type') || '').toLowerCase() === 'password'

  const nameOf = el => {
    const aria = el.getAttribute && el.getAttribute('aria-label')
    if (aria) return aria
    const labelledBy = el.getAttribute && el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ')
      if (text.trim()) return text
    }
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      const id = el.getAttribute('id')
      const label = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]') : null
      if (label) return label.textContent
      const wrapping = el.closest('label')
      if (wrapping) return wrapping.textContent
      const placeholder = el.getAttribute('placeholder')
      if (placeholder) return placeholder
      const title = el.getAttribute('title')
      if (title) return title
      // Never derive a password field's name from its value.
      if (el.tagName === 'INPUT' && !isPassword(el)) return el.value
    }
    const alt = el.getAttribute && el.getAttribute('alt')
    if (alt) return alt
    const title = el.getAttribute && el.getAttribute('title')
    if (title) return title
    const text = el.innerText || el.textContent || ''
    return text
  }

  const isVisible = el => {
    if (!el.isConnected) return false
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') return false
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    if (Number(style.opacity) === 0) return false
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return false
    if (scope === 'viewport') {
      if (rect.bottom < 0 || rect.right < 0) return false
      if (rect.top > window.innerHeight || rect.left > window.innerWidth) return false
      if (style.position === 'fixed' || style.position === 'sticky') return true
      // Elements clipped by an ancestor scroller: the intersection test above
      // already keeps those outside the viewport out.
    }
    return true
  }

  const valueOf = el => {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      if (isPassword(el)) return el.value ? '••••' : ''
      return el.value
    }
    return undefined
  }

  const stateOf = el => {
    const out = {}
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') out.disabled = true
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      out.checked = !!el.checked
    }
    const expanded = el.getAttribute('aria-expanded')
    if (expanded === 'true' || expanded === 'false') out.expanded = expanded === 'true'
    const selected = el.getAttribute('aria-selected')
    if (selected === 'true') out.selected = true
    if (el === document.activeElement) out.focused = true
    return Object.keys(out).length ? out : undefined
  }

  const push = (el, role, name, depth, kind) => {
    if (nodes.length >= maxNodes) return false
    const text = String(name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
    if (!text && role !== 'img' && role !== 'image') return true
    const rect = el.getBoundingClientRect()
    const node = {
      ref: state.refFor(el),
      role,
      name: text,
      depth,
      bounds: {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    }
    const value = valueOf(el)
    if (value !== undefined && value !== '') node.value = String(value).slice(0, 500)
    const st = stateOf(el)
    if (st) node.state = st
    if (el.tagName === 'BUTTON' && (el.getAttribute('type') || '').toLowerCase() === 'submit') node.submits = true
    if (el.tagName === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'submit') node.submits = true
    if (isInteractive(el)) node.interactive = true
    chars.used += node.name.length + (node.value?.length || 0)
    if (chars.used > maxChars) return false
    nodes.push(node)
    const landmark = ['navigation','main','banner','contentinfo','complementary','form','dialog','heading'].includes(role)
    if (landmark && landmarks.length < 24) landmarks.push({ role, name: text.slice(0, 80), ref: node.ref })
    return true
  }

  const walk = (root, depth) => {
    for (const el of root.children) {
      if (nodes.length >= maxNodes) return
      if (!isVisible(el)) continue
      const role = roleOf(el)
      if (role) {
        if (push(el, role, nameOf(el), depth, 'walk') === false) return
      }
      if (el.tagName === 'IFRAME') {
        // Same-origin frames are walked; a cross-origin one keeps its placeholder.
        let doc = null
        try {
          doc = el.contentDocument
        } catch {
          doc = null
        }
        if (doc?.body) walk(doc.body, depth + 1)
        continue
      }
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1)
      walk(el, depth + 1)
    }
  }

  walk(document.body || document.documentElement, 0)

  const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

  return {
    url: clean(location.href),
    title: clean(document.title),
    capturedAt: Date.now(),
    viewport,
    landmarks,
    nodes,
    truncated: {
      nodes: nodes.length >= maxNodes ? nodes.length : 0,
      chars: chars.used > maxChars ? chars.used : 0,
      scope,
    },
  }
})
`

export const ACT = String.raw`
(action => {
  const query = globalThis.__transomQuery
  const find = ref => {
    const el = globalThis.__transom?.byRef.get(ref)
    if (el && el.isConnected) return el
    return null
  }
  const center = el => {
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  const describe = el =>
    ((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || el.innerText || el.tagName)
      .toString().replace(/\s+/g, ' ').trim().slice(0, 80)

  if (action.kind === 'click' || action.kind === 'hover' || action.kind === 'scroll') {
    const el = action.ref ? find(action.ref) : null
    if (action.ref && !el) return { ok: false, stale: true, message: 'ref ' + action.ref + ' is stale; take a new snapshot' }
    if (el) {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      const point = center(el)
      const hit = document.elementFromPoint(point.x, point.y)
      const reachable = hit && (hit === el || el.contains(hit) || hit.contains(el))
      if (!reachable && action.kind !== 'scroll') {
        return {
          ok: false,
          changed: false,
          covered: true,
          message:
            'ref ' + action.ref + ' is covered by ' +
            (hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') : 'nothing') +
            ' at its center; scroll or close the overlay and retry',
        }
      }
      if (action.kind === 'click') {
        el.focus?.({ preventScroll: true })
        return { ok: true, changed: true, message: 'clicked ' + describe(el), at: point, element: el.tagName }
      }
      if (action.kind === 'hover') return { ok: true, changed: true, message: 'hovered ' + describe(el), at: point }
      return { ok: true, changed: true, message: 'scrolled to ' + describe(el), at: point }
    }
    return { ok: true, changed: true, at: { x: innerWidth / 2, y: innerHeight / 2 } }
  }

  if (action.kind === 'fill') {
    const el = find(action.ref)
    if (!el) return { ok: false, stale: true, message: 'ref ' + action.ref + ' is stale' }
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    el.focus({ preventScroll: true })
    const text = String(action.text ?? '')
    if (el.tagName === 'SELECT') {
      el.value = text
    } else if (el.isContentEditable) {
      el.textContent = text
    } else if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(el, text)
      else el.value = text
    } else {
      return { ok: false, changed: false, message: describe(el) + ' is not a text field' }
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, changed: true, message: 'filled ' + describe(el) }
  }

  if (action.kind === 'select') {
    const el = find(action.ref)
    if (!el) return { ok: false, stale: true, message: 'ref ' + action.ref + ' is stale' }
    el.scrollIntoView({ block: 'center' })
    el.value = String(action.value ?? '')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, changed: true, message: 'selected ' + action.value + ' in ' + describe(el) }
  }

  if (action.kind === 'focus') {
    const el = find(action.ref)
    if (!el) return { ok: false, stale: true, message: 'ref ' + action.ref + ' is stale' }
    el.focus({ preventScroll: true })
    return { ok: true, changed: true, message: 'focused ' + describe(el) }
  }

  return { ok: false, message: 'unknown kind ' + action.kind }
})
`
