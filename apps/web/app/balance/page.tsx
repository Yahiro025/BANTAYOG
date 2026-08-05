"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/* ─────────────────────────────────────────────────────────
   Read-only Beneficiary Balance View (Requirement 8)

   Reached by scanning a beneficiary's QR pass, which encodes a URL of the
   form  /balance?token=<signed-qr-jwt> . This page is intentionally PUBLIC
   and PIN-less — it is authorized solely by the signed QR token and shows
   ONLY the current balance and transaction history. There are no controls
   that can create, modify, or deduct a balance.

   Backend: GET /api/balance/view?token=<qrToken>
   ───────────────────────────────────────────────────────── */

interface BalanceTransaction {
  amount: number;
  status: string;
  onchainTxHash: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

interface BalanceView {
  beneficiaryName: string;
  balance: number;
  transactions: BalanceTransaction[];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; data: BalanceView }
  | { kind: "error"; message: string };

const StellarSCAN_TX = "https://Testnet.Stellarscan.com/tx/";

export default function BalancePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-[#fdf2ed] flex items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <BalanceContent />
    </Suspense>
  );
}

function BalanceContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "error", message: "This pass is invalid or has expired." });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/balance/view?token=${encodeURIComponent(token)}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok) {
          setState({
            kind: "error",
            message:
              body?.message ??
              "Balance information is temporarily unavailable. Please try again later.",
          });
          return;
        }

        setState({ kind: "ok", data: body as BalanceView });
      } catch {
        if (!cancelled) {
          setState({
            kind: "error",
            message: "Balance information is temporarily unavailable. Please try again later.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-dvh bg-[#fdf2ed]">
      {/* Header */}
      <header className="px-6 pt-8 pb-5 text-center">
        <p className="font-body text-[10px] font-bold uppercase tracking-[0.2em] text-[#034C52]/50">
          Republic of the Philippines · BANTAYOG
        </p>
        <h1 className="mt-1 font-title text-xl font-black text-[#034C52]">
          Nutrition Pass Balance
        </h1>
      </header>

      <div className="h-px bg-[#034C52]/10" />

      <div className="px-5 py-6">
        {state.kind === "loading" && (
          <div className="flex flex-col items-center gap-3 py-16">
            <Spinner />
            <p className="font-body text-sm text-[#034C52]/50">Loading balance…</p>
          </div>
        )}

        {state.kind === "error" && (
          <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="font-body text-sm font-semibold text-red-700">{state.message}</p>
          </div>
        )}

        {state.kind === "ok" && (
          <>
            {/* Balance card */}
            <div className="rounded-3xl bg-[#034C52] px-7 py-8 text-center shadow-sm">
              <p className="font-body text-base font-bold text-white/90">
                {state.data.beneficiaryName}
              </p>
              <div className="h-px w-16 bg-white/10 mx-auto my-4" />
              <p className="font-body text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                Current Balance
              </p>
              <p className="mt-2 font-title text-4xl font-black text-white">
                {state.data.balance.toLocaleString("en-PH")}
                <span className="ml-1 text-lg font-bold text-white/60">PHPC</span>
              </p>
            </div>

            {/* Transaction history */}
            <div className="mt-6">
              <h2 className="mb-3 font-body text-sm font-bold text-[#034C52]">
                Transaction History
              </h2>

              {state.data.transactions.length === 0 ? (
                <div className="rounded-2xl border border-gray-200 bg-white px-5 py-10 text-center">
                  <p className="font-body text-sm text-gray-500">No transactions yet.</p>
                </div>
              ) : (
                <ul className="space-y-3 list-none p-0 m-0">
                  {state.data.transactions.map((tx, i) => (
                    <li
                      key={tx.onchainTxHash ?? `${tx.createdAt}-${i}`}
                      className="rounded-2xl border border-gray-200 bg-white px-4 py-3.5"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-body text-sm font-bold text-[#034C52]">
                            −{tx.amount.toLocaleString("en-PH")} PHPC
                          </p>
                          <p className="mt-0.5 font-body text-xs text-gray-400">
                            {formatDate(tx.confirmedAt ?? tx.createdAt)}
                          </p>
                        </div>
                        <StatusPill status={tx.status} />
                      </div>
                      {tx.onchainTxHash && (
                        <a
                          href={`${StellarSCAN_TX}${tx.onchainTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-1 font-body text-[11px] font-semibold text-[#017075] hover:underline"
                        >
                          View on-chain
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="mt-8 text-center font-body text-[11px] text-[#034C52]/40">
              This is a read-only view. Balances can only be changed by an
              authorized merchant transaction.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = status?.toUpperCase();
  const isConfirmed = s === "CONFIRMED";
  const isFailed = s === "FAILED";
  const cls = isConfirmed
    ? "bg-green-50 border-green-300 text-green-700"
    : isFailed
      ? "bg-red-50 border-red-200 text-red-600"
      : "bg-amber-50 border-amber-200 text-amber-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-body text-[10px] font-bold ${cls}`}>
      {s ?? "PENDING"}
    </span>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-7 w-7 text-[#017075]" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
