import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', (_$, e, next) => next(e))
}
