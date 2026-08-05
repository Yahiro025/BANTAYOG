/**
 * Database type definitions for BANTAYOG.
 *
 * These types mirror the Supabase migration (00001_init_core_tables.sql)
 * and are used by @bantayog/db clients and repositories.
 *
 * BE1 owns this file. When migrations add new tables or columns,
 * update these types accordingly.
 */

// ---------------------------------------------------------------------------
// Enums (match CHECK constraints in migration)
// ---------------------------------------------------------------------------

export type MerchantStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'

export type EligibilityStatus = 'PENDING' | 'ELIGIBLE' | 'INELIGIBLE' | 'SUSPENDED'

export type TransactionStatus =
  | 'PENDING_CHAIN'
  | 'CONFIRMED'
  | 'DB_RECORDED'
  | 'BROADCAST'
  | 'RECONCILED'
  | 'FAILED'

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'

// ---------------------------------------------------------------------------
// Row types (one per table)
// ---------------------------------------------------------------------------

export interface AdministratorRow {
  id: string
  auth_user_id: string
  full_name: string
  lgu_id: string | null
  created_at: string
}

export interface MerchantRow {
  id: string
  auth_user_id: string
  store_name: string
  owner_name: string
  mobile_number_e164: string
  wallet_address: string | null
  wallet_balance: number
  cashout_in_progress: boolean
  status: MerchantStatus
  created_at: string
}

export interface BeneficiaryRow {
  id: string
  guardian_name: string
  guardian_mobile_hash: string
  child_name: string
  child_age_months: number
  monthly_income_php: number
  gps_lat: number
  gps_lng: number
  pin_hash_argon2id: string | null
  pin_salt: string | null
  eligibility_status: EligibilityStatus
  credit_balance: number
  card_serial: string | null
  activated_at: string | null
  deactivated_at: string | null
  created_at: string
}

export interface BeneficiaryWalletRow {
  beneficiary_id: string
  address: string
  enc_ciphertext: string
  enc_iv: string
  enc_auth_tag: string
  created_at: string
}

export interface MerchantWalletRow {
  merchant_id: string
  address: string
  enc_ciphertext: string
  enc_iv: string
  enc_auth_tag: string
  created_at: string
}

export interface AllocationRow {
  id: string
  beneficiary_id: string
  tier: 1 | 2
  amount_phpc: number
  onchain_tx_hash: string | null
  /** Stellar ledger sequence where the allocation confirmed (migration 00012, F7). */
  ledger_sequence: number | null
  reconciled: boolean
  allocated_at: string
}

export interface TransactionRow {
  id: string
  beneficiary_id: string
  merchant_id: string
  item_list_jsonb: Record<string, unknown>[]
  total_credit_deducted: number
  stablecoin_amount_wei: string
  /** Stellar stroops amount, parallel to stablecoin_amount_wei (migration 00012). */
  asset_amount_stroops: string | null
  onchain_tx_hash: string | null
  /** Stellar ledger sequence where the settlement confirmed (migration 00012, F7). */
  ledger_sequence: number | null
  idempotency_key: string
  status: TransactionStatus
  created_at: string
  confirmed_at: string | null
}

export interface QrPassRow {
  id: string
  beneficiary_id: string
  token_payload: string
  issued_at: string
  expires_at: string
  revoked: boolean
}

export interface OutboxRow {
  id: string
  kind: string
  payload_jsonb: Record<string, unknown>
  status: OutboxStatus
  attempts: number
  run_after: string
  created_at: string
  processed_at: string | null
}

export interface PhotoReceiptRow {
  id: string
  transaction_id: string | null
  storage_object_path: string
  expires_at: string
  created_at: string
}

