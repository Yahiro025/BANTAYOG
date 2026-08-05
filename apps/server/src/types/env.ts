// Hono environment bindings type.
// BE1 owns this file. All env vars consumed by the server are typed here.
// Chain vars target Stellar testnet per the Stellar migration.

export interface Env {
  // Supabase
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string

  // Auth / JWT
  JWT_SIGNING_SECRET: string
  QR_TOKEN_SECRET: string
  QR_TOKEN_TTL_SECONDS?: string

  // Upstash
  UPSTASH_REDIS_REST_URL: string
  UPSTASH_REDIS_REST_TOKEN: string

  // Vercel Cron
  CRON_SECRET: string

  // Gemini (BE2 owns)
  GEMINI_API_KEY: string
  GEMINI_VISION_MODEL?: string
  GEMINI_CONFIDENCE_THRESHOLD?: string

  // Stellar chain (active — consumed by chain/config.ts)
  STELLAR_HORIZON_URL: string
  STELLAR_NETWORK_PASSPHRASE: string
  PHPC_ASSET_CODE: string
  PHPC_ISSUER_PUBLIC_KEY: string
  PHPC_ISSUER_SECRET: string
  PHPC_DISTRIBUTION_SECRET: string
  STELLAR_SPONSOR_SECRET: string

  // Beneficiary custodial key encryption
  CUSTODIAL_KEY_ENCRYPTION_KEY: string

  // Optional
  CORS_ORIGIN?: string
  PORT?: string
}
