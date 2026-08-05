import { computeTier, computeAgeInDays, DAYS_PER_MONTH } from '../domain/eligibility.js'

export interface BeneficiaryDTO {
  id: string
  guardianName: string
  guardianMobileHash: string
  childName: string
  childAgeMonths: number
  monthlyIncomePhp: number
  gpsLat: number
  gpsLng: number
  eligibilityStatus: string
  creditBalance: number
  cardSerial: string | null
  activatedAt: string | null
  deactivatedAt: string | null
  createdAt: string
  birthdate: string
  ageDetails: string
  tier: 'TIER_1_CRITICAL' | 'TIER_2_STANDARD'
  jwsCompact?: string
}

// Admin-facing merchant DTO, mapped from a raw `merchants` row.
// `walletBalance` is `merchants.wallet_balance`, a cumulative record of
// settled sales credited by `settle_sale` (ground rule 1: that RPC is
// unchanged). Per ADR 004 decision D3, this is NO LONGER a withdrawable
// custodial liability once Phase 6 ships — the merchant's actual spendable
// PHPC lives on-chain and is read live from Horizon by
// `GET /api/merchants/me` (see `routes/merchant-self.ts`), not from this
// column. Kept as `string` (not `number`) to match `packages/schema`'s
// `MerchantDto.walletBalance` and avoid float precision loss, consistent
// with every other on-chain-adjacent amount in this codebase.
export interface MerchantDTO {
  id: string
  authUserId: string
  storeName: string
  ownerName: string
  mobileNumberE164: string
  walletAddress: string | null
  walletBalance: string
  status: string
  createdAt: string
}

export interface TransactionDTO {
  id: string
  beneficiaryId: string
  merchantId: string
  items: any[]
  totalCreditDeducted: number
  stablecoinAmountWei: string
  onchainTxHash: string | null
  idempotencyKey: string
  status: string
  createdAt: string
  confirmedAt: string | null
  beneficiary?: {
    childName: string
    guardianName: string
    cardSerial: string
  }
  merchant?: {
    storeName: string
    ownerName: string
    mobileNumberE164: string
  }
}

export interface VisionCandidateDTO {
  name: string
  confidence: number
  product: {
    id: string
    name: string
    eligibilityStatus: string
    category: string
  } | null
}

export interface ProductClassificationDTO {
  identified: boolean
  candidates?: VisionCandidateDTO[]
  reason?: string
}

export interface WalletBalanceDTO {
  address: string
  balance: string
  formatted: string
}

// Read-only transaction entry for the QR-token-authorized balance view
// (Requirement 8.5). Deliberately narrower than `TransactionDTO`: it omits
// `merchantId`, `items`, `stablecoinAmountWei`, and `idempotencyKey` since
// this is a PUBLIC, unauthenticated page and those fields are not
// appropriate to expose, and it exposes no field that could be used to
// create, modify, or deduct a balance.
export interface BalanceViewTransactionDTO {
  amount: number
  status: string
  onchainTxHash: string | null
  createdAt: string
  confirmedAt: string | null
}

// Read-only balance + transaction-history shape returned by
// `GET /api/balance/view` (Requirements 8.2, 8.4, 8.5). Contains no
// mutating fields/actions and is scoped to a single beneficiary.
export interface BalanceViewDTO {
  beneficiaryName: string
  balance: number
  transactions: BalanceViewTransactionDTO[]
}

export function toBalanceViewTransactionDTO(row: any): BalanceViewTransactionDTO {
  return {
    amount: Number(row.total_credit_deducted ?? row.total_amount ?? 0),
    status: row.status,
    onchainTxHash: row.onchain_tx_hash ?? null,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? null
  }
}

