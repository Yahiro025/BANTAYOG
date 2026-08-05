import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  toBeneficiaryDTO,
  toMerchantDTO,
  toTransactionDTO,
  toClassificationDTO,
  toBalanceDTO
} from './mappers.js'

describe('DTO Mappers Snapshot Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-02T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should correctly map a beneficiary record', () => {
    const rawBeneficiary = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      guardian_name: 'Maria Santos',
      guardian_mobile_hash: 'hash123',
      child_name: 'Jose Santos',
      child_age_months: 6,
      monthly_income_php: 15000,
      gps_lat: 14.5995,
      gps_lng: 120.9842,
      eligibility_status: 'ELIGIBLE',
      credit_balance: 500.5,
      card_serial: 'BTY-12345678',
      activated_at: '2026-07-01T12:00:00.000Z',
      deactivated_at: null,
      created_at: '2026-07-01T12:00:00.000Z'
    }

    const mapped = toBeneficiaryDTO(rawBeneficiary)
    expect(mapped).toMatchSnapshot()
  })

  it('should correctly map a merchant record', () => {
    const rawMerchant = {
      id: 'e47ac10b-58cc-4372-a567-0e02b2c3d478',
      auth_user_id: 'a47ac10b-58cc-4372-a567-0e02b2c3d477',
      store_name: 'Santos Sari-Sari Store',
      owner_name: 'Pedro Santos',
      mobile_number_e164: '+639171234567',
      wallet_address: 'GANQ4X5FDIREJPH6LR5YCC5ODMSACA5T6Q54F7EF6BGO55M7R6AQIP52',
      wallet_balance: '190.00',
      status: 'APPROVED',
      created_at: '2026-07-01T12:00:00.000Z'
    }

    const mapped = toMerchantDTO(rawMerchant)
    expect(mapped).toMatchSnapshot()
  })

  it('should correctly map a transaction record', () => {
    const rawTransaction = {
      id: 'd47ac10b-58cc-4372-a567-0e02b2c3d476',
      beneficiary_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      merchant_id: 'e47ac10b-58cc-4372-a567-0e02b2c3d478',
      item_list_jsonb: [
        {
          category: 'FRESH_MILK',
          name: 'Cowhead Milk 1L',
          quantity: 2,
          unitPricePhp: 95,
          creditCost: 190
        }
      ],
      total_credit_deducted: 190,
      stablecoin_amount_wei: '190000000000000000000',
      onchain_tx_hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      idempotency_key: 'c47ac10b-58cc-4372-a567-0e02b2c3d475',
      status: 'CONFIRMED',
      created_at: '2026-07-01T12:00:00.000Z',
      confirmed_at: '2026-07-01T12:05:00.000Z'
    }

    const mapped = toTransactionDTO(rawTransaction)
    expect(mapped).toMatchSnapshot()
  })

  it('should correctly map a product classification result', () => {
    const rawResult = {
      identified: true,
      candidates: [
        {
          name: 'Gerber Baby Oatmeal',
          confidence: 0.95,
          product: {
            id: 'b47ac10b-58cc-4372-a567-0e02b2c3d474',
            name: 'Gerber Baby Oatmeal',
            eligibility_status: 'eligible',
            category: 'POWDERED_MILK'
          }
        }
      ]
    }

    const mapped = toClassificationDTO(rawResult)
    expect(mapped).toMatchSnapshot()
  })

  it('should correctly map a wallet balance result', () => {
    const rawBalance = {
      address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
      balance: '10000000000000000000000',
      formatted: '10000.0'
    }

    const mapped = toBalanceDTO(rawBalance)
    expect(mapped).toMatchSnapshot()
  })
})
