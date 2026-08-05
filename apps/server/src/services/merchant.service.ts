import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@bantayog/db'
import { MerchantRepository } from '../repositories/merchant.repository.js'
import { MerchantWalletRepository } from '../repositories/merchant-wallet.repository.js'
import { CustodialWalletService } from './custodial-wallet.service.js'
import { StellarClient } from './chain.client.js'
import { loadChainConfig } from '../lib/chain/config.js'
import { type AppResult, ok, err, AuthError, PersistenceError } from '../lib/errors.js'

// BE1-2.3 · Merchant CRUD Service
export class MerchantService {
  private db: SupabaseClient<Database>
  private merchantRepo: MerchantRepository

  constructor(db: SupabaseClient<Database>) {
    this.db = db
    this.merchantRepo = new MerchantRepository(db)
  }

  // Registers a new merchant.
// Creates credentials in Supabase Auth and inserts the merchant profile record.
  async register(dto: {
    storeName: string;
    ownerName: string;
    mobileNumberE164: string;
    walletAddress?: string;
    password?: string;
  }): Promise<AppResult<any>> {
    const db = this.db;

    // 1. Create the user in Supabase Auth via admin API
    const email = `${dto.mobileNumberE164.replace('+', '')}@merchant.bantayog.local`;
    const password = dto.password || 'defaultSecurePassword123!';

    const { data: authData, error: authError } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'merchant' },
      user_metadata: { role: 'merchant' }
    });

    if (authError) {
      return err(new AuthError(`Failed to create merchant auth credentials: ${authError.message}`, 'forbidden'));
    }

    if (!authData.user) {
      return err(new AuthError('Supabase Auth user creation returned empty data', 'forbidden'));
    }

    // 2. Insert merchant profile record (wallet_address is always null on creation per Req 14.3)
    try {
      const record = await this.merchantRepo.insert({
        auth_user_id: authData.user.id,
        store_name: dto.storeName,
        owner_name: dto.ownerName,
        mobile_number_e164: dto.mobileNumberE164,
        wallet_address: null,
        status: 'APPROVED' // Default to approved on registration for phase 2/3 flows
      });

      // 3. Provision a Stellar custodial wallet for the approved merchant,
      // including on-chain account/trustline/authorization.
      const chainConfigResult = loadChainConfig(process.env);
      if (chainConfigResult.isOk()) {
        const walletService = new CustodialWalletService(chainConfigResult.value);
        const walletRepo = new MerchantWalletRepository(this.db);
        const stellarClientResult = await StellarClient.create(chainConfigResult.value);
        const stellarClient = stellarClientResult.isOk() ? stellarClientResult.value : undefined;
        const walletResult = await walletService.generateWallet(record.id, 'merchant', walletRepo, stellarClient);
        if (walletResult.isOk()) {
          // Mirror the address to merchants.wallet_address for DTO reads.
          await (this.db as any)
            .from('merchants')
            .update({ wallet_address: walletResult.value.address })
            .eq('id', record.id);
        }
      }

      return ok(record);
    } catch (dbError: any) {
      return err(new PersistenceError(`Failed to save merchant profile: ${dbError.message}`, 'merchants'));
    }
  }

  /**
   * Returns a paginated list of merchants.
   */
  async list(page: number = 1, limit: number = 20, summary: boolean = false): Promise<AppResult<{
    data: any[];
    count: number;
  }>> {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // `summary` reads only the privacy-safe columns for the admin analytics
    // tab, so owner names and mobile numbers are never loaded or returned.
    const selectClause = summary ? 'id, status' : '*';

    try {
      const { data, count, error } = await (this.db as any)
        .from('merchants')
        .select(selectClause, { count: 'exact' })
        .range(from, to)
        .order('created_at', { ascending: false });

      if (error) {
        return err(new PersistenceError(`Failed to list merchants: ${error.message}`, 'merchants'));
      }

      return ok({
        data: data ?? [],
        count: count ?? 0
      });
    } catch (error: any) {
      return err(new PersistenceError(`Database error: ${error.message}`, 'merchants'));
    }
  }

  // Approves a merchant, provisions their Stellar custodial wallet, and
// mirrors the address.
  async approve(merchantId: string): Promise<AppResult<any>> {
    try {
      const { data: merchant, error: fetchError } = await (this.db as any)
        .from('merchants')
        .select('*')
        .eq('id', merchantId)
        .single();

      if (fetchError || !merchant) {
        return err(new PersistenceError(`Merchant not found: ${fetchError?.message ?? merchantId}`, 'merchants'));
      }

      // Provision a Stellar custodial wallet before marking as APPROVED.
      const chainConfigResult = loadChainConfig(process.env);
      if (chainConfigResult.isOk()) {
        const walletService = new CustodialWalletService(chainConfigResult.value);
        const walletRepo = new MerchantWalletRepository(this.db);
        const stellarClientResult = await StellarClient.create(chainConfigResult.value);
        const stellarClient = stellarClientResult.isOk() ? stellarClientResult.value : undefined;
        const walletResult = await walletService.generateWallet(merchantId, 'merchant', walletRepo, stellarClient);
        if (walletResult.isOk()) {
          await (this.db as any)
            .from('merchants')
            .update({ wallet_address: walletResult.value.address })
            .eq('id', merchantId);
        }
      }

      const { data: updated, error: updateError } = await (this.db as any)
        .from('merchants')
        .update({ status: 'APPROVED' })
        .eq('id', merchantId)
        .select('*')
        .single();

      if (updateError || !updated) {
        return err(new PersistenceError(`Failed to approve merchant: ${updateError?.message}`, 'merchants'));
      }

      return ok(updated);
    } catch (error: any) {
      return err(new PersistenceError(`Approve operation failed: ${error.message}`, 'merchants'));
    }
  }

  // Updates status of a merchant.
  async updateStatus(merchantId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'): Promise<AppResult<any>> {
    try {
      const { data, error } = await (this.db as any)
        .from('merchants')
        .update({ status })
        .eq('id', merchantId)
        .select('*')
        .single();

      if (error || !data) {
        return err(new PersistenceError(`Failed to update status for merchant: ${error?.message || merchantId}`, 'merchants'));
      }

      return ok(data);
    } catch (error: any) {
      return err(new PersistenceError(`Update status operation failed: ${error.message}`, 'merchants'));
    }
  }
}

