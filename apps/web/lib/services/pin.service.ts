// PIN Service — Argon2id hashing and verification.
// Config: memory cost 65536, iterations 3, parallelism 4.
// Pure async functions; each takes a SupabaseClient for DI pattern
// (unused here but kept for consistency with other services).

import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

// Argon2id parameters per spec.
const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

// Hash a 6-digit PIN with Argon2id.
export async function hashPin(pin: string): Promise<string> {
  return argon2Hash(pin, ARGON2_OPTIONS);
}

// Verify a PIN against a stored Argon2id hash.
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify(hash, pin, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
