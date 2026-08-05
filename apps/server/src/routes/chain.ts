import { Hono } from 'hono'
import { StellarClient } from '../services/chain.client.js'
import { loadChainConfig } from '../lib/chain/config.js'
import { errorToHttpStatus, errorToResponseBody } from '../lib/errors.js'
import type { Env } from '../types/env.js'

const chainRoutes = new Hono<{ Bindings: Env; Variables: { user?: { id: string; email: string; role: string } | null } }>()

// GET /api/chain/balance
// Queries the Stellar Horizon network for an account's PHPC balance.
// Query params:
// - address?: Optional Stellar account ID. Defaults to issuer public key.
chainRoutes.get('/balance', async (c) => {
  const configResult = loadChainConfig(process.env)
  if (configResult.isErr()) {
    return c.json(errorToResponseBody(configResult.error), errorToHttpStatus(configResult.error))
  }

  const queryAddress = c.req.query('address')
  const targetAddress = queryAddress || configResult.value.issuerPublicKey

  const clientResult = await StellarClient.create(configResult.value)
  if (clientResult.isErr()) {
    return c.json(errorToResponseBody(clientResult.error), errorToHttpStatus(clientResult.error))
  }

  const balanceResult = await clientResult.value.getAssetBalance(targetAddress)

  return balanceResult.match(
    (balanceStroops) => {
      const whole = balanceStroops / 10_000_000n
      const fraction = (balanceStroops % 10_000_000n).toString().padStart(7, '0')
      return c.json({
        address: targetAddress,
        balanceStroops: balanceStroops.toString(),
        balance: `${whole}.${fraction}`,
      })
    },
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error)),
  )
})

// POST /api/chain/transfer
// This endpoint is being redesigned in a later migration phase
// (STELLAR_MIGRATION_RUNBOOK.md Phase 6/7). The former EVM-based arbitrary
// transfer from the deployer wallet has no direct Stellar equivalent in the
// new architecture.
chainRoutes.post('/transfer', async (c) => {
  return c.json(
    {
      error: 'not_implemented',
      message: 'This endpoint is being redesigned for the Stellar migration (Phase 6/7). Use allocateSubsidy or settlePurchase via their respective service flows.',
    },
    501,
  )
})

export default chainRoutes
