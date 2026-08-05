import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@bantayog/db";
import { registerMerchant, listMerchants, approveMerchant } from "./merchant.service";
import type { CreateMerchantDto } from "@bantayog/schema";

vi.mock("@/lib/chain/client", () => ({
  getPublicClient: () => ({
    readContract: vi.fn(() => Promise.resolve(0n)),
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
  merchantRegistryAddress: () => "0x2222222222222222222222222222222222222222",
  MERCHANT_REGISTRY_ABI: [],
}));

function createMockDb(): SupabaseClient<Database> {
  return {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                id: "m-001",
                auth_user_id: "auth-merchant-1",
                store_name: "Aling Nena's",
                owner_name: "Nena Ramos",
                mobile_number_e164: "+639171234567",
                wallet_address: "0x9999999999999999999999999999999999999999",
                status: "PENDING",
                created_at: new Date().toISOString(),
              },
              error: null,
            }),
          ),
        })),
      })),
      select: vi.fn(() => {
        const chainable = {
          order: vi.fn(() => chainable),
          eq: vi.fn(() => chainable),
          range: vi.fn(() =>
            Promise.resolve({
              data: [
                {
                  id: "m-001",
                  store_name: "Aling Nena's",
                  owner_name: "Nena Ramos",
                  mobile_number_e164: "+639171234567",
                  status: "APPROVED",
                },
              ],
              error: null,
            }),
          ),
          single: vi.fn(() =>
            Promise.resolve({
              data: {
                id: "m-001",
                wallet_address: "0x9999999999999999999999999999999999999999",
                status: "PENDING",
              },
              error: null,
            }),
          ),
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        };
        return chainable;
      }),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: {
                  id: "m-001",
                  status: "APPROVED",
                  wallet_address: "0x9999999999999999999999999999999999999999",
                },
                error: null,
              }),
            ),
          })),
        })),
      })),
    })),
    auth: {
      admin: {
        createUser: vi.fn(() => Promise.resolve({ data: { user: { id: "auth-merchant-1" } }, error: null })),
        getUserById: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
        deleteUser: vi.fn(() => Promise.resolve({ error: null })),
      },
    },
  } as unknown as SupabaseClient<Database>;
}

describe("merchant.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a merchant and returns record + authUserId", async () => {
    const db = createMockDb();
    const dto: CreateMerchantDto = {
      storeName: "Aling Nena's",
      ownerName: "Nena Ramos",
      mobileNumberE164: "+639171234567",
    };

    const result = await registerMerchant(db, dto, "password123");
    expect(result.merchant.store_name).toBe("Aling Nena's");
    expect(result.authUserId).toBe("auth-merchant-1");
  });

  it("lists merchants with optional filters", async () => {
    const db = createMockDb();
    const list = await listMerchants(db, { status: "APPROVED", page: 1, limit: 10 });
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].status).toBe("APPROVED");
  });

  it("approves a merchant and updates status", async () => {
    const db = createMockDb();
    const updated = await approveMerchant(db, "m-001");
    expect(updated.status).toBe("APPROVED");
  });
});
