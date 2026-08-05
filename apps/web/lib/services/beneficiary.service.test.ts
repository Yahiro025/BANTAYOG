import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@bantayog/db";
import {
  registerBeneficiary,
  listBeneficiaries,
  addCredits,
  getBeneficiaryMetrics,
  verifyBeneficiaryPin,
} from "./beneficiary.service";
import type { CreateBeneficiaryDto } from "@bantayog/schema";

// Mock chain clients to avoid stellar-sdk env deps
vi.mock("@/lib/chain/client", () => ({
  getPublicClient: () => ({
    readContract: vi.fn(() => Promise.resolve(BigInt(1_000_000 * 1e18))),
    waitForTransactionReceipt: vi.fn(() => Promise.resolve({ blockNumber: 1n })),
  }),
  getWalletClient: () => ({
    account: { address: "0x1234567890123456789012345678901234567890" },
    writeContract: vi.fn(() => Promise.resolve("0xtxhash")),
  }),
  getSorobanChain: () => ({
    id: 99999,
    name: "Soroban Local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:8545"] }, public: { http: ["http://127.0.0.1:8545"] } },
  }),
}));

vi.mock("@/lib/chain/contracts", () => ({
  phpcSubsidyAddress: () => "0x1111111111111111111111111111111111111111",
  PHPC_SUBSIDY_ABI: [],
}));

vi.mock("@/lib/env", () => ({
  getQrTokenSecret: () => "test-secret-for-qr-tokens-only-32b",
}));

function createMockDb(): SupabaseClient<Database> {
  return {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                id: "550e8400-e29b-41d4-a716-446655440000",
                guardian_name: "Maria Cruz",
                guardian_mobile_hash: "abc123",
                child_name: "Juan Cruz",
                child_age_months: 12,
                monthly_income_php: 8000,
                gps_lat: 14.5995,
                gps_lng: 120.9842,
                pin_hash_argon2id: "$argon2id$mock",
                eligibility_status: "ELIGIBLE",
                credit_balance: 0,
                card_serial: "BTG-2026-001",
                created_at: new Date().toISOString(),
              },
              error: null,
            }),
          ),
        })),
      })),
      select: vi.fn(() => ({
        order: vi.fn(() =>
          Promise.resolve({
            data: [
              {
                id: "550e8400-e29b-41d4-a716-446655440000",
                guardian_name: "Maria Cruz",
                child_name: "Juan Cruz",
                child_age_months: 12,
                credit_balance: 0,
                card_serial: "BTG-2026-001",
                created_at: new Date().toISOString(),
              },
            ],
            error: null,
          }),
        ),
        eq: vi.fn(() => ({
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                id: "550e8400-e29b-41d4-a716-446655440000",
                credit_balance: 100,
                pin_hash_argon2id: "$argon2id$mock",
              },
              error: null,
            }),
          ),
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
    auth: {
      admin: {
        createUser: vi.fn(() => Promise.resolve({ data: { user: { id: "auth-123" } }, error: null })),
        getUserById: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
        deleteUser: vi.fn(() => Promise.resolve({ error: null })),
      },
    },
  } as unknown as SupabaseClient<Database>;
}

describe("beneficiary.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a beneficiary and returns tier + QR token", async () => {
    const db = createMockDb();
    const dto: CreateBeneficiaryDto = {
      guardianName: "Maria Cruz",
      guardianMobileHash: "abc123",
      childName: "Juan Cruz",
      childAgeMonths: 12,
      monthlyIncomePhp: 8000,
      gpsLat: 14.5995,
      gpsLng: 120.9842,
      pin: "123456",
    };

    const result = await registerBeneficiary(db, dto);
    expect(result.beneficiary.child_name).toBe("Juan Cruz");
    expect(result.tier).toBe(1);
    expect(result.cardSerial).toMatch(/^BTG-\d{4}-\d{3}$/);
    expect(result.qrToken.jwsCompact).toContain(".");
  });

  it("lists beneficiaries with tier info", async () => {
    const db = createMockDb();
    const list = await listBeneficiaries(db);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].tier).toBeDefined();
    expect(list[0].jwsCompact).toBeDefined();
  });

  it("adds credits and returns new balance", async () => {
    const db = createMockDb();
    const result = await addCredits(db, "550e8400-e29b-41d4-a716-446655440000", 50);
    expect(result.amountAdded).toBe(50);
    expect(result.newBalance).toBe(150);
  });

  it("throws on invalid credit amount", async () => {
    const db = createMockDb();
    await expect(addCredits(db, "id", -10)).rejects.toThrow("positive number");
    await expect(addCredits(db, "id", 0)).rejects.toThrow("positive number");
  });

  it("returns metrics", async () => {
    const db = createMockDb();
    const metrics = await getBeneficiaryMetrics(db);
    expect(metrics.totalBeneficiaries).toBeDefined();
    expect(metrics.criticalUnits).toBeDefined();
    expect(metrics.allocatedPhpc).toBeDefined();
    expect(metrics.verifiedMerchants).toBeDefined();
  });

  it("verifies PIN against hash", async () => {
    const db = createMockDb();
    const result = await verifyBeneficiaryPin(db, "id", "123456");
    expect(typeof result).toBe("boolean");
  });
});
