import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isValidStellarAddress } from './merchant-self.js'

// Unit tests for isValidStellarAddress helper

describe('isValidStellarAddress', () => {
  const VALID_G = 'GANQ4X5FDIREJPH6LR5YCC5ODMSACA5T6Q54F7EF6BGO55M7R6AQIP52'
  const VALID_C = 'CANQ4X5FDIREJPH6LR5YCC5ODMSACA5T6Q54F7EF6BGO55M7R6AQIP52'

  it('returns true for a valid G-prefixed Stellar public key', () => {
    expect(isValidStellarAddress(VALID_G)).toBe(true)
  })

  it('returns true for a valid C-prefixed Soroban contract address', () => {
    expect(isValidStellarAddress(VALID_C)).toBe(true)
  })

  it('returns false for null', () => {
    expect(isValidStellarAddress(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isValidStellarAddress(undefined)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isValidStellarAddress('')).toBe(false)
  })

  it('returns false for an EVM 0x-prefixed address', () => {
    expect(isValidStellarAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')).toBe(false)
  })

  it('returns false for a G-address with an invalid character', () => {
    expect(isValidStellarAddress('G0NQ4X5FDIREJPH6LR5YCC5ODMSACA5T6Q54F7EF6BGO55M7R6AQIP52')).toBe(false)
  })

  it('returns false for a G-address that is too short', () => {
    expect(isValidStellarAddress('GANQ4X5FDIREJPH6LR5YCC5ODMSACA5T6Q54F7EF6BGO55M7R6AQ')).toBe(false)
  })
})

// GET /api/merchants/me — Horizon-backed balance read

const VALID_MERCHANT_ADDRESS = 'GANQ4X5FDIREJPH6LR5YCC5ODMSACA5T6Q54F7EF6BGO55M7R6AQIP52'

const mockMerchantRow = {
  id: 'merchant-123',
  store_name: 'Aling Nena Sari-Sari',
  owner_name: 'Aling Nena',
  wallet_address: VALID_MERCHANT_ADDRESS,
  status: 'APPROVED',
}

const mockWalletRow = { address: VALID_MERCHANT_ADDRESS }

let testMerchantRow: any = { ...mockMerchantRow }
let testWalletRow: any = { ...mockWalletRow }
let dbSelectError: any = null

const mockSupabaseClient = {
  from: vi.fn().mockImplementation((table: string) => {
    const chain: any = {
      select: vi.fn().mockImplementation(() => chain),
      eq: vi.fn().mockImplementation(() => chain),
      single: vi.fn().mockImplementation(async () => {
        if (table === 'merchants') {
          if (dbSelectError) return { data: null, error: dbSelectError }
          return { data: testMerchantRow, error: null }
        }
        if (table === 'merchant_wallets') {
          return { data: testWalletRow, error: null }
        }
        return { data: null, error: null }
      }),
    }
    return chain
  }),
}

vi.mock('../lib/supabase.js', () => ({
  createServiceClient: () => mockSupabaseClient,
}))

// Mock auth to inject a user
let mockUser: { id: string; email: string; role: string } | null = null

vi.mock('../middleware/auth.js', () => ({
  authMiddleware: vi.fn().mockImplementation(async (c: any, next: any) => {
    c.set('user', mockUser)
    await next()
  }),
}))

vi.mock('../middleware/rbac.js', () => ({
  requireRole: (..._roles: string[]) =>
    vi.fn().mockImplementation(async (c: any, next: any) => {
      const user = c.get('user')
      if (!user) {
        return c.json({ error: 'auth', message: 'Authentication required' }, 401)
      }
      if (!_roles.includes(user.role)) {
        return c.json({ error: 'auth', message: 'Forbidden', code: 'forbidden' }, 403)
      }
      await next()
    }),
}))

// Controllable StellarClient.create / getAssetBalance result.
let mockGetAssetBalanceResult: any = { isErr: () => false, isOk: () => true, value: 1234_5600000n }
let mockCreateResult: any = null // set in beforeEach

vi.mock('../services/chain.client.js', async () => {
  const actual = await vi.importActual<typeof import('./chain.client.js')>('../services/chain.client.js')
  return {
    ...actual,
    StellarClient: {
      create: vi.fn().mockImplementation(() => Promise.resolve(mockCreateResult)),
    },
  }
})

vi.mock('../lib/chain/config.js', () => ({
  loadChainConfig: vi.fn().mockImplementation(() => ({
    isErr: () => false,
    isOk: () => true,
    value: {},
  })),
}))

// Import app after mocks are set up
const { app } = await import('../app.js')

describe('GET /api/merchants/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = { id: 'auth-user-001', email: 'merchant@test.com', role: 'merchant' }
    testMerchantRow = { ...mockMerchantRow }
    testWalletRow = { ...mockWalletRow }
    dbSelectError = null
    mockGetAssetBalanceResult = { isErr: () => false, isOk: () => true, value: 1234_5600000n }
    mockCreateResult = {
      isErr: () => false,
      isOk: () => true,
      value: { getAssetBalance: vi.fn().mockImplementation(async () => mockGetAssetBalanceResult) },
    }
  })

  it('returns 401 when unauthenticated', async () => {
    mockUser = null
    const res = await app.request('/api/merchants/me')
    expect(res.status).toBe(401)
  })

  it('returns 403 when user role is not merchant', async () => {
    mockUser = { id: 'auth-admin-001', email: 'admin@test.com', role: 'admin' }
    const res = await app.request('/api/merchants/me')
    expect(res.status).toBe(403)
  })

  it('returns 403 when merchant profile not found', async () => {
    dbSelectError = { message: 'Not found' }
    const res = await app.request('/api/merchants/me')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('not_found')
    expect(body.message).toBe('Merchant profile not found')
  })

  it('returns 403 when merchant is SUSPENDED', async () => {
    testMerchantRow.status = 'SUSPENDED'
    const res = await app.request('/api/merchants/me')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('forbidden')
  })

  it('returns 200 with a live Horizon balance for an authenticated merchant with a provisioned wallet', async () => {
    const res = await app.request('/api/merchants/me')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.id).toBe('merchant-123')
    expect(body.storeName).toBe('Aling Nena Sari-Sari')
    expect(body.ownerName).toBe('Aling Nena')
    expect(body.walletAddress).toBe(VALID_MERCHANT_ADDRESS)
    // 1234_5600000n stroops -> "1234.5600000"
    expect(body.walletBalance).toBe('1234.5600000')
    expect(body.connected).toBe(true)
    expect(body.status).toBe('APPROVED')
  })

  it('returns connected: false and a zero balance when no wallet is provisioned', async () => {
    testWalletRow = null
    testMerchantRow.wallet_address = null
    const res = await app.request('/api/merchants/me')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.walletAddress).toBeNull()
    expect(body.connected).toBe(false)
    expect(body.walletBalance).toBe('0.0000000')
  })

  it('falls back to merchants.wallet_address when no merchant_wallets row exists yet', async () => {
    testWalletRow = null
    // merchants.wallet_address mirror still set
    testMerchantRow.wallet_address = VALID_MERCHANT_ADDRESS
    const res = await app.request('/api/merchants/me')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.walletAddress).toBe(VALID_MERCHANT_ADDRESS)
    expect(body.connected).toBe(true)
  })

  it('returns the exact stroops-derived decimal string without float rounding', async () => {
    mockGetAssetBalanceResult = { isErr: () => false, isOk: () => true, value: 999_9999999n }
    const res = await app.request('/api/merchants/me')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.walletBalance).toBe('999.9999999')
  })

  it('returns 502 when the chain config cannot be loaded', async () => {
    const configModule = await import('../lib/chain/config.js')
    ;(configModule.loadChainConfig as any).mockReturnValueOnce({
      isErr: () => true,
      isOk: () => false,
      error: new Error('missing env'),
    })
    const res = await app.request('/api/merchants/me')
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('onchain')
  })

  it('returns 502 when StellarClient cannot be constructed (Horizon unreachable)', async () => {
    mockCreateResult = { isErr: () => true, isOk: () => false, error: new Error('Horizon down') }
    const res = await app.request('/api/merchants/me')
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('onchain')
  })

  it('returns 502 when the Horizon balance read fails, never a silent zero', async () => {
    mockGetAssetBalanceResult = { isErr: () => true, isOk: () => false, error: new Error('account not found') }
    const res = await app.request('/api/merchants/me')
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('onchain')
  })
})

describe('POST /api/merchants/me/wallet (deleted in Phase 6)', () => {
  it('returns 403/404 since the route was removed', async () => {
    const res = await app.request('/api/merchants/me/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: VALID_MERCHANT_ADDRESS }),
    })
    // Route no longer exists; auth middleware intercepts before matching
    expect([403, 404]).toContain(res.status)
  })
})

describe('POST /api/merchants/me/cashout (deleted in Phase 6)', () => {
  it('returns 403/404 since the route was removed', async () => {
    const res = await app.request('/api/merchants/me/cashout', { method: 'POST' })
    expect([403, 404]).toContain(res.status)
  })
})
