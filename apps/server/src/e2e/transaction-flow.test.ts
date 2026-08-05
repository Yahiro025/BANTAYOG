import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createActor } from 'xstate'
import { VisionService } from '../services/vision.service.js'
import { TransactionService } from '../services/transaction.service.js'
import { QrTokenService } from '../services/qr-token.service.js'
import { ProductsService } from '../services/products.service.js'
import { BeneficiaryService } from '../services/beneficiary.service.js'
import { MerchantService } from '../services/merchant.service.js'
import { StellarClient } from '../services/chain.client.js'

process.env.GEMINI_API_KEY = 'fake-gemini-key-for-tests'

// ── Dynamic Gemini response (tests mutate this before calling vision service) ──
let geminiMockResponse = {
  candidates: [{ name: 'Cerelac Rice', confidence: 0.95 }]
}

// Mock the Gemini SDK
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: vi.fn().mockImplementation(() => {
          return Promise.resolve({
            text: JSON.stringify(geminiMockResponse)
          })
        })
      }
    }))
  }
})

// Mock StellarClient so no real blockchain calls are made
vi.mock('../services/chain.client.js', () => {
  const mockClientInstance = {
    getAssetBalance: vi.fn().mockResolvedValue({ isOk: () => true, value: 5000n * 10_000_000n }),
    allocateSubsidy: vi.fn().mockResolvedValue({ isOk: () => true, value: { hash: 'mock-stellar-hash', ledger: 42 } }),
    settlePurchase: vi.fn().mockResolvedValue({ isOk: () => true, value: { hash: 'mock-settle-hash', ledger: 43 } }),
    hasAuthorizedTrustline: vi.fn().mockResolvedValue({ isOk: () => true, value: true }),
    provisionAccount: vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: undefined }),
  }
  const StellarClientMock: any = vi.fn().mockImplementation(() => mockClientInstance)
  StellarClientMock.create = vi.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: mockClientInstance })
  return { StellarClient: StellarClientMock }
})

// ── Stateful mock DB ──
let mockDbState: Record<string, any[]> = {
  beneficiaries: [],
  beneficiary_wallets: [],
  merchants: [],
  transactions: [],
  outbox: [],
  products: [],
  qr_passes: []
}

function resetMockDbState() {
  mockDbState = {
    beneficiaries: [],
    beneficiary_wallets: [],
    merchants: [],
    transactions: [],
    outbox: [],
    products: [
      {
        id: 'p7890123-3dbd-426c-8ab5-3e284b39e6a7',
        name: 'Cerelac Rice',
        category: 'POWDERED_MILK',
        eligibility_status: 'eligible',
        price_range_min: 100.0,
        price_range_max: 200.0
      },
      {
        id: 'p8901234-3dbd-426c-8ab5-3e284b39e6b8',
        name: 'Coca-Cola 1.5L',
        category: 'SOFT_DRINKS',
        eligibility_status: 'ineligible',
        price_range_min: 50.0,
        price_range_max: 80.0
      }
    ],
    qr_passes: []
  }
}

function createSelectBuilder(table: string, data: any[]) {
  let filtered = [...data]
  const count = data.length

  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation((col: string, val: any) => {
      filtered = filtered.filter(r => r[col] === val)
      return chain
    }),
    ilike: vi.fn().mockImplementation((col: string, pattern: string) => {
      const search = pattern.replace(/%/g, '').toLowerCase()
      filtered = filtered.filter(r => r[col] && String(r[col]).toLowerCase().includes(search))
      return chain
    }),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockImplementation((from: number, to: number) => {
      filtered = filtered.slice(from, to + 1)
      return chain
    }),
    limit: vi.fn().mockImplementation((n: number) => {
      filtered = filtered.slice(0, n)
      return chain
    }),
    single: vi.fn().mockResolvedValue({
      data: filtered[0] || null,
      error: filtered.length === 0 ? new Error('Not found') : null
    }),
    maybeSingle: vi.fn().mockResolvedValue({
      data: filtered[0] || null,
      error: null
    }),
    then: (onFulfilled: any) => Promise.resolve({ data: filtered, count, error: null }).then(onFulfilled)
  }
  return chain
}

