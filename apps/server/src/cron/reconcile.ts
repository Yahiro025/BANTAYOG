import { createServiceClient } from '../lib/supabase.js'
import { StellarClient } from '../services/chain.client.js'
import { loadChainConfig } from '../lib/chain/config.js'
import { CustodialWalletService } from '../services/custodial-wallet.service.js'
import { BeneficiaryWalletRepository } from '../repositories/beneficiary-wallet.repository.js'
import { MerchantWalletRepository } from '../repositories/merchant-wallet.repository.js'
import { logger } from '../lib/logger.js'
import { TransactionService } from '../services/transaction.service.js'

export interface ReconcileResult {
  processed: number
  failed: number
}

// Shape of the `outbox.payload_jsonb` column for `TRANSACTION_CHAIN_SUBMIT`
// rows, written by the `settle_sale_and_enqueue` Postgres function
// (migration 00012). `amountStroops` and `totalCreditDeducted` travel
// through JSONB as strings/numbers — `amountStroops` MUST be converted with
// `BigInt(...)` before use, since raw JSONB values are never actual bigints
// at the JS boundary.
interface OutboxSettlementPayload {
  transactionId: string
  beneficiaryId: string
  merchantId: string
  amountStroops: string
  categoryTotals?: Record<string, number>
  totalCreditDeducted?: number
}

