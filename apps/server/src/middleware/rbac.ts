// RBAC middleware — role-based access control.
// BE1 owns this file. Provides a requireRole() helper that checks
// the authenticated user's role against the required role(s).
// Per BANTAYOG_PROJECT_PLAN.md §7:
// admin     → full CRUD on all tables
// merchant  → read/insert own transactions, verify QR tokens
// beneficiary → no app surface in v1 (QR card is the only interface)
import { createMiddleware } from 'hono/factory'
import type { AuthContext } from './auth.js'
import type { Env } from '../types/env.js'

// Returns a middleware that requires the user to have one of the specified roles.
// Must be used after authMiddleware.
// @example
// app.post('/api/beneficiaries', authMiddleware, requireRole('admin'), handler)
export function requireRole(...roles: string[]) {
  return createMiddleware<{
    Bindings: Env
    Variables: AuthContext
  }>(async (c, next) => {
    const user = c.get('user')

    if (!user) {
      return c.json({ error: 'auth', message: 'Authentication required' }, 401)
    }

    if (!roles.includes(user.role)) {
      return c.json(
        { error: 'auth', message: `Requires one of: ${roles.join(', ')}`, code: 'forbidden' },
        403,
      )
    }

    await next()
    return
  })
}
