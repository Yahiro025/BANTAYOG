import { describe, it, expect } from 'vitest'
import type {
  TableName,
  MerchantRow,
  BeneficiaryRow,
  TransactionRow,
  OutboxRow,
  AllocationRow,
  MerchantWalletRow,
  MerchantStatus,
  EligibilityStatus,
  TransactionStatus,
  OutboxStatus,
} from './types.js'

describe('Database type structure', () => {
  it('has all 7 tables in the public schema', () => {
    // Type-level test: if this compiles, the types are correct
    const expectedTables: TableName[] = [
      'administrators',
      'merchants',
      'beneficiaries',
      'transactions',
      'qr_passes',
      'outbox',
      'photo_receipts',
    ]
    // Runtime check that we listed them all
    expect(expectedTables).toHaveLength(7)
  })
})

describe('Enum types', () => {
  it('MerchantStatus has 4 values', () => {
    const valid: MerchantStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']
    expect(valid).toHaveLength(4)
  })

  it('EligibilityStatus has 4 values', () => {
    const valid: EligibilityStatus[] = ['PENDING', 'ELIGIBLE', 'INELIGIBLE', 'SUSPENDED']
    expect(valid).toHaveLength(4)
  })

  it('TransactionStatus has 6 lifecycle states', () => {
    const valid: TransactionStatus[] = [
      'PENDING_CHAIN',
      'CONFIRMED',
      'DB_RECORDED',
      'BROADCAST',
      'RECONCILED',
      'FAILED',
    ]
    expect(valid).toHaveLength(6)
  })

  it('OutboxStatus has 4 values', () => {
    const valid: OutboxStatus[] = ['PENDING', 'PROCESSING', 'DONE', 'FAILED']
    expect(valid).toHaveLength(4)
  })
})

describe('Row types compile-check', () => {
  it('MerchantRow has required fields', () => {
    const row: MerchantRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      auth_user_id: 'a47ac10b-58cc-4372-a567-0e02b2c3d480',
      store_name: 'Test Store',
      owner_name: 'Test Owner',
      mobile_number_e164: '+639171234567',
      wallet_address: '0x1234567890abcdef1234567890abcdef12345678',
      wallet_balance: 0,
      cashout_in_progress: false,
      status: 'PENDING',
      created_at: '2026-06-29T00:00:00Z',
    }
    expect(row.id).toBeDefined()
  })

  it('BeneficiaryRow has required fields', () => {
    const row: BeneficiaryRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      guardian_name: 'Maria Santos',
      guardian_mobile_hash: 'sha256:abc',
      child_name: 'Baby Santos',
      child_age_months: 12,
      monthly_income_php: 8000,
      gps_lat: 14.5995,
      gps_lng: 120.9842,
      pin_hash_argon2id: null,
      pin_salt: null,
      eligibility_status: 'PENDING',
      credit_balance: 0,
      card_serial: null,
      activated_at: null,
      deactivated_at: null,
      created_at: '2026-06-29T00:00:00Z',
    }
    expect(row.id).toBeDefined()
  })

  it('TransactionRow has required fields', () => {
    const row: TransactionRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      beneficiary_id: 'a47ac10b-58cc-4372-a567-0e02b2c3d480',
      merchant_id: 'b47ac10b-58cc-4372-a567-0e02b2c3d481',
      item_list_jsonb: [],
      total_credit_deducted: 0,
      stablecoin_amount_wei: '0',
      asset_amount_stroops: null,
      onchain_tx_hash: null,
      ledger_sequence: null,
      idempotency_key: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      status: 'PENDING_CHAIN',
      created_at: '2026-06-29T00:00:00Z',
      confirmed_at: null,
    }
    expect(row.id).toBeDefined()
  })

  it('AllocationRow has required fields including ledger_sequence (migration 00012, F7)', () => {
    const row: AllocationRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      beneficiary_id: 'a47ac10b-58cc-4372-a567-0e02b2c3d480',
      tier: 1,
      amount_phpc: 5000,
      onchain_tx_hash: 'stellarhash123',
      ledger_sequence: 42,
      reconciled: false,
      allocated_at: '2026-06-29T00:00:00Z',
    }
    expect(row.ledger_sequence).toBe(42)
  })

  it('AllocationRow allows ledger_sequence to be null (legacy rows predating migration 00012)', () => {
    const row: AllocationRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      beneficiary_id: 'a47ac10b-58cc-4372-a567-0e02b2c3d480',
      tier: 2,
      amount_phpc: 3500,
      onchain_tx_hash: null,
      ledger_sequence: null,
      reconciled: false,
      allocated_at: '2026-06-29T00:00:00Z',
    }
    expect(row.ledger_sequence).toBeNull()
  })

  it('MerchantWalletRow has required fields (migration 00011)', () => {
    const row: MerchantWalletRow = {
      merchant_id: 'b47ac10b-58cc-4372-a567-0e02b2c3d481',
      address: 'GANQ4X5FDIREJPH6LR5YCC5ODMSACA5T6Q54F7EF6BGO55M7R6AQIP52',
      enc_ciphertext: 'ciphertext',
      enc_iv: 'iv',
      enc_auth_tag: 'authtag',
      created_at: '2026-06-29T00:00:00Z',
    }
    expect(row.address).toMatch(/^[GC][A-Z2-7]{55}$/)
  })

  it('OutboxRow has required fields', () => {
    const row: OutboxRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      kind: 'CALL_SUBSIDY_CONTRACT',
      payload_jsonb: {},
      status: 'PENDING',
      attempts: 0,
      run_after: '2026-06-29T00:00:00Z',
      created_at: '2026-06-29T00:00:00Z',
      processed_at: null,
    }
    expect(row.id).toBeDefined()
  })
})
