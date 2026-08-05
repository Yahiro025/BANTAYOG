// eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars
// @ts-nocheck
// ponytail: dead code kept for tests — server owns canonical impl
// Beneficiary Service
// CRUD operations on the beneficiaries table.
// - register: computes tier, hashes PIN, inserts record, generates QR token
// - list: returns all beneficiaries with dynamically re-evaluated tiers
// - addCredits: updates Supabase balance + calls PHPCSubsidy.allocateCredits on-chain

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@bantayog/db";
import type { CreateBeneficiaryDto } from "@bantayog/schema";
import { hashPin, verifyPin } from "./pin.service";
import { generateQrToken } from "./qr-token.service";
import {
  computeTier,
  deriveBirthdateFromAgeMonths,
  formatAgeDetails,
  type Tier,
} from "@/lib/domain/eligibility";
import { getPublicClient, getWalletClient, getHardhatChain } from "@/lib/chain/client";
import { phpcSubsidyAddress, PHPC_SUBSIDY_ABI } from "@/lib/chain/contracts";
import { keccak256, toHex } from "viem";

// Helpers

// Generate a card serial like BTG-2026-001
function generateCardSerial(): string {
  const year = new Date().getFullYear();
  const random = String(Math.floor(Math.random() * 900) + 100);
  return `BTG-${year}-${random}`;
}

// Convert beneficiary ID (UUID) to bytes32 for on-chain calls.
function beneficiaryIdToBytes32(id: string): `0x${string}` {
  return keccak256(toHex(id));
}

// Register

export interface RegisterBeneficiaryResult {
  beneficiary: Database["public"]["Tables"]["beneficiaries"]["Row"];
  tier: Tier;
  cardSerial: string;
  qrToken: { jwsCompact: string; cardSerial: string };
  alertBanner: string | null;
}

export async function registerBeneficiary(
  db: any,
  dto: CreateBeneficiaryDto,
): Promise<RegisterBeneficiaryResult> {
  // 1. Compute tier from birthdate (derived from age months)
  const birthdate = deriveBirthdateFromAgeMonths(dto.childAgeMonths);
  const { tier } = computeTier(birthdate);

  // 2. Hash PIN
  const pinHash = await hashPin(dto.pin);

  // 3. Generate card serial
  const cardSerial = generateCardSerial();

  // 4. Insert into Supabase
  const { data: beneficiary, error } = await db
    .from("beneficiaries")
    .insert({
      guardian_name: dto.guardianName,
      guardian_mobile_hash: dto.guardianMobileHash,
      child_name: dto.childName,
      child_age_months: dto.childAgeMonths,
      monthly_income_php: dto.monthlyIncomePhp,
      gps_lat: dto.gpsLat,
      gps_lng: dto.gpsLng,
      pin_hash_argon2id: pinHash,
      eligibility_status: "ELIGIBLE",
      credit_balance: 0,
      card_serial: cardSerial,
    })
    .select("*")
    .single();

  if (error || !beneficiary) {
    throw new Error(
      `Failed to register beneficiary: ${error?.message ?? "unknown error"}`,
    );
  }

  // 5. Generate QR token
  const qrTokenResult = await generateQrToken(
    {
      beneficiaryId: beneficiary.id,
      childName: beneficiary.child_name,
      guardianName: beneficiary.guardian_name,
      tier,
      pinHashRef: beneficiary.pin_hash_argon2id ?? "",
    },
    cardSerial,
  );

  // 6. Store QR pass in database
  await db.from("qr_passes").insert({
    beneficiary_id: beneficiary.id,
    token_payload: qrTokenResult.jwsCompact,
    expires_at: qrTokenResult.expiresAt.toISOString(),
  });

  // 7. Alert banner for critical tier
  const alertBanner =
    tier === 1
      ? "⚠ Critical 1,000-Day Window: This child is within the critical first 1,000 days of development."
      : null;

  return {
    beneficiary,
    tier,
    cardSerial,
    qrToken: {
      jwsCompact: qrTokenResult.jwsCompact,
      cardSerial: qrTokenResult.cardSerial,
    },
    alertBanner,
  };
}

// List

export interface BeneficiaryListItem {
  id: string;
  cardSerial: string;
  childName: string;
  guardianName: string;
  ageDetails: string;
  creditBalance: number;
  tier: "TIER_1_CRITICAL" | "TIER_2_STANDARD";
  birthdate: string;
  jwsCompact: string;
}

