import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { formatUnits, parseUnits } from 'viem'
import { BlockchainClient } from '../services/chain.client.js'
import { loadChainConfig } from '../lib/chain/config.js'
import { createServiceClient } from '../lib/supabase.js'
import { errorToHttpStatus, errorToResponseBody } from '../lib/errors.js'
import type { Env } from '../types/env.js'

const chainRoutes = new Hono<{ Bindings: Env; Variables: { user?: { id: string; email: string; role: string } | null } }>()

const transferSchema = z.object({
  to: z.string().startsWith('0x').length(42, 'Invalid Ethereum address'),
  amount: z.number().positive('Amount must be positive'),
})

/**
 * GET /api/chain/balance
 * Queries Polygon Amoy (via viem) for any address's (or LGU admin wallet's) PHPC balance.
 *
 * Query params:
 *   - address?: Optional wallet address. Defaults to LGU_ADMIN_WALLET_ADDRESS.
 */
chainRoutes.get('/balance', async (c) => {
  const configResult = loadChainConfig(process.env)
  if (configResult.isErr()) {
    return c.json(errorToResponseBody(configResult.error), errorToHttpStatus(configResult.error))
  }

  const queryAddress = c.req.query('address')
  const targetAddress = queryAddress || configResult.value.lguAdminWallet

  if (!targetAddress) {
    return c.json({ error: 'bad_request', message: 'No target address provided and LGU_ADMIN_WALLET_ADDRESS is not set' }, 400)
  }

  const clientResult = await BlockchainClient.getOrCreate(configResult.value)
  if (clientResult.isErr()) {
    return c.json(errorToResponseBody(clientResult.error), errorToHttpStatus(clientResult.error))
  }

  const balanceResult = await clientResult.value.getCachedBalance(targetAddress)

  return balanceResult.match(
    (balanceWei) =>
      c.json({
        address: targetAddress,
        balance: balanceWei.toString(),
        formatted: formatUnits(balanceWei, 18),
      }),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error)),
  )
})

/**
 * POST /api/chain/transfer
 * Transfers PHPC tokens from the LGU treasury (server account) to a recipient.
 * Merchants may only transfer to their own registered wallet address.
 * Admins may transfer to any address.
 */
chainRoutes.post('/transfer', zValidator('json', transferSchema), async (c) => {
  const { to, amount } = c.req.valid('json')
  const user = c.get('user')

  // If merchant, verify they can only transfer to their own wallet
  if (user?.role === 'merchant') {
    const db = createServiceClient()
    const { data: merchant } = await (db as any)
      .from('merchants')
      .select('wallet_address')
      .eq('auth_user_id', user.id)
      .single()

    if (!merchant || merchant.wallet_address?.toLowerCase() !== to.toLowerCase()) {
      return c.json(
        { error: 'forbidden', message: 'Merchants may only transfer to their own registered wallet address' },
        403
      )
    }
  }

  const configResult = loadChainConfig(process.env)
  if (configResult.isErr()) {
    return c.json(errorToResponseBody(configResult.error), errorToHttpStatus(configResult.error))
  }

  const clientResult = await BlockchainClient.getOrCreate(configResult.value)
  if (clientResult.isErr()) {
    return c.json(errorToResponseBody(clientResult.error), errorToHttpStatus(clientResult.error))
  }

  const chainClient = clientResult.value
  const amountWei = parseUnits(String(amount), 18)

  const transferResult = await chainClient.transferPHPC(to, amountWei)
  if (transferResult.isErr()) {
    return c.json(errorToResponseBody(transferResult.error), errorToHttpStatus(transferResult.error))
  }

  const txHash = transferResult.value
  const receiptResult = await chainClient.waitForConfirmation(txHash)

  return receiptResult.match(
    (receipt) =>
      c.json({
        success: true,
        txHash,
        blockNumber: Number(receipt.blockNumber),
        to,
        amount,
      }),
    (error) => c.json(errorToResponseBody(error), errorToHttpStatus(error)),
  )
})

export default chainRoutes
