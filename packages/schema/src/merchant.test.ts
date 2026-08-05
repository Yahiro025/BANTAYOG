import { describe, it, expect } from 'vitest'
import {
  CreateMerchantDto,
  MerchantDto,
  UpdateMerchantDto,
  MerchantStatusSchema,
} from './merchant.js'

describe('MerchantStatusSchema', () => {
  it('accepts all valid statuses', () => {
    const valid = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']
    for (const s of valid) {
      expect(MerchantStatusSchema.parse(s)).toBe(s)
    }
  })

  it('rejects an invalid status', () => {
    expect(() => MerchantStatusSchema.parse('ACTIVE')).toThrow()
  })
})

describe('CreateMerchantDto', () => {
  const validInput = {
    storeName: "Aling Nena's Sari-Sari Store",
    ownerName: 'Nena Cruz',
    mobileNumberE164: '+639171234567',
  }

  it('accepts a valid input', () => {
    expect(CreateMerchantDto.safeParse(validInput).success).toBe(true)
  })

  it('rejects empty storeName', () => {
    expect(
      CreateMerchantDto.safeParse({ ...validInput, storeName: '' }).success,
    ).toBe(false)
  })

  it('rejects non-E.164 mobile number', () => {
    expect(
      CreateMerchantDto.safeParse({ ...validInput, mobileNumberE164: '09171234567' })
        .success,
    ).toBe(false)
  })

  it('does not accept walletAddress (removed for Stellar migration)', () => {
    const withWallet = { ...validInput, walletAddress: 'GBZFCMQFAKQTAC7THZMRGVBM5QXRDRFEJXT6XLBRIAAGIQCH5WGE2PW2' }
    const result = CreateMerchantDto.safeParse(withWallet)
    // Zod strips unknown keys by default, so it still succeeds but walletAddress is not in output
    if (result.success) {
      expect('walletAddress' in result.data).toBe(false)
    }
  })
})

describe('MerchantDto', () => {
  const validStellarAddress = 'GBZFCMQFAKQTAC7THZMRGVBM5QXRDRFEJXT6XLBRIAAGIQCH5WGE2PW2'
  const validInput = {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    authUserId: 'a47ac10b-58cc-4372-a567-0e02b2c3d480',
    storeName: "Aling Nena's Sari-Sari Store",
    ownerName: 'Nena Cruz',
    mobileNumberE164: '+639171234567',
    walletAddress: validStellarAddress,
    walletBalance: '1234.5000000',
    status: 'APPROVED',
    createdAt: '2026-06-29T00:00:00Z',
  }

  it('accepts a valid input with Stellar address', () => {
    expect(MerchantDto.safeParse(validInput).success).toBe(true)
  })

  it('accepts null walletAddress', () => {
    expect(
      MerchantDto.safeParse({ ...validInput, walletAddress: null }).success,
    ).toBe(true)
  })

  it('rejects an EVM address', () => {
    expect(
      MerchantDto.safeParse({
        ...validInput,
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      }).success,
    ).toBe(false)
  })

  it('accepts a C-prefix address (Soroban forward-compat)', () => {
    const cAddress = 'CBZFCMQFAKQTAC7THZMRGVBM5QXRDRFEJXT6XLBRIAAGIQCH5WGE2PW2'
    expect(
      MerchantDto.safeParse({ ...validInput, walletAddress: cAddress }).success,
    ).toBe(true)
  })

  it('rejects invalid UUID for id', () => {
    expect(
      MerchantDto.safeParse({ ...validInput, id: 'not-a-uuid' }).success,
    ).toBe(false)
  })

  it('walletBalance is a string (7-decimal safe)', () => {
    const result = MerchantDto.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(typeof result.data.walletBalance).toBe('string')
    }
  })
})

describe('UpdateMerchantDto', () => {
  it('accepts partial update with only storeName', () => {
    expect(UpdateMerchantDto.safeParse({ storeName: 'New Store Name' }).success).toBe(true)
  })

  it('accepts empty object (no-op update)', () => {
    expect(UpdateMerchantDto.safeParse({}).success).toBe(true)
  })

  it('rejects invalid status value', () => {
    expect(UpdateMerchantDto.safeParse({ status: 'ACTIVE' }).success).toBe(false)
  })

  it('does not accept walletAddress (removed for Stellar migration)', () => {
    const result = UpdateMerchantDto.safeParse({ walletAddress: 'GBZFCMQFAKQTAC7THZMRGVBM5QXRDRFEJXT6XLBRIAAGIQCH5WGE2PW2' })
    // Zod strips unknown keys, so it parses but walletAddress is not in output
    if (result.success) {
      expect('walletAddress' in result.data).toBe(false)
    }
  })
})
