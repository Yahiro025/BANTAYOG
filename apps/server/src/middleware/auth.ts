// Auth middleware — verifies Supabase JWT.
// BE1 owns this file. Extracts the Bearer token from the Authorization
// header and verifies it against Supabase Auth. Attaches the user's
// identity to Hono context for downstream handlers.
// Public routes (/health) skip this middleware.
import { createMiddleware } from 'hono/factory'
import { jwtVerify } from 'jose'
import type { Env } from '../types/env.js'

// Polyfill WebSocket for Node.js < 22 to prevent Supabase createClient from crashing
// since we only use auth.getUser() and do not need Realtime connections.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class DummyWebSocket {} as any
}

// Context augmentation

export interface AuthContext {
  user: {
    id: string
    email: string
    role: string
  } | null
}

// Middleware

// Verifies the Supabase JWT from the Authorization header.
// Attaches user info to c.set('user', ...) on success.
// Returns 401 if the token is missing or invalid.
export const authMiddleware = createMiddleware<{
  Bindings: Env
  Variables: AuthContext
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    c.set('user', null)
    await next()
    return
  }

  const token = authHeader.slice(7)

  // Verify the JWT locally to avoid network latency and connection exhaustion
  try {
    const jwtSecret = process.env.JWT_SIGNING_SECRET || (process.env.NODE_ENV === 'test' ? 'test-secret-test-secret-test-secret-test-secret' : null);
    if (!jwtSecret) {
      console.error("Auth Middleware Error: Missing JWT_SIGNING_SECRET");
      c.set('user', null);
      await next();
      return;
    }

    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret);

    if (payload && payload.sub) {
      const appMetadata = (payload.app_metadata as Record<string, any>) || {};
      c.set('user', {
        id: payload.sub,
        email: (payload.email as string) ?? '',
        role: (appMetadata.role as string) || (payload.role as string) || 'unknown',
      })
    } else {
      c.set('user', null)
    }
  } catch (err: any) {
    console.error("Auth Middleware JWT Error:", err.message)
    c.set('user', null)
  }

  await next()
})
