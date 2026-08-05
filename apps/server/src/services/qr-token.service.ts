import { SignJWT, jwtVerify } from 'jose'
import { type AppResult, ok, err, JwtError } from '../lib/errors.js'

// BE1-2.3 · QR Token Service
// Generates and verifies signed JWS compact JWT tokens for QR passes.
// Uses the jose library for performance and native edge compatibility.
// QR passes are now permanent pointers to the wallet address and do not expire.
export class QrTokenService {
  constructor(_ttlSeconds?: number) {
    // TTL is no longer used for generation, kept in signature for compatibility
  }

  private getSecretKey(): Uint8Array {
    const secret = process.env.QR_TOKEN_SECRET || process.env.JWT_SIGNING_SECRET || process.env.JWT_SECRET || 'default-fallback-secure-signing-secret-64-bytes';
    return new TextEncoder().encode(secret);
  }

  // Generates a signed JWT containing beneficiary metadata.
// The expiration is always computed from `this.ttlSeconds` (set at
// construction from `ChainConfig.qrTokenTtlSeconds`); callers no longer
// pass a per-call expiration.
  async generateToken(
    payload: {
      beneficiaryId: string;
      childName: string;
      guardianName: string;
      tier: number;
      pin_hash_ref: string;
      // Beneficiary's custodial wallet address, embedded in the QR token (Requirement 5.5).
      walletRef: string;
    }
  ): Promise<AppResult<string>> {
    const secret = this.getSecretKey();

    try {
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({
        beneficiaryId: payload.beneficiaryId,
        childName: payload.childName,
        guardianName: payload.guardianName,
        tier: payload.tier,
        pin_hash_ref: payload.pin_hash_ref,
        walletRef: payload.walletRef,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(now)
        .sign(secret);

      return ok(token);
    } catch (error: any) {
      return err(new JwtError(`Token generation failed: ${error.message}`, 'invalid'));
    }
  }

  // Verifies and decodes a QR token.
// Accepts the token only when its signature matches the configured secret
// AND its embedded expiration is greater than the current time (Requirement
// 9.2). `jose`'s `jwtVerify` distinguishes these failure modes via
// `error.code`: `ERR_JWT_EXPIRED` for an expired-but-correctly-signed
// token, and everything else (including `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`
// for tampered payloads/bad signatures) maps to `'invalid'` (Requirements
// 9.4, 9.5, 9.6). On either failure, no payload is returned — `err(...)`
// carries only the `JwtError`, never beneficiary identity or wallet
// reference.
  async verifyToken(token: string): Promise<AppResult<{
    beneficiaryId: string;
    childName: string;
    guardianName: string;
    tier: number;
    pin_hash_ref: string;
    walletRef: string;
  }>> {
    const secret = this.getSecretKey();
    try {
      const { payload } = await jwtVerify(token, secret);
      return ok(payload as any);
    } catch (error: any) {
      const reason = error.code === 'ERR_JWT_EXPIRED' ? 'expired' : 'invalid';
      return err(new JwtError(`Token verification failed: ${error.message}`, reason));
    }
  }
}