// Polling worker to process the transaction outbox and submit Stellar
// payments (fee-bumped beneficiary-to-merchant) serially.
// Per the runbook (Phase 5, step 3): builds a payment from the beneficiary
// account to the merchant account, signed through the custody service's
// short-lived key callback, wrapped in a fee-bump transaction paid by the
// sponsor account. The semantic outbox row contains identifiers and amounts,
// not secrets. Processing is serial (risk R3: sequence number collisions).
export async function runReconciliation(): Promise<ReconcileResult> {
  const db = createServiceClient()
  const cronLogger = logger.child({ requestId: 'cron-reconcile' })

  const configResult = loadChainConfig(process.env)
  if (configResult.isErr()) {
    cronLogger.error({ error: configResult.error.message, msg: 'Failed to load chain config' })
    return { processed: 0, failed: 0 }
  }

  const clientResult = await StellarClient.create(configResult.value)
  if (clientResult.isErr()) {
    cronLogger.error({ error: clientResult.error.message, msg: 'Failed to construct StellarClient' })
    return { processed: 0, failed: 0 }
  }

  const chainClient = clientResult.value
  const transactionService = new TransactionService(db)
  const custodialWalletService = new CustodialWalletService(configResult.value)
  const beneficiaryWalletRepo = new BeneficiaryWalletRepository(db)
  const merchantWalletRepo = new MerchantWalletRepository(db)

  // 1. Fetch PENDING outbox events (serial, up to 20 per run)
  const { data: pendingEvents, error: fetchError } = await (db as any)
    .from('outbox')
    .select('*')
    .eq('status', 'PENDING')
    .eq('kind', 'TRANSACTION_CHAIN_SUBMIT')
    .order('created_at', { ascending: true })
    .limit(100) // Batched up to 100 per ledger close

  if (fetchError) {
    cronLogger.error({ error: fetchError.message, msg: 'Failed to fetch pending outbox events' })
    return { processed: 0, failed: 0 }
  }

  if (!pendingEvents || pendingEvents.length === 0) {
    return { processed: 0, failed: 0 }
  }

  cronLogger.info({ count: pendingEvents.length, msg: 'Processing outbox events' })

  let processedCount = 0
  let failedCount = 0

  // BATCH PROCESSING ATTEMPT
  
  try {
    const purchases = []
    
    // Lock all and resolve accounts
    for (const event of pendingEvents) {
      await (db as any).from('outbox').update({ status: 'PROCESSING' }).eq('id', event.id)
      
      const payload = event.payload_jsonb as OutboxSettlementPayload
      const merchantWallets = await merchantWalletRepo.findBy('merchant_id', payload.merchantId, 1)
      const benWallets = await beneficiaryWalletRepo.findBy('beneficiary_id', payload.beneficiaryId, 1)
      
      if (!merchantWallets[0] || !benWallets[0]) throw new Error('Missing wallet')
      
      purchases.push({
        beneficiaryAccountId: benWallets[0].address,
        merchantAccountId: merchantWallets[0].address,
        amountStroops: BigInt(payload.amountStroops),
        beneficiarySigner: async (tx: any) => {
          await custodialWalletService.withDecryptedKey(payload.beneficiaryId, 'beneficiary', beneficiaryWalletRepo, async (kp) => { tx.sign(kp) })
        }
      })
    }

    const batchResult = await chainClient.settlePurchasesBatch(purchases)
    
    if (batchResult.isOk()) {
      const { hash: txHash, ledger } = batchResult.value
      cronLogger.info({ txHash, ledger, msg: `Batch Stellar payment confirmed for ${purchases.length} checkouts` })
      
      const eventIds = pendingEvents.map((e: any) => e.id)
      const txIds = pendingEvents.map((e: any) => (e.payload_jsonb as OutboxSettlementPayload).transactionId)
      
      await (db as any).from('outbox').update({ status: 'DONE', processed_at: new Date().toISOString() }).in('id', eventIds)
      await (db as any).from('transactions').update({ status: 'CONFIRMED', onchain_tx_hash: txHash, ledger_sequence: ledger, confirmed_at: new Date().toISOString() }).in('id', txIds)
      
      return { processed: pendingEvents.length, failed: 0 }
    } else {
      cronLogger.warn({ msg: 'Batch settlement returned error, falling back to serial processing', error: batchResult.error.message })
    }
  } catch (e: any) {
    cronLogger.warn({ msg: 'Batch settlement threw an exception, falling back to serial processing', error: e.message })
  }

  // FALLBACK: SERIAL PROCESSING

  for (const event of pendingEvents) {
    const payload = event.payload_jsonb as OutboxSettlementPayload
    const { transactionId, beneficiaryId, merchantId, amountStroops, totalCreditDeducted } = payload

    try {
      // Step 2: Mark outbox entry as PROCESSING
      const { error: lockError } = await (db as any)
        .from('outbox')
        .update({ status: 'PROCESSING' })
        .eq('id', event.id)

      if (lockError) {
        cronLogger.error({ eventId: event.id, error: lockError.message, msg: 'Failed to lock outbox event' })
        continue
      }

      // Step 3: Resolve merchant public address from the custody source of truth
      const merchantWallets = await merchantWalletRepo.findBy('merchant_id', merchantId, 1)
      if (merchantWallets.length === 0) {
        throw new Error(`Merchant wallet not found: ${merchantId}`)
      }
      const merchantAccountId = merchantWallets[0].address

      // Step 3b: Pre-check the merchant's trustline before submitting (risk
      // R1). A payment to an account without an authorized trustline fails
      // outright on Stellar, with no EVM equivalent.
      const merchantTrustlineResult = await chainClient.hasAuthorizedTrustline(merchantAccountId)
      if (merchantTrustlineResult.isErr()) {
        throw new Error(`Failed to check merchant trustline: ${merchantTrustlineResult.error.message}`)
      }
      if (!merchantTrustlineResult.value) {
        throw new Error(`Merchant account ${merchantAccountId} does not have an authorized PHPC trustline`)
      }

      // Step 3c: amountStroops travels through JSONB as a string; the chain
      // layer requires a real bigint. Convert explicitly rather than letting
      // BigInt arithmetic throw on a string operand.
      const amountStroopsBigInt = BigInt(amountStroops)

      // Step 4: Submit the Stellar payment via the custody callback.
      // The beneficiary signs via withDecryptedKey; the sponsor fee-bumps.
      cronLogger.info({
        transactionId,
        beneficiaryId,
        merchantAccountId: merchantAccountId.slice(0, 8) + '...',
        amountStroops,
        msg: 'Submitting fee-bumped Stellar payment',
      })

      const settleResult = await custodialWalletService.withDecryptedKey(
        beneficiaryId,
        'beneficiary',
        beneficiaryWalletRepo,
        async (keypair) => {
          return chainClient.settlePurchase({
            beneficiaryAccountId: keypair.publicKey(),
            beneficiarySecret: keypair.secret(),
            merchantAccountId,
            amountStroops: amountStroopsBigInt,
          })
        },
      )

      if (settleResult.isErr()) {
        throw new Error(settleResult.error.message)
      }

      // The callback returns AppResult from settlePurchase; unwrap it.
      const innerResult = settleResult.value
      if (innerResult.isErr()) {
        throw new Error(innerResult.error.message)
      }

      const { hash: txHash, ledger } = innerResult.value

      cronLogger.info({ transactionId, txHash, ledger, msg: 'Stellar payment confirmed' })

      // Step 5: Mark outbox DONE, update transaction to CONFIRMED with hash
      await (db as any)
        .from('outbox')
        .update({
          status: 'DONE',
          processed_at: new Date().toISOString(),
        })
        .eq('id', event.id)

      await (db as any)
        .from('transactions')
        .update({
          status: 'CONFIRMED',
          onchain_tx_hash: txHash,
          ledger_sequence: ledger,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', transactionId)

      processedCount++
    } catch (error: any) {
      cronLogger.error({
        eventId: event.id,
        transactionId,
        error: error.message,
        msg: 'Outbox transaction processing failed',
      })

      failedCount++
      const nextAttempts = event.attempts + 1
      const isPermanentlyFailed = nextAttempts >= 3

      await (db as any)
        .from('outbox')
        .update({
          status: isPermanentlyFailed ? 'FAILED' : 'PENDING',
          attempts: nextAttempts,
          last_error: error.message,
        })
        .eq('id', event.id)

      if (isPermanentlyFailed) {
        // Compensating action: restore beneficiary balance since the
        // Postgres deduction via settle_sale already happened but the
        // on-chain settlement permanently failed.
        const restoreAmount = Number(totalCreditDeducted ?? 0)
        if (restoreAmount > 0) {
          const restoreResult = await transactionService.restoreBeneficiaryBalance(
            beneficiaryId,
            restoreAmount,
            'On-chain Stellar transfer failed after 3 retry attempts',
          )
          if (restoreResult.isErr()) {
            cronLogger.error({
              eventId: event.id,
              transactionId,
              beneficiaryId,
              error: restoreResult.error.message,
              msg: 'Failed to restore beneficiary balance after permanent failure',
            })
          }
        }

        // Mark transaction as failed
        await (db as any)
          .from('transactions')
          .update({ status: 'FAILED' })
          .eq('id', transactionId)
      }
    }
  }

  return { processed: processedCount, failed: failedCount }
}
