// Merchant self-profile routes.
// Provides the authenticated merchant's own profile data
// (store name, owner name, wallet address, live on-chain balance,
// connection state, status).
// Per ADR 004 decision D3: merchant balance is no longer a custodial
// Postgres liability. This route reads the merchant's live PHPC balance
// directly from Horizon using the address in `merchant_wallets` (the
// custody source of truth from Phase 3 provisioning).
// All routes require `authMiddleware` + `requireRole('merchant')`.
import { Hono } from 'hono'
import { createServiceClient } from '../lib/supabase.js'
import { StellarClient, stroopsToDecimal } from '../services/chain.client.js'
import { loadChainConfig } from '../lib/chain/config.js'
import type { Env } from '../types/env.js'
import type { AuthContext } from '../middleware/auth.js'

// Types

export interface MerchantSelfDTO {
  id: string
  storeName: string
  ownerName: string
  walletAddress: string | null
  // Live on-chain PHPC balance as a decimal string (7-decimal-safe).
  walletBalance: string
  connected: boolean
  status: string
}

// Helpers

// True when `address` matches the Stellar public/contract key shape.
export function isValidStellarAddress(address: string | null | undefined): boolean {
  if (!address) return false
  return /^[GC][A-Z2-7]{55}$/.test(address)
}

// Routes

const merchantSelfRoutes = new Hono<{
  Bindings: Env
  Variables: AuthContext
}>()

// GET /api/merchants/me
// Returns the authenticated merchant's self-profile DTO, including a live
// Horizon balance read.
// - 401 if unauthenticated (handled by middleware)
// - 403 if merchant profile not found for the authenticated user, or SUSPENDED
// - 502 if the merchant has a provisioned wallet but Horizon cannot be reached
merchantSelfRoutes.get('/', async (c) => {
  const user = c.get('user')

  if (!user) {
    return c.json({ error: 'auth', message: 'Authentication required' }, 401)
  }

  const db = createServiceClient()

  const { data: merchant, error } = await (db as any)
    .from('merchants')
    .select('id, store_name, owner_name, wallet_address, status')
    .eq('auth_user_id', user.id)
    .single()

  if (error || !merchant) {
    return c.json(
      { error: 'not_found', message: 'Merchant profile not found' },
      403,
    )
  }

  if (merchant.status === 'SUSPENDED') {
    return c.json(
      { error: 'forbidden', message: 'Merchant account has been suspended.' },
      403,
    )
  }

  // Resolve the custody source-of-truth address from merchant_wallets
  // rather than trusting the mirrored merchants.wallet_address column
  // alone, since the mirror could in principle drift (risk noted in the
  // runbook). Fall back to the mirror only if no merchant_wallets row
  // exists yet (e.g. provisioning has not run).
  const { data: walletRow } = await (db as any)
    .from('merchant_wallets')
    .select('address')
    .eq('merchant_id', merchant.id)
    .single()

  const walletAddress: string | null = walletRow?.address ?? merchant.wallet_address ?? null

  let walletBalance = '0.0000000'
  if (walletAddress && isValidStellarAddress(walletAddress)) {
    const chainConfigResult = loadChainConfig(process.env)
    if (chainConfigResult.isErr()) {
      return c.json(
        { error: 'onchain', message: 'Chain configuration unavailable' },
        502,
      )
    }
    const clientResult = await StellarClient.create(chainConfigResult.value)
    if (clientResult.isErr()) {
      return c.json(
        { error: 'onchain', message: 'Unable to reach the Stellar network' },
        502,
      )
    }
    const balanceResult = await clientResult.value.getAssetBalance(walletAddress)
    if (balanceResult.isErr()) {
      return c.json(
        { error: 'onchain', message: 'Failed to read on-chain balance' },
        502,
      )
    }
    walletBalance = stroopsToDecimal(balanceResult.value)
  }

  const dto: MerchantSelfDTO = {
    id: merchant.id,
    storeName: merchant.store_name,
    ownerName: merchant.owner_name,
    walletAddress,
    walletBalance,
    connected: isValidStellarAddress(walletAddress),
    status: merchant.status,
  }

  return c.json(dto)
})

export default merchantSelfRoutes