export interface ProductRow {
  id: string
  name: string
  category: string
  eligibility_status: 'eligible' | 'ineligible'
  price_range_min: number
  price_range_max: number
  image_url: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Table name union (re-exported by repository.ts)
// ---------------------------------------------------------------------------

export type TableName = keyof Database['public']['Tables']

// ---------------------------------------------------------------------------
// Database schema (for Supabase typed client)
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      administrators: {
        Row: AdministratorRow
        Insert: Omit<AdministratorRow, 'id' | 'created_at'>
        Update: Partial<Omit<AdministratorRow, 'id' | 'created_at'>>
      }
      merchants: {
        Row: MerchantRow
        Insert: Omit<MerchantRow, 'id' | 'created_at' | 'status' | 'wallet_balance' | 'cashout_in_progress'> & {
          status?: MerchantStatus
          wallet_balance?: number
          cashout_in_progress?: boolean
        }
        Update: Partial<Omit<MerchantRow, 'id' | 'created_at'>>
      }
      beneficiaries: {
        Row: BeneficiaryRow
        Insert: Omit<
          BeneficiaryRow,
          | 'id'
          | 'created_at'
          | 'eligibility_status'
          | 'credit_balance'
          | 'pin_hash_argon2id'
          | 'pin_salt'
          | 'card_serial'
          | 'activated_at'
          | 'deactivated_at'
        > & {
          eligibility_status?: EligibilityStatus
          credit_balance?: number
          pin_hash_argon2id?: string | null
          pin_salt?: string | null
          card_serial?: string | null
          activated_at?: string | null
          deactivated_at?: string | null
        }
        Update: Partial<Omit<BeneficiaryRow, 'id' | 'created_at'>>
      }
      beneficiary_wallets: {
        Row: BeneficiaryWalletRow
        Insert: Omit<BeneficiaryWalletRow, 'created_at'>
        Update: Partial<
          Omit<BeneficiaryWalletRow, 'beneficiary_id' | 'created_at'>
        >
      }
      merchant_wallets: {
        Row: MerchantWalletRow
        Insert: Omit<MerchantWalletRow, 'created_at'>
        Update: Partial<
          Omit<MerchantWalletRow, 'merchant_id' | 'created_at'>
        >
      }
      allocations: {
        Row: AllocationRow
        Insert: Omit<
          AllocationRow,
          'id' | 'reconciled' | 'allocated_at' | 'ledger_sequence'
        > & {
          reconciled?: boolean
          ledger_sequence?: number | null
        }
        Update: Partial<Omit<AllocationRow, 'id' | 'allocated_at'>>
      }
      transactions: {
        Row: TransactionRow
        Insert: Omit<
          TransactionRow,
          | 'id'
          | 'created_at'
          | 'status'
          | 'onchain_tx_hash'
          | 'confirmed_at'
          | 'total_credit_deducted'
          | 'stablecoin_amount_wei'
          | 'asset_amount_stroops'
          | 'ledger_sequence'
        > & {
          status?: TransactionStatus
          onchain_tx_hash?: string | null
          confirmed_at?: string | null
          total_credit_deducted?: number
          stablecoin_amount_wei?: string
          asset_amount_stroops?: string | null
          ledger_sequence?: number | null
        }
        Update: Partial<Omit<TransactionRow, 'id' | 'created_at'>>
      }
      qr_passes: {
        Row: QrPassRow
        Insert: Omit<QrPassRow, 'id' | 'issued_at' | 'revoked'> & {
          revoked?: boolean
        }
        Update: Partial<Omit<QrPassRow, 'id' | 'issued_at'>>
      }
      outbox: {
        Row: OutboxRow
        Insert: Omit<
          OutboxRow,
          | 'id'
          | 'created_at'
          | 'status'
          | 'attempts'
          | 'run_after'
          | 'processed_at'
        > & {
          status?: OutboxStatus
          attempts?: number
          run_after?: string
          processed_at?: string | null
        }
        Update: Partial<Omit<OutboxRow, 'id' | 'created_at'>>
      }
      photo_receipts: {
        Row: PhotoReceiptRow
        Insert: Omit<PhotoReceiptRow, 'id' | 'created_at'>
        Update: Partial<Omit<PhotoReceiptRow, 'id' | 'created_at'>>
      }
      products: {
        Row: ProductRow
        Insert: Omit<ProductRow, 'id' | 'created_at'>
        Update: Partial<Omit<ProductRow, 'id' | 'created_at'>>
      }
    }
    Views: Record<string, never>
    Functions: {
      has_role: {
        Args: { required_role: string }
        Returns: boolean
      }
      claim_outbox_rows: {
        Args: { p_limit: number }
        Returns: Database['public']['Tables']['outbox']['Row'][]
      }
      settle_sale: {
        Args: {
          p_beneficiary_id: string
          p_merchant_id: string
          p_amount: number
          p_items: Record<string, unknown>[]
          p_transaction_id: string
        }
        Returns: string
      }
    }
    Enums: {
      merchant_status: MerchantStatus
      eligibility_status: EligibilityStatus
      transaction_status: TransactionStatus
      outbox_status: OutboxStatus
    }
  }
}
