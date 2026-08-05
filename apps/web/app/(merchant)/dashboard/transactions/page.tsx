"use client";

import Link from "next/link";
import { RecentTransactions } from "@/components/merchant/recent-transactions";

// Full Transaction History Page — /dashboard/transactions

export default function TransactionHistoryPage() {
  return (
    <div className="min-h-dvh bg-[#fdf2ed]">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 pt-12 pb-5">
        <Link
          href="/dashboard"
          aria-label="Back to dashboard"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white shadow-sm transition-colors hover:bg-gray-50 active:brightness-95"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#034C52"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div>
          <h1 className="font-title text-xl font-black text-[#034C52]">
            Transaction History
          </h1>
          <p className="font-body text-xs text-gray-400">
            All transactions from your store
          </p>
        </div>
      </header>

      {/* Content */}
      <div className="px-5 pb-10">
        <RecentTransactions limit={100} showViewAll={false} />
      </div>
    </div>
  );
}
