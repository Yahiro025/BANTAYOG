"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCartStore } from "@/stores/cart-store";

// Transaction Complete Page (ref: 28.png)

export default function TransactionCompletePage() {
  return (
    <Suspense>
      <TransactionCompleteContent />
    </Suspense>
  );
}

function TransactionCompleteContent() {
  const searchParams = useSearchParams();
  const clearCart = useCartStore((s) => s.clearCart);

  const amount = searchParams.get("amount") || "0";
  const beneficiary = searchParams.get("beneficiary") || "Beneficiary";
  const remaining = searchParams.get("remaining") || "0";

  // Clear cart on mount
  useEffect(() => {
    clearCart();
  }, [clearCart]);

  return (
    <div className="min-h-dvh bg-[#fdf2ed]">
      {/* Content */}
      <div className="flex flex-col items-center px-6 pt-16 pb-8">
        {/* Success Illustration */}
        <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-[#d1fae5]" role="img" aria-label="Transaction successful">
          <img
            src="/merchantLogos/green_correct.png"
            alt="Success checkmark"
            className="h-14 w-14"
          />
        </div>

        {/* Title */}
        <h1 className="font-title text-2xl font-black text-[#034C52]">
          Transaction Completed
        </h1>
        <p className="mt-2 text-center font-body text-sm text-gray-500">
          Bantayog Credits successfully transferred
          <br />
          to your Digital Wallet
        </p>

        {/* Summary Card */}
        <div className="mt-8 w-full rounded-2xl border border-gray-200 bg-white px-5 py-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <span className="font-body text-sm text-gray-500">Payment:</span>
              <span className="font-body text-base font-extrabold text-[#034C52]">
                {amount} PHPC
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <span className="font-body text-sm text-gray-500">
                Beneficiary:
              </span>
              <span className="font-body text-sm font-bold text-gray-800">
                {beneficiary}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-body text-sm text-gray-500">
                Remaining Bal:
              </span>
              <span className="font-body text-sm font-semibold text-gray-700">
                {remaining} PHC
              </span>
            </div>
          </div>
        </div>

        {/* Return Button */}
        <Link
          href="/dashboard"
          className="mt-10 block w-full rounded-2xl bg-[#034C52] py-4 text-center font-body text-base font-bold text-white transition-colors hover:bg-[#017075] active:brightness-95"
        >
          Return to Store Dashboard
        </Link>
      </div>
    </div>
  );
}
