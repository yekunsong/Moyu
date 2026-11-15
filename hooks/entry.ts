// The one hooks module. It is plain TypeScript on purpose: the host scans this
// file's source for the `$` calls the module makes, and the tools and command
// must be registered at call sites here. The pane's hooks live in main.tsx and
// are registered through registerPane.
import type { Register } from 'claude-code'

import { registerPane } from './main'
import { TOOL_SPECS } from './tools'

export const register: Register = (on, options) => {
  registerPane(on, options)
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    for (const spec of TOOL_SPECS) await $.tool.register(spec)
    await $.command.register({
      name: 'moyu',
      description:
        'Novel pane: open a file or directory under the library root, hide or show the pane (boss key), pick a theme, or close the book',
      argumentHint: '<path> | hide | show | theme <auto|mono|paper|ink> | close',
    })
    return next(e)
  })
}
