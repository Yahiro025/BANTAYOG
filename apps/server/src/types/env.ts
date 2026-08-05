/**
 * Hono environment bindings type.
 *
 * BE1 owns this file. All env vars consumed by the server are typed here.
 * Chain vars target Polygon Amoy (chain ID 80002) per the
 * polygon-amoy-phpc-migration spec; Ronin/Saigon vars have been removed.
 */

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

  // Polygon Amoy chain (BE2 owns)
  POLYGON_AMOY_RPC_URL: string
  DEPLOYER_PRIVATE_KEY: string
  LGU_ADMIN_WALLET_ADDRESS: string

  // Beneficiary custodial key encryption (separate from any datastore)
  CUSTODIAL_KEY_ENCRYPTION_KEY: string

  // Deployed contract addresses (BE2 populates after deploy)
  PHPC_TOKEN_ADDRESS: string
  PHPC_SUBSIDY_ADDRESS: string
  // Retained: still read by apps/web (lib/chain/contracts.ts, lib/env.ts).
  // Not part of the PHPC/Amoy contract set introduced by this migration.
  BENEFICIARY_REGISTRY_ADDRESS: string
  MERCHANT_REGISTRY_ADDRESS: string

  // Deprecated: superseded by LGU_ADMIN_WALLET_ADDRESS. Still read by
  // apps/server/src/routes/chain.ts and apps/web/lib/env.ts pending the
  // BlockchainClient rewrite (Task 3.5) that migrates those call sites.
  LGU_TREASURY_ADDRESS?: string

  // Optional
  CORS_ORIGIN?: string
  PORT?: string
  // Admin analytics DPA export: the schema has no `district` column, so
  // every export row is grouped under this single configured label.
  LGU_DISTRICT_LABEL?: string
}