const mockSupabaseClient: any = {
  auth: {
    admin: {
      createUser: vi.fn().mockImplementation(({ email, app_metadata }: any) => {
        const authId = `auth-${Math.random().toString(36).substring(2, 10)}`
        return Promise.resolve({
          data: { user: { id: authId, email, app_metadata } },
          error: null
        })
      })
    },
    signInWithPassword: vi.fn().mockResolvedValue({
      data: {
        user: { id: 'auth-admin-123', email: 'admin@bantayog.local', app_metadata: { role: 'admin' } },
        session: { access_token: 'mock-token', expires_at: Date.now() + 3600000 }
      },
      error: null
    }),
    signOut: vi.fn().mockResolvedValue({ error: null })
  },
  from: vi.fn().mockImplementation((table: string) => {
    const tableData = mockDbState[table] || []

    return {
      select: vi.fn().mockImplementation(() => createSelectBuilder(table, tableData)),
      insert: vi.fn().mockImplementation((data: any) => {
        const rows = Array.isArray(data) ? data : [data]
        const inserted = rows.map(row => ({
          id: row.id || `gen-${Math.random().toString(36).substring(2, 10)}`,
          ...row,
          created_at: row.created_at || new Date().toISOString()
        }))
        mockDbState[table].push(...inserted)
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: inserted[0], error: null })
          }),
          single: vi.fn().mockResolvedValue({ data: inserted[0], error: null }),
          then: (onFulfilled: any) => Promise.resolve({ data: inserted, error: null }).then(onFulfilled)
        }
      }),
      update: vi.fn().mockImplementation((patch: any) => ({
        eq: vi.fn().mockImplementation((col: string, val: any) => {
          const idx = tableData.findIndex((r: any) => r[col] === val)
          if (idx >= 0) {
            tableData[idx] = { ...tableData[idx], ...patch }
          }
          const updated = idx >= 0 ? tableData[idx] : null
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: updated, error: null })
            }),
            single: vi.fn().mockResolvedValue({ data: updated, error: null }),
            then: (onFulfilled: any) => Promise.resolve({ data: [updated], error: null }).then(onFulfilled)
          }
        })
      })),
      delete: vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockImplementation((col: string, val: any) => {
          const idx = tableData.findIndex((r: any) => r[col] === val)
          if (idx >= 0) {
            tableData.splice(idx, 1)
          }
          return Promise.resolve({ data: null, error: null })
        })
      })),
      eq: vi.fn().mockImplementation((col: string, val: any) => createSelectBuilder(table, tableData).eq(col, val)),
      ilike: vi.fn().mockImplementation((col: string, pattern: string) => createSelectBuilder(table, tableData).ilike(col, pattern)),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
    }
  })
}

vi.mock('../lib/supabase.js', () => {
  return {
    createServiceClient: () => mockSupabaseClient
  }
})

