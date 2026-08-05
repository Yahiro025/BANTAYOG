// Server-side Supabase client factory.
// BE1 owns this file. Re-exports the typed Supabase clients from @bantayog/db
// so the server uses the same typed clients as the rest of the monorepo.
// Per BANTAYOG_PROJECT_PLAN.md §5: canonical package is @supabase/supabase-js
// (the @supabase/ssr package is for the Next.js frontend; server uses supabase-js directly).
export {
  createServiceDbClient as createServiceClient,
  createUserDbClient as createUserClient,
  getServiceDbClient as getServiceClient,
} from '@bantayog/db'
