// Environment variable resolution with sensible fallbacks for local dev.
// Server-side env vars are read from process.env. When a server-side var
// is missing, we fall back to its NEXT_PUBLIC_ counterpart (already in
// .env.local) so the backend works out of the box during development.
// Missing required vars throw with a clear message so the developer knows
// exactly what to add to .env.local.

import crypto from "crypto";

function getEnv(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

function requireEnv(name: string, hint?: string): string {
  const val = getEnv(name);
  if (val) return val;

  // Try NEXT_PUBLIC_ fallback
  const publicVal = getEnv(`NEXT_PUBLIC_${name}`);
  if (publicVal) return publicVal;

  throw new Error(
    `Missing required environment variable: ${name}. ` +
      (hint ? `Hint: ${hint}` : `Add it to apps/web/.env.local.`),
  );
}

// Supabase

export function getSupabaseUrl(): string {
  return requireEnv("SUPABASE_URL", "Use NEXT_PUBLIC_SUPABASE_URL as fallback");
}

export function getSupabaseServiceRoleKey(): string {
  return requireEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "Get this from Supabase Dashboard → Settings → API → service_role key",
  );
}

export function getSupabaseAnonKey(): string {
  return requireEnv("SUPABASE_ANON_KEY", "Use NEXT_PUBLIC_SUPABASE_ANON_KEY as fallback");
}

// Blockchain

export function getDeployerPrivateKey(): `0x${string}` {
  const key =
    getEnv("DEPLOYER_PRIVATE_KEY") ??
    // Soroban default account #0 — safe for local dev only
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  return key as `0x${string}`;
}

export function getPhpcTokenAddress(): `0x${string}` {
  return requireEnv(
    "PHPC_TOKEN_ADDRESS",
    "Use NEXT_PUBLIC_PHPC_TOKEN_ADDRESS after deploying contracts",
  ) as `0x${string}`;
}

export function getPhpcSubsidyAddress(): `0x${string}` {
  return requireEnv(
    "PHPC_SUBSIDY_ADDRESS",
    "Use NEXT_PUBLIC_PHPC_SUBSIDY_ADDRESS after deploying contracts",
  ) as `0x${string}`;
}

export function getBeneficiaryRegistryAddress(): `0x${string}` {
  return requireEnv(
    "BENEFICIARY_REGISTRY_ADDRESS",
    "Use NEXT_PUBLIC_BENEFICIARY_REGISTRY_ADDRESS after deploying contracts",
  ) as `0x${string}`;
}

export function getMerchantRegistryAddress(): `0x${string}` {
  return requireEnv(
    "MERCHANT_REGISTRY_ADDRESS",
    "Use NEXT_PUBLIC_MERCHANT_REGISTRY_ADDRESS after deploying contracts",
  ) as `0x${string}`;
}

// Auth / JWT

let _jwtSecret: string | undefined;
export function getJwtSecret(): string {
  const cached = _jwtSecret;
  if (cached !== undefined) return cached;
  const val = getEnv("JWT_SECRET");
  if (val) {
    _jwtSecret = val;
    return val;
  }
  // ponytail: generate a throwaway secret for local dev so the backend runs
  const jwtSecret = crypto.randomBytes(64).toString("hex") as string;
  _jwtSecret = jwtSecret;
  console.warn(
    "[env] JWT_SECRET not set — using a temporary random secret. " +
      "Add JWT_SECRET to .env.local for persistent sessions.",
  );
  return jwtSecret;
}

let _qrTokenSecret: string | undefined;
export function getQrTokenSecret(): string {
  const cached = _qrTokenSecret;
  if (cached !== undefined) return cached;
  const val = getEnv("QR_TOKEN_SECRET");
  if (val) {
    _qrTokenSecret = val;
    return val;
  }
  const qrSecret = crypto.randomBytes(64).toString("hex") as string;
  _qrTokenSecret = qrSecret;
  console.warn(
    "[env] QR_TOKEN_SECRET not set — using a temporary random secret. " +
      "Add QR_TOKEN_SECRET to .env.local for persistent QR tokens.",
  );
  return qrSecret;
}