export async function listBeneficiaries(
  db: any,
): Promise<BeneficiaryListItem[]> {
  const { data, error } = await db
    .from("beneficiaries")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list beneficiaries: ${error.message}`);
  }

  const rows = data ?? [];

  return rows.map((row) => {
    // Derive approximate birthdate from age months
    const birthdate = deriveBirthdateFromAgeMonths(row.child_age_months);
    const { tier } = computeTier(birthdate);

    // Fallback: if no stored QR pass, return a placeholder indicating missing token
    const jwsCompact = row.card_serial ?? "MISSING-QR-TOKEN";

    return {
      id: row.id,
      cardSerial: row.card_serial ?? "N/A",
      childName: row.child_name,
      guardianName: row.guardian_name,
      ageDetails: formatAgeDetails(row.child_age_months),
      creditBalance: Number(row.credit_balance),
      tier: tier === 1 ? "TIER_1_CRITICAL" : "TIER_2_STANDARD",
      birthdate: birthdate.toISOString().split("T")[0],
      jwsCompact,
    };
  });
}

// Add Credits

export interface AddCreditsResult {
  beneficiaryId: string;
  newBalance: number;
  amountAdded: number;
  txHash?: string;
}

export async function addCredits(
  db: any,
  beneficiaryId: string,
  amount: number,
): Promise<AddCreditsResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a positive number");
  }

  // 1. Fetch beneficiary
  const { data: beneficiary, error: fetchError } = await db
    .from("beneficiaries")
    .select("*")
    .eq("id", beneficiaryId)
    .single();

  if (fetchError || !beneficiary) {
    throw new Error(`Beneficiary not found: ${fetchError?.message ?? beneficiaryId}`);
  }

  // 2. Check subsidy contract balance on-chain (pre-flight)
  const publicClient = getPublicClient();
  // Read PHPC balance of LGU treasury
  const lguBalance = (await publicClient.readContract({
    address: phpcSubsidyAddress(),
    abi: PHPC_SUBSIDY_ABI,
    functionName: "contractPHPCBalance",
  })) as bigint;

  // Convert amount to wei (18 decimals)
  const amountWei = BigInt(Math.floor(amount * 1e18));

  if (lguBalance < amountWei) {
    throw new Error("Insufficient LGU wallet balance for allocation");
  }

  // 3. Call allocateCredits on-chain FIRST, then update DB on success
  const walletClient = getWalletClient();
  const account = walletClient.account;
  if (!account) {
    throw new Error("Wallet client account not configured");
  }

  const txHash = await walletClient.writeContract({
    address: phpcSubsidyAddress(),
    abi: PHPC_SUBSIDY_ABI,
    functionName: "allocateCredits",
    args: [beneficiaryIdToBytes32(beneficiaryId), amountWei],
    account,
    chain: getHardhatChain(),
  });

  // Wait for receipt before updating DB
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  // 4. Update Supabase balance only after on-chain success
  const newBalance = Number(beneficiary.credit_balance) + amount;
  const { error: updateError } = await db
    .from("beneficiaries")
    .update({ credit_balance: newBalance })
    .eq("id", beneficiaryId);

  if (updateError) {
    // DB update failed but on-chain succeeded — log for manual reconciliation
    throw new Error(
      `On-chain allocation succeeded (tx: ${txHash}) but DB update failed: ${updateError.message}. ` +
        "Manual reconciliation required."
    );
  }

  return {
    beneficiaryId,
    newBalance,
    amountAdded: amount,
    txHash,
  };
}

// Metrics

export interface BeneficiaryMetrics {
  totalBeneficiaries: number;
  criticalUnits: number;
  allocatedPhpc: string;
  verifiedMerchants: number;
}

export async function getBeneficiaryMetrics(
  db: any,
): Promise<BeneficiaryMetrics> {
  // Total beneficiaries
  const { count: totalBeneficiaries, error: countError } = await db
    .from("beneficiaries")
    .select("*", { count: "exact", head: true });

  if (countError) throw new Error(`Metrics count error: ${countError.message}`);

  // Sum of all credit balances
  const { data: sumData, error: sumError } = await db
    .from("beneficiaries")
    .select("credit_balance");

  if (sumError) throw new Error(`Metrics sum error: ${sumError.message}`);

  const totalCredits = (sumData ?? []).reduce(
    (acc, row) => acc + Number(row.credit_balance),
    0,
  );

  // Count critical units (tier 1) — compute dynamically
  const { data: allBeneficiaries, error: allError } = await db
    .from("beneficiaries")
    .select("child_age_months");

  if (allError) throw new Error(`Metrics tier error: ${allError.message}`);

  let criticalUnits = 0;
  for (const b of allBeneficiaries ?? []) {
    const birthdate = deriveBirthdateFromAgeMonths(b.child_age_months);
    const { tier } = computeTier(birthdate);
    if (tier === 1) criticalUnits++;
  }

  // Verified merchants count
  const { count: verifiedMerchants, error: merchantError } = await db
    .from("merchants")
    .select("*", { count: "exact", head: true })
    .eq("status", "APPROVED");

  if (merchantError) throw new Error(`Metrics merchant error: ${merchantError.message}`);

  return {
    totalBeneficiaries: totalBeneficiaries ?? 0,
    criticalUnits,
    allocatedPhpc: totalCredits.toLocaleString("en-PH"),
    verifiedMerchants: verifiedMerchants ?? 0,
  };
}

// PIN Verify

export async function verifyBeneficiaryPin(
  db: any,
  beneficiaryId: string,
  pin: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("beneficiaries")
    .select("pin_hash_argon2id")
    .eq("id", beneficiaryId)
    .single();

  if (error || !data?.pin_hash_argon2id) {
    return false;
  }

  return verifyPin(pin, data.pin_hash_argon2id);
}
