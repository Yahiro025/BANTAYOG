import { BaseRepository } from '@bantayog/db'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@bantayog/db'

export class MerchantWalletRepository extends BaseRepository<'merchant_wallets'> {
  constructor(db: SupabaseClient<Database>) {
    super(db, 'merchant_wallets')
  }
}
