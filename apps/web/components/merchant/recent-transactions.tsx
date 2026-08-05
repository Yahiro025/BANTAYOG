"use client";

import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/api";
import Link from "next/link";

// Recent Transactions List — embedded in dashboard (ref: 13.png)

interface TransactionItem {
  category: string;
  name: string;
  quantity: number;
  unitPricePhp: number;
  creditCost: number;
}

interface Transaction {
  id: string;
  beneficiaryId: string;
  merchantId: string;
  items: TransactionItem[];
  totalCreditDeducted: number;
  stablecoinAmountWei: string;
  onchainTxHash: string | null;
  idempotencyKey: string;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
}

interface TransactionsResponse {
  data: Transaction[];
  count: number;
}

interface RecentTransactionsProps {
  /** How many transactions to show. Defaults to 3 for the dashboard. */
  limit?: number;
  /** When true, shows a "View All Transactions" link if there are more records. */
  showViewAll?: boolean;
}

async function fetchTransactions(limit: number): Promise<{ data: Transaction[]; count: number }> {
  const res = await authFetch(`/api/transactions?limit=${limit + 1}`); // fetch +1 to detect "has more"
  if (!res.ok) {
    throw new Error("Failed to fetch transactions");
  }
  const result: TransactionsResponse = await res.json();
  return { data: result.data || [], count: result.count ?? 0 };
}

export function RecentTransactions({ limit = 3, showViewAll = true }: RecentTransactionsProps) {
  const {
    data: response,
    isLoading,
    error,
  } = useQuery<{ data: Transaction[]; count: number }>({
    queryKey: ["merchant-transactions", limit],
    queryFn: () => fetchTransactions(limit),
    refetchInterval: 5000,
    staleTime: 3000,
    placeholderData: (prev) => prev,
  });

  const transactions = response?.data ?? [];
  // If we fetched limit+1 and got limit+1 back, there are more
  const hasMore = transactions.length > limit;
  const visible = hasMore ? transactions.slice(0, limit) : transactions;

  // Loading state
  if (isLoading && !response) {
    return (
      <section aria-live="polite" aria-busy="true">
        <h2 className="mb-3 font-body text-xs font-semibold uppercase tracking-widest text-gray-400">
          Recent Transactions
        </h2>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-2xl border border-gray-200 bg-white px-5 py-4"
            >
              <div className="mb-3 h-4 w-32 rounded bg-gray-200" />
              <div className="space-y-2">
                <div className="h-3 w-full rounded bg-gray-100" />
                <div className="h-3 w-3/4 rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  // Error state
  if (error && !response) {
    return (
      <section>
        <h2 className="mb-3 font-body text-xs font-semibold uppercase tracking-widest text-gray-400">
          Recent Transactions
        </h2>
        <div className="rounded-2xl border border-gray-200 bg-white px-5 py-8 text-center" role="alert">
          <p className="font-body text-sm text-gray-500">
            Unable to load transactions
          </p>
        </div>
      </section>
    );
  }

  // Empty state
  if (!visible || visible.length === 0) {
    return (
      <section>
        <h2 className="mb-3 font-body text-xs font-semibold uppercase tracking-widest text-gray-400">
          Recent Transactions
        </h2>
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-10 text-center">
          <p className="font-body text-sm text-gray-500">
            No transactions yet — your first sale is just a scan away!
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-3 font-body text-xs font-semibold uppercase tracking-widest text-gray-400">
        Recent Transactions
      </h2>

      <div className="space-y-4">
        {visible.map((txn) => {
          const formattedTotal = txn.totalCreditDeducted.toFixed(2);
          const isFailed = txn.status === "FAILED";
          const isPending = txn.status === "PENDING";

          return (
            <div
              key={txn.id}
              className={`rounded-2xl border bg-white px-5 py-4 ${
                isFailed ? "border-red-200" : "border-gray-200"
              }`}
            >
              {/* Header: Transaction ID + Status */}
              <div className="mb-3 flex items-center justify-between">
                <span className="rounded bg-gray-100 px-2 py-0.5 font-body text-[10px] font-semibold text-gray-500">
                  {txn.id.slice(0, 8)}…
                </span>
                {isFailed && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 font-body text-[10px] font-bold text-red-600">
                    FAILED
                  </span>
                )}
                {isPending && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-body text-[10px] font-bold text-amber-600">
                    PENDING
                  </span>
                )}
                {txn.status === "CONFIRMED" && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 font-body text-[10px] font-bold text-green-700">
                    SUCCESS
                  </span>
                )}
              </div>

              {/* Items */}
              <div className="space-y-1.5">
                {(txn.items || []).map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-baseline justify-between"
                  >
                    <div>
                      <span className={`font-body text-sm ${isFailed ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                        {item.name}
                      </span>
                      <span className="ml-2 font-body text-xs text-gray-400">
                        Qty: {item.quantity}
                      </span>
                    </div>
                    <span className={`font-body text-sm ${isFailed ? 'text-gray-400' : 'text-gray-500'}`}>
                      ₱{item.creditCost.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="mt-3 border-t border-gray-100 pt-2 flex items-center justify-between">
                <span className="font-body text-xs text-gray-400">
                  {new Date(txn.createdAt).toLocaleDateString()}
                </span>
                <span className={`font-body text-lg font-extrabold ${isFailed ? 'text-red-400 line-through' : 'text-[#034C52]'}`}>
                  {isFailed ? '' : '+'}{formattedTotal} PHPC
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* View All link */}
      {showViewAll && hasMore && (
        <Link
          href="/dashboard/transactions"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-[#034C52]/20 bg-white py-3.5 font-body text-sm font-semibold text-[#034C52] transition-colors hover:bg-[#034C52]/5 active:brightness-95"
        >
          View All Transactions
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      )}
    </section>
  );
}
