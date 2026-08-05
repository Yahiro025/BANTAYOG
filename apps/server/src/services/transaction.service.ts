import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TransactionStatus, OutboxStatus } from '@bantayog/db'
import { TransactionRepository } from '../repositories/transaction.repository.js'
import { type AppResult, ok, err, PersistenceError, ValidationError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

export class TransactionService {
  private db: SupabaseClient<Database>
  private transactionRepo: TransactionRepository

  constructor(db: SupabaseClient<Database>) {
    this.db = db
    this.transactionRepo = new TransactionRepository(db)
  }

  // Atomically creates a transaction and an outbox entry.
  async createTransaction(dto: {
    beneficiaryId: string
    merchantId: string
    items: any[]
    idempotencyKey: string
  }): Promise<AppResult<any>> {
    const totalCreditDeducted = dto.items.reduce((sum, item) => sum + Number(item.creditCost), 0)
    // Convert credits to wei (assuming 1 credit = 1 PHPC = 10^18 wei)
    const stablecoinAmountWei = (BigInt(totalCreditDeducted) * BigInt(10 ** 18)).toString()

    try {
      // 1. Check if transaction with this idempotency key already exists
      const { data: existingTx, error: findError } = await this.db
        .from('transactions')
        .select('*')
        .eq('idempotency_key', dto.idempotencyKey)
        .maybeSingle()

      if (findError) {
        return err(new PersistenceError(`Failed to check idempotency: ${findError.message}`, 'transactions'))
      }
      if (existingTx) {
        return ok(existingTx)
      }

      // 2. Insert transaction
      const newTx = await this.transactionRepo.insert({
        beneficiary_id: dto.beneficiaryId,
        merchant_id: dto.merchantId,
        item_list_jsonb: dto.items,
        total_credit_deducted: totalCreditDeducted,
        stablecoin_amount_wei: stablecoinAmountWei,
        idempotency_key: dto.idempotencyKey,
        status: 'PENDING_CHAIN',
        onchain_tx_hash: null,
        confirmed_at: null
      })

      // 3. Insert outbox entry for chain submission worker
      const { error: outboxError } = await (this.db as any)
        .from('outbox')
        .insert({
          kind: 'TRANSACTION_CHAIN_SUBMIT',
          payload_jsonb: {
            transactionId: newTx.id,
            beneficiaryId: newTx.beneficiary_id,
            merchantId: newTx.merchant_id,
            stablecoinAmountWei: newTx.stablecoin_amount_wei,
            // Whole-PHPC-credit amount (not wei) so any failure-handling code
            // (e.g. reconcile.ts's restoreBeneficiaryBalance safety net, Req
            // 7.10 / Task 11.3) can restore the exact deducted amount
            // without reconstructing it from wei.
            totalCreditDeducted
          },
          status: 'PENDING' as OutboxStatus
        })

      if (outboxError) {
        // Clean up the created transaction if outbox insertion failed
        await this.transactionRepo.deleteById(newTx.id)
        return err(new PersistenceError(`Failed to insert outbox entry: ${outboxError.message}`, 'outbox'))
      }

      return ok(newTx)
    } catch (error: any) {
      return err(new PersistenceError(`Transaction creation failed: ${error.message}`, 'transactions'))
    }
  }

  // Retrieves a single transaction by ID.
  async getTransaction(id: string): Promise<AppResult<any>> {
    try {
      const record = await this.transactionRepo.findById(id)
      if (!record) {
        return err(new ValidationError(`Transaction not found: ${id}`))
      }
      return ok(record)
    } catch (error: any) {
      return err(new PersistenceError(`Get transaction failed: ${error.message}`, 'transactions'))
    }
  }

  // Lists transactions with optional filters.
  async listTransactions(filters: {
    merchantId?: string
    beneficiaryId?: string
    status?: TransactionStatus
    page?: number
    limit?: number
    /**
     * When true, select only the privacy-safe analytics columns and skip the
     * beneficiary/merchant joins entirely, so no PII is ever read from the
     * database for this call. Used by `GET /api/transactions?summary=1`.
     */
    summary?: boolean
  } = {}): Promise<AppResult<{ data: any[]; count: number }>> {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 20
    const from = (page - 1) * limit
    const to = from + limit - 1

    const selectClause = filters.summary
      ? 'id, merchant_id, total_amount, status, created_at'
      : '*, beneficiaries(child_name, guardian_name, card_serial), merchants(store_name, owner_name, mobile_number_e164)'

    try {
      let query = this.db
        .from('transactions')
        .select(selectClause, { count: 'exact' })

      if (filters.merchantId) {
        query = query.eq('merchant_id', filters.merchantId)
      }
      if (filters.beneficiaryId) {
        query = query.eq('beneficiary_id', filters.beneficiaryId)
      }
      if (filters.status) {
        query = query.eq('status', filters.status)
      }

      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) {
        return err(new PersistenceError(`Failed to query transactions: ${error.message}`, 'transactions'))
      }

      return ok({
        data: data ?? [],
        count: count ?? 0
      })
    } catch (error: any) {
      return err(new PersistenceError(`List transactions failed: ${error.message}`, 'transactions'))
    }
  }

  // Updates transaction status.
  async updateStatus(
    id: string,
    status: TransactionStatus,
    extra: { onchainTxHash?: string | null; confirmedAt?: string | null } = {}
  ): Promise<AppResult<any>> {
    try {
      const updatePayload: any = { status }
      if (extra.onchainTxHash !== undefined) {
        updatePayload.onchain_tx_hash = extra.onchainTxHash
      }
      if (extra.confirmedAt !== undefined) {
        updatePayload.confirmed_at = extra.confirmedAt
      }

      const updated = await this.transactionRepo.updateById(id, updatePayload)
      return ok(updated)
    } catch (error: any) {
      return err(new PersistenceError(`Update transaction status failed: ${error.message}`, 'transactions'))
    }
  }

  // Compensating action (Requirement 7.10): restores a beneficiary's
// recorded `credit_balance` by `amount` and records the discrepancy for
// manual reconciliation.
// This is a defensive safety net. Today's live purchase route
// (`src/routes/transactions.ts`, Task 11.2) deducts the beneficiary's
// balance only *after* the on-chain PHPC transfer has already been
// confirmed, so the "transfer fails after balance was deducted" scenario
// described by Requirement 7.10 cannot currently occur on that path — the
// system prevents the inconsistency by construction rather than needing to
// repair it after the fact. This method exists so that any future or
// legacy code path which creates an outbox entry with the balance
// already deducted (the old deduct-then-settle ordering) still has a
// correct, reusable way to restore the balance and surface the
// discrepancy for manual review.
  async restoreBeneficiaryBalance(
    beneficiaryId: string,
    amount: number,
    reason: string
  ): Promise<AppResult<void>> {
    try {
      const { data: beneficiary, error: readError } = await (this.db as any)
        .from('beneficiaries')
        .select('credit_balance')
        .eq('id', beneficiaryId)
        .single()

      if (readError || !beneficiary) {
        return err(
          new PersistenceError(
            `Failed to read beneficiary balance for restoration: ${readError?.message ?? 'not found'}`,
            'beneficiaries'
          )
        )
      }

      const restoredBalance = Number(beneficiary.credit_balance) + amount

      const { error: updateError } = await (this.db as any)
        .from('beneficiaries')
        .update({ credit_balance: restoredBalance })
        .eq('id', beneficiaryId)

      if (updateError) {
        return err(
          new PersistenceError(`Failed to restore beneficiary balance: ${updateError.message}`, 'beneficiaries')
        )
      }

      const restoredAt = new Date().toISOString()

      // Record the discrepancy for manual reconciliation as a queryable
      // audit row in the outbox table, in addition to the structured log
      // below (immediate visibility for ops).
      const { error: auditError } = await (this.db as any)
        .from('outbox')
        .insert({
          kind: 'BALANCE_RESTORATION_AUDIT',
          payload_jsonb: {
            beneficiaryId,
            amount,
            reason,
            restoredAt
          },
          status: 'DONE' as OutboxStatus
        })

      if (auditError) {
        return err(
          new PersistenceError(`Failed to record balance restoration audit: ${auditError.message}`, 'outbox')
        )
      }

      logger.error({
        beneficiaryId,
        amount,
        reason,
        restoredAt,
        msg: 'Beneficiary balance restored after failed on-chain transfer (manual reconciliation required)'
      })

      return ok(undefined)
    } catch (error: any) {
      return err(new PersistenceError(`Balance restoration failed: ${error.message}`, 'beneficiaries'))
    }
  }
}