describe('End-to-End Transaction Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockDbState()
    geminiMockResponse = { candidates: [{ name: 'Cerelac Rice', confidence: 0.95 }] }

    // BeneficiaryService.register loads ChainConfig to generate a custodial
    // wallet during registration; stub the required Polygon Amoy variables.
    vi.stubEnv('STELLAR_HORIZON_URL', 'https://horizon-testnet.stellar.org')
    vi.stubEnv('STELLAR_NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015')
    vi.stubEnv('PHPC_ASSET_CODE', 'PHPC')
    vi.stubEnv('PHPC_ISSUER_PUBLIC_KEY', 'GDVIX3H4TPPZ3ZR5TBYGV2BHVT5KZGIIACXPGTS3WJI7FCLIQMDKXBP6')
    vi.stubEnv('PHPC_ISSUER_SECRET', 'SBLOCMCBZRMHGNNELJSDHS2UKCDI2KWDVTPQGJLX3IWM34ZTDOID7XCI')
    vi.stubEnv('PHPC_DISTRIBUTION_SECRET', 'SD2ZBARMFVIIPB75WKI6GOEATW3CWEZ3FCMFRLWPS4H34KLP2WLXVKTR')
    vi.stubEnv('STELLAR_SPONSOR_SECRET', 'SA5BA56CFEMCKAYOCKWQ7FRQHXG7VDMBLTHLAPUNKBYRY7P3R2XDIWKM')
    vi.stubEnv('CUSTODIAL_KEY_ENCRYPTION_KEY', 'test-key-encryption-key')
    vi.stubEnv('QR_TOKEN_SECRET', 'test-qr-token-secret')
  })

  it('happy path: full transaction flow from registration to confirmation', async () => {
    const db = mockSupabaseClient

    // ── 1. Register a beneficiary ──
    const beneficiaryService = new BeneficiaryService(db)
    const registrationResult = await beneficiaryService.register({
      guardianName: 'Maria Dela Cruz',
      guardianMobileHash: 'sha256-mobile-hash-1',
      childName: 'Juan Dela Cruz',
      childAgeMonths: 8,
      monthlyIncomePhp: 8000,
      gpsLat: 14.5995,
      gpsLng: 120.9842,
      pin: '123456'
    })

    expect(registrationResult.isOk()).toBe(true)
    const registration = registrationResult._unsafeUnwrap()

    expect(registration.beneficiary).toBeDefined()
    expect(registration.beneficiary.child_name).toBe('Juan Dela Cruz')
    expect(registration.tier).toBe(1)
    expect(registration.qrToken).toBeDefined()
    expect(registration.qrToken.length).toBeGreaterThan(20)
    expect(mockDbState.beneficiaries.length).toBe(1)
    expect(mockDbState.beneficiaries[0].pin_hash_argon2id).toBeDefined()

    // ── 2. Register a merchant ──
    const merchantService = new MerchantService(db)
    const merchantResult = await merchantService.register({
      storeName: 'Aling Nena Sari-Sari',
      ownerName: 'Aling Nena',
      mobileNumberE164: '+639171234567',
      walletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      password: 'securePassword123'
    })

    expect(merchantResult.isOk()).toBe(true)
    const merchant = merchantResult._unsafeUnwrap()

    expect(merchant.store_name).toBe('Aling Nena Sari-Sari')
    expect(merchant.status).toBe('APPROVED')
    expect(mockDbState.merchants.length).toBe(1)

    // ── 3. Classify a product via Vision service ──
    const visionService = new VisionService(db)
    const classificationResult = await visionService.classifyProduct('data:image/jpeg;base64,mockimagedata')

    expect(classificationResult.isOk()).toBe(true)
    const classification = classificationResult._unsafeUnwrap()

    expect(classification.identified).toBe(true)
    if (classification.identified) {
      expect(classification.candidates.length).toBeGreaterThan(0)
      expect(classification.candidates[0].name).toBe('Cerelac Rice')
      expect(classification.candidates[0].product).not.toBeNull()
      expect(classification.candidates[0].product!.eligibility_status).toBe('eligible')
    }

    // ── 4. Verify QR token and tier re-evaluation ──
    const qrTokenService = new QrTokenService()
    const verifiedPayloadResult = await qrTokenService.verifyToken(registration.qrToken)
    expect(verifiedPayloadResult.isOk()).toBe(true)
    const verifiedPayload = verifiedPayloadResult._unsafeUnwrap()
    expect(verifiedPayload.beneficiaryId).toBe(registration.beneficiary.id)

    const reevalResult = await beneficiaryService.verifyAndReevaluateTier(registration.beneficiary.id)
    expect(reevalResult.isOk()).toBe(true)
    const reeval = reevalResult._unsafeUnwrap()
    expect(reeval.tier).toBe(1)
    expect(reeval.beneficiary.child_name).toBe('Juan Dela Cruz')

    // ── 5. Add credits to beneficiary ──
    const creditedResult = await beneficiaryService.addCredits(registration.beneficiary.id, 500)
    expect(creditedResult.isOk()).toBe(true)
    const credited = creditedResult._unsafeUnwrap()
    expect(Number(credited.credit_balance)).toBe(500)

    // ── 6. Create transaction ──
    const transactionService = new TransactionService(db)
    const items = [
      {
        category: 'POWDERED_MILK',
        name: 'Cerelac Rice',
        quantity: 1,
        unitPricePhp: 120.0,
        creditCost: 120.0
      }
    ]

    const txResult = await transactionService.createTransaction({
      beneficiaryId: registration.beneficiary.id,
      merchantId: merchant.id,
      items,
      idempotencyKey: 'a75f7823-3dbd-426c-8ab5-3e284b39e6a0'
    })

    expect(txResult.isOk()).toBe(true)
    const tx = txResult._unsafeUnwrap()

    expect(tx.status).toBe('PENDING_CHAIN')
    expect(Number(tx.total_credit_deducted)).toBe(120)
    expect(tx.stablecoin_amount_wei).toBeDefined()

    // ── 7. Verify outbox entry was created with correct payload shape ──
    expect(mockDbState.outbox.length).toBe(1)
    const outboxEntry = mockDbState.outbox[0]
    expect(outboxEntry.kind).toBe('TRANSACTION_CHAIN_SUBMIT')
    expect(outboxEntry.status).toBe('PENDING')
    expect(outboxEntry.payload_jsonb).toMatchObject({
      transactionId: tx.id,
      beneficiaryId: registration.beneficiary.id,
      merchantId: merchant.id,
      stablecoinAmountWei: tx.stablecoin_amount_wei
    })

    // ── 8. Simulate chain submission (mocked StellarClient) ──
    const stellarClient = new StellarClient()
    const settleResult = await stellarClient.settlePurchase({
      beneficiaryAccountId: registration.beneficiary.id,
      beneficiarySecret: 'mock-secret',
      merchantAccountId: merchant.wallet_address,
      amountStroops: BigInt(tx.total_credit_deducted) * 10_000_000n,
    })
    expect(settleResult.isOk()).toBe(true)

    const txHash = settleResult.isOk() ? settleResult.value.hash : ''
    expect(txHash).toBe('mock-settle-hash')

    // ── 9. Update transaction to CONFIRMED ──
    const confirmedResult = await transactionService.updateStatus(tx.id, 'CONFIRMED', {
      onchainTxHash: txHash,
      confirmedAt: new Date().toISOString()
    })
    expect(confirmedResult.isOk()).toBe(true)
    const confirmed = confirmedResult._unsafeUnwrap()
    expect(confirmed.status).toBe('CONFIRMED')
    expect(confirmed.onchain_tx_hash).toBe(txHash)

    // ── 10. Verify state machine can transition to RECONCILED ──
    const { transactionMachine } = await import('../services/transaction.machine.js')
    const actor = createActor(transactionMachine)
    actor.start()

    actor.send({ type: 'VALIDATE' })
    expect(actor.getSnapshot().value).toBe('VALIDATING')

    actor.send({ type: 'VALID' })
    expect(actor.getSnapshot().value).toBe('PENDING_CHAIN')

    actor.send({ type: 'SUBMIT' })
    expect(actor.getSnapshot().value).toBe('SUBMITTED')

    actor.send({ type: 'CONFIRM' })
    expect(actor.getSnapshot().value).toBe('CONFIRMED')

    actor.send({ type: 'RECONCILE' })
    expect(actor.getSnapshot().value).toBe('RECONCILED')
  })

  it('rejects ineligible products from the catalog', async () => {
    const db = mockSupabaseClient
    const productsService = new ProductsService(db)

    const resultResult = await productsService.validateProduct('Coca-Cola 1.5L')
    expect(resultResult.isOk()).toBe(true)
    const result = resultResult._unsafeUnwrap()

    expect(result.matched).toBe(true)
    if (result.matched) {
      expect(result.product.eligibility_status).toBe('ineligible')
    }

    // Vision service should surface ineligibility for matched candidates
    geminiMockResponse = { candidates: [{ name: 'Coca-Cola 1.5L', confidence: 0.92 }] }
    const visionService = new VisionService(db)
    const classificationResult = await visionService.classifyProduct('data:image/jpeg;base64,mockcola')
    expect(classificationResult.isOk()).toBe(true)
    const classification = classificationResult._unsafeUnwrap()

    expect(classification.identified).toBe(true)
    if (classification.identified) {
      const ineligibleCandidate = classification.candidates.find(
        c => c.name === 'Coca-Cola 1.5L'
      )
      expect(ineligibleCandidate).toBeDefined()
      expect(ineligibleCandidate!.product).not.toBeNull()
      expect(ineligibleCandidate!.product!.eligibility_status).toBe('ineligible')
    }
  })

  it('creates transaction with PENDING_CHAIN status regardless of credit balance (route-level validation)', async () => {
    const db = mockSupabaseClient

    const beneficiaryService = new BeneficiaryService(db)
    const registrationResult = await beneficiaryService.register({
      guardianName: 'Ana Santos',
      guardianMobileHash: 'sha256-mobile-hash-2',
      childName: 'Pedro Santos',
      childAgeMonths: 12,
      monthlyIncomePhp: 6000,
      gpsLat: 14.5500,
      gpsLng: 121.0200,
      pin: '654321'
    })
    expect(registrationResult.isOk()).toBe(true)
    const { beneficiary } = registrationResult._unsafeUnwrap()

    expect(Number(beneficiary.credit_balance)).toBe(0)

    const merchantService = new MerchantService(db)
    const merchantResult = await merchantService.register({
      storeName: 'Tindahan ni Juan',
      ownerName: 'Juan Cruz',
      mobileNumberE164: '+639181234567',
      walletAddress: '0x1234567890123456789012345678901234567890',
      password: 'merchantPass123'
    })
    expect(merchantResult.isOk()).toBe(true)
    const merchant = merchantResult._unsafeUnwrap()

    const transactionService = new TransactionService(db)
    const items = [
      {
        category: 'POWDERED_MILK',
        name: 'Cerelac Rice',
        quantity: 1,
        unitPricePhp: 250.0,
        creditCost: 250.0
      }
    ]

    const txResult = await transactionService.createTransaction({
      beneficiaryId: beneficiary.id,
      merchantId: merchant.id,
      items,
      idempotencyKey: 'b75f7823-3dbd-426c-8ab5-3e284b39e6b1'
    })
    expect(txResult.isOk()).toBe(true)
    const tx = txResult._unsafeUnwrap()

    expect(tx.status).toBe('PENDING_CHAIN')
    expect(Number(tx.total_credit_deducted)).toBe(250)
    expect(mockDbState.outbox.length).toBe(1)
    expect(mockDbState.outbox[0].payload_jsonb.transactionId).toBe(tx.id)
  })

  it('re-evaluates beneficiary tier at QR scan time when child exceeds 1000 days', async () => {
    const db = mockSupabaseClient
    const beneficiaryService = new BeneficiaryService(db)

    // 25 months ≈ 761 days from birth + 270 gestational = 1031 days from conception
    // This exceeds the 1,000-day threshold → Tier 2
    const registrationResult = await beneficiaryService.register({
      guardianName: 'Lola Maggie',
      guardianMobileHash: 'sha256-mobile-hash-3',
      childName: 'Baby Maggie',
      childAgeMonths: 25,
      monthlyIncomePhp: 5000,
      gpsLat: 14.5800,
      gpsLng: 121.0000,
      pin: '111111'
    })
    expect(registrationResult.isOk()).toBe(true)
    const { beneficiary, qrToken } = registrationResult._unsafeUnwrap()

    const initialTierResult = await beneficiaryService.verifyAndReevaluateTier(beneficiary.id)
    expect(initialTierResult.isOk()).toBe(true)
    const initialTier = initialTierResult._unsafeUnwrap()
    expect(initialTier.tier).toBe(2)

    const qrTokenService = new QrTokenService()
    const payloadResult = await qrTokenService.verifyToken(qrToken)
    expect(payloadResult.isOk()).toBe(true)
    const payload = payloadResult._unsafeUnwrap()
    expect(payload.beneficiaryId).toBe(beneficiary.id)

    const reevalResult = await beneficiaryService.verifyAndReevaluateTier(payload.beneficiaryId)
    expect(reevalResult.isOk()).toBe(true)
    const reeval = reevalResult._unsafeUnwrap()
    expect(reeval.tier).toBe(2)
    expect(reeval.beneficiary.child_name).toBe('Baby Maggie')
  })

  it('state machine transitions through all lifecycle states correctly', async () => {
    const { transactionMachine } = await import('../services/transaction.machine.js')
    const actor = createActor(transactionMachine)
    actor.start()

    expect(actor.getSnapshot().value).toBe('IDLE')

    actor.send({ type: 'VALIDATE' })
    expect(actor.getSnapshot().value).toBe('VALIDATING')

    actor.send({ type: 'VALID' })
    expect(actor.getSnapshot().value).toBe('PENDING_CHAIN')

    actor.send({ type: 'SUBMIT' })
    expect(actor.getSnapshot().value).toBe('SUBMITTED')

    actor.send({ type: 'CONFIRM' })
    expect(actor.getSnapshot().value).toBe('CONFIRMED')

    actor.send({ type: 'RECONCILE' })
    expect(actor.getSnapshot().value).toBe('RECONCILED')
    expect(actor.getSnapshot().status).toBe('done')
  })

  it('state machine transitions to FAILED from any active state', async () => {
    const { transactionMachine } = await import('../services/transaction.machine.js')

    const actor1 = createActor(transactionMachine)
    actor1.start()
    actor1.send({ type: 'VALIDATE' })
    actor1.send({ type: 'INVALID' })
    expect(actor1.getSnapshot().value).toBe('FAILED')

    const actor2 = createActor(transactionMachine)
    actor2.start()
    actor2.send({ type: 'VALIDATE' })
    actor2.send({ type: 'VALID' })
    actor2.send({ type: 'FAIL' })
    expect(actor2.getSnapshot().value).toBe('FAILED')

    const actor3 = createActor(transactionMachine)
    actor3.start()
    actor3.send({ type: 'VALIDATE' })
    actor3.send({ type: 'VALID' })
    actor3.send({ type: 'SUBMIT' })
    actor3.send({ type: 'FAIL' })
    expect(actor3.getSnapshot().value).toBe('FAILED')

    const actor4 = createActor(transactionMachine)
    actor4.start()
    actor4.send({ type: 'VALIDATE' })
    actor4.send({ type: 'VALID' })
    actor4.send({ type: 'SUBMIT' })
    actor4.send({ type: 'CONFIRM' })
    actor4.send({ type: 'FAIL' })
    expect(actor4.getSnapshot().value).toBe('FAILED')
  })

  it('rejects unrecognizable product when vision confidence is below threshold', async () => {
    const db = mockSupabaseClient

    // Gemini returns a candidate but with very low confidence
    geminiMockResponse = { candidates: [{ name: 'Unknown Mystery Item', confidence: 0.35 }] }

    const visionService = new VisionService(db)
    const classificationResult = await visionService.classifyProduct('data:image/jpeg;base64,blurryimage')
    expect(classificationResult.isOk()).toBe(true)
    const classification = classificationResult._unsafeUnwrap()

    // Low confidence should result in no identified products
    expect(classification.identified).toBe(false)
    if (!classification.identified) {
      expect(classification.reason).toBe('unrecognizable')
    }
  })

  it('returns existing transaction on duplicate idempotency key', async () => {
    const db = mockSupabaseClient

    const beneficiaryService = new BeneficiaryService(db)
    const registrationResult = await beneficiaryService.register({
      guardianName: 'Ida Demo',
      guardianMobileHash: 'sha256-mobile-hash-4',
      childName: 'Demo Child',
      childAgeMonths: 6,
      monthlyIncomePhp: 7000,
      gpsLat: 14.6000,
      gpsLng: 121.0100,
      pin: '222222'
    })
    expect(registrationResult.isOk()).toBe(true)
    const { beneficiary } = registrationResult._unsafeUnwrap()

    const merchantService = new MerchantService(db)
    const merchantResult = await merchantService.register({
      storeName: 'Demo Store',
      ownerName: 'Demo Owner',
      mobileNumberE164: '+639191234567',
      walletAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
      password: 'demoPass123'
    })
    expect(merchantResult.isOk()).toBe(true)
    const merchant = merchantResult._unsafeUnwrap()

    const transactionService = new TransactionService(db)
    const idempotencyKey = 'c75f7823-3dbd-426c-8ab5-3e284b39e6c2'
    const items = [{
      category: 'DAIRY',
      name: 'Fresh Eggs (dozen)',
      quantity: 1,
      unitPricePhp: 90.0,
      creditCost: 90.0
    }]

    const tx1Result = await transactionService.createTransaction({
      beneficiaryId: beneficiary.id,
      merchantId: merchant.id,
      items,
      idempotencyKey
    })
    expect(tx1Result.isOk()).toBe(true)
    const tx1 = tx1Result._unsafeUnwrap()
    expect(tx1.status).toBe('PENDING_CHAIN')

    const tx2Result = await transactionService.createTransaction({
      beneficiaryId: beneficiary.id,
      merchantId: merchant.id,
      items,
      idempotencyKey
    })
    expect(tx2Result.isOk()).toBe(true)
    const tx2 = tx2Result._unsafeUnwrap()

    expect(tx2.id).toBe(tx1.id)
    expect(tx2.status).toBe('PENDING_CHAIN')
    expect(mockDbState.outbox.length).toBe(1)
  })
})