export function toBeneficiaryDTO(row: any): BeneficiaryDTO {
  const tierNum: number = row.tier ?? computeTier(row.created_at, row.child_age_months)
  const tier: 'TIER_1_CRITICAL' | 'TIER_2_STANDARD' = tierNum === 1 ? 'TIER_1_CRITICAL' : 'TIER_2_STANDARD'

  // Compute age in days from stored age-months and created_at
  const ageInDays = computeAgeInDays(row.created_at, row.child_age_months)
  const ageInMonths = Math.floor(ageInDays / 30)

  // Derive birthdate ISO string from created_at and child_age_months
  const createdDate = new Date(row.created_at)
  const birthdateMs = createdDate.getTime() - (row.child_age_months * DAYS_PER_MONTH * 24 * 60 * 60 * 1000)
  const birthdate = new Date(birthdateMs).toISOString().split('T')[0]

  const ageDetails = `~${ageInMonths} months\n(${ageInDays} days)`

  return {
    id: row.id,
    guardianName: row.guardian_name,
    guardianMobileHash: row.guardian_mobile_hash,
    childName: row.child_name,
    childAgeMonths: row.child_age_months,
    monthlyIncomePhp: Number(row.monthly_income_php),
    gpsLat: row.gps_lat,
    gpsLng: row.gps_lng,
    eligibilityStatus: row.eligibility_status,
    creditBalance: Number(row.credit_balance),
    cardSerial: row.card_serial || null,
    activatedAt: row.activated_at || null,
    deactivatedAt: row.deactivated_at || null,
    createdAt: row.created_at,
    birthdate,
    ageDetails,
    tier,
    jwsCompact: row.jwsCompact ?? row.jws_compact ?? undefined
  }
}

export function toMerchantDTO(row: any): MerchantDTO {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    storeName: row.store_name,
    ownerName: row.owner_name,
    mobileNumberE164: row.mobile_number_e164,
    walletAddress: row.wallet_address ?? null,
    // wallet_balance is NUMERIC(12,2) in Postgres; the driver may already
    // return it as a string. Normalize either shape to a fixed 2-decimal
    // string rather than routing through Number(), which both loses the
    // "this is exact money" guarantee and is inconsistent with
    // packages/schema's MerchantDto.walletBalance (z.string()).
    walletBalance:
      row.wallet_balance === null || row.wallet_balance === undefined
        ? '0.00'
        : String(row.wallet_balance),
    status: row.status,
    createdAt: row.created_at
  }
}

export function toTransactionDTO(row: any): TransactionDTO {
  return {
    id: row.id,
    beneficiaryId: row.beneficiary_id,
    merchantId: row.merchant_id,
    items: row.item_list_jsonb || [],
    totalCreditDeducted: Number(row.total_credit_deducted || row.total_amount || 0),
    stablecoinAmountWei: row.stablecoin_amount_wei || '0',
    onchainTxHash: row.onchain_tx_hash || null,
    idempotencyKey: row.idempotency_key || '',
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || null,
    beneficiary: row.beneficiaries ? {
      childName: row.beneficiaries.child_name,
      guardianName: row.beneficiaries.guardian_name,
      cardSerial: row.beneficiaries.card_serial,
    } : undefined,
    merchant: row.merchants ? {
      storeName: row.merchants.store_name,
      ownerName: row.merchants.owner_name,
      mobileNumberE164: row.merchants.mobile_number_e164,
    } : undefined
  }
}

export function toClassificationDTO(result: any): ProductClassificationDTO {
  if (!result.identified) {
    return {
      identified: false,
      reason: result.reason
    }
  }

  const candidates: VisionCandidateDTO[] = (result.candidates || []).map((c: any) => {
    let mappedProduct = null
    if (c.product) {
      mappedProduct = {
        id: c.product.id,
        name: c.product.name,
        eligibilityStatus: c.product.eligibility_status,
        category: c.product.category
      }
    }

    return {
      name: c.name,
      confidence: c.confidence,
      product: mappedProduct
    }
  })

  return {
    identified: true,
    candidates
  }
}

export function toBalanceDTO(result: any): WalletBalanceDTO {
  return {
    address: result.address,
    balance: result.balance,
    formatted: result.formatted
  }
}
