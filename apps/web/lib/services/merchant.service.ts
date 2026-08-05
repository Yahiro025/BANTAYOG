// ponytail: dead code kept for tests — server owns canonical impl
// Merchant Service
// CRUD operations on the merchants table.
// - register: creates Supabase Auth user, inserts merchant record, registers on-chain
// - list: returns paginated merchant list
// - approve: updates status to APPROVED, calls MerchantRegistry.verify on-chain

import type { Database } from "@bantayog/db";
import type { CreateMerchantDto } from "@bantayog/schema";
import { deriveEmailFromOwnerName } from "@/lib/merchant/email";



// Register

export interface RegisterMerchantResult {
  merchant: Database["public"]["Tables"]["merchants"]["Row"];
  authUserId: string;
}

export async function registerMerchant(
  db: any,
  dto: CreateMerchantDto,
  password: string,
): Promise<RegisterMerchantResult> {
  // 1. Create Supabase Auth user
  const email = deriveEmailFromOwnerName(dto.ownerName);

  const { data: authData, error: authError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role: "merchant",
      owner_name: dto.ownerName,
    },
    app_metadata: {
      role: "merchant",
    },
  });

  if (authError || !authData.user) {
    throw new Error(
      `Failed to create merchant auth user: ${authError?.message ?? "unknown error"}`,
    );
  }

  const authUserId = authData.user.id;

  // 2. Insert merchant record
  const { data: merchant, error: insertError } = await db
    .from("merchants")
    .insert({
      auth_user_id: authUserId,
      store_name: dto.storeName,
      owner_name: dto.ownerName,
      mobile_number_e164: dto.mobileNumberE164,
      status: "PENDING",
    })
    .select("*")
    .single();

  if (insertError || !merchant) {
    // Rollback: delete auth user
    await db.auth.admin.deleteUser(authUserId);
    throw new Error(`Failed to insert merchant: ${insertError?.message ?? "unknown"}`);
  }

  // 3. Register on-chain
  try {
    // STUBBED
  } catch (chainErr) {
    // On-chain registration failure is non-fatal for Phase 2
    console.warn("[merchant.service] On-chain registration failed (non-fatal):", chainErr);
  }

  return { merchant, authUserId };
}

// List

export interface MerchantListItem {
  id: string;
  storeName: string;
  ownerName: string;
  mobileNumberE164: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
}

export async function listMerchants(
  db: any,
  options?: { status?: string; page?: number; limit?: number },
): Promise<MerchantListItem[]> {
  let query = db
    .from("merchants")
    .select("*")
    .order("created_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const limit = options?.limit ?? 100;
  const page = options?.page ?? 1;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  query = query.range(from, to);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list merchants: ${error.message}`);
  }

  return (data ?? []).map((m: any) => ({
    id: m.id,
    storeName: m.store_name,
    ownerName: m.owner_name,
    mobileNumberE164: m.mobile_number_e164,
    status: m.status,
  }));
}

// Approve

export async function approveMerchant(
  db: any,
  merchantId: string,
): Promise<any> {
  // 1. Fetch merchant
  const { data: merchant, error: fetchError } = await db
    .from("merchants")
    .select("*")
    .eq("id", merchantId)
    .single();

  if (fetchError || !merchant) {
    throw new Error(`Merchant not found: ${fetchError?.message ?? merchantId}`);
  }

  // 2. Update status
  const { data: updated, error: updateError } = await db
    .from("merchants")
    .update({ status: "APPROVED" })
    .eq("id", merchantId)
    .select("*")
    .single();

  if (updateError || !updated) {
    throw new Error(`Failed to approve merchant: ${updateError?.message}`);
  }

  // 3. Call MerchantRegistry.verify on-chain
  try {
    // STUBBED
  } catch (chainErr) {
    console.warn("[merchant.service] On-chain verify failed (non-fatal):", chainErr);
  }

  return updated;
}

// Find by owner name (for login)

export async function findMerchantByOwnerName(
  db: any,
  ownerName: string,
): Promise<any | null> {
  const { data, error } = await db
    .from("merchants")
    .select("*")
    .ilike("owner_name", ownerName.trim())
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find merchant: ${error.message}`);
  }

  return data;
}
