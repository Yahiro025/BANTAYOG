"use client";

import Link from "next/link";
import { useState } from "react";
import { WalletBalanceCard } from "@/components/merchant/wallet-balance-card";
import { RecentTransactions } from "@/components/merchant/recent-transactions";
import { useMerchantProfile } from "@/hooks/use-merchant-profile";
import { LogoutConfirmationModal } from "@/components/merchant/logout-confirmation-modal";

// Merchant Dashboard — matches merchantPages/13.png

export default function MerchantDashboard() {
  const { data: profile, isLoading, isError, refetch } = useMerchantProfile();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#fdf2ed]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#034C52] border-t-transparent" />
        <p className="mt-4 font-body text-sm font-semibold text-[#034C52]">Loading dashboard...</p>
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#fdf2ed] px-5 text-center">
        <p className="font-body text-base font-bold text-[#034C52]">Failed to load profile</p>
        <p className="mt-2 font-body text-sm text-[#034C52]/60">There was an error loading your store profile.</p>
        <button
          onClick={() => refetch()}
          className="mt-6 rounded-xl bg-[#034C52] px-6 py-2.5 font-body text-sm font-bold text-white transition-colors hover:bg-[#034C52]/90"
        >
          Retry
        </button>
      </div>
    );
  }

  const storeName = profile.storeName || "Unnamed Store";

  return (
    <div className="min-h-dvh bg-[#fdf2ed]">
      {/* ── Header ── */}
      <header className="relative flex items-center justify-between border-b border-gray-200 bg-[#fdf2ed] px-5 py-4 z-40">
        {/* Left: profile icon + store info */}
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="relative h-11 w-11 rounded-full border-2 border-[#034C52]/20 bg-[#034C52] transition-transform active:scale-95"
            aria-label="Profile menu"
          >
            <img
              src="/merchantLogos/profile.png"
              alt="Store profile"
              className="h-full w-full rounded-full object-cover"
            />
          </button>
          <div>
            <h1 className="font-body text-sm font-bold text-[#034C52]">
              {storeName}
            </h1>
            <div className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-[#a8d5ba] bg-[#f0faf3] px-2 py-0.5">
              <img
                src="/merchantLogos/verifiedBadge.png"
                alt="Verified"
                className="h-3.5 w-3.5"
              />
              <span className="font-body text-[10px] font-semibold text-[#034C52]">
                Verified Store
              </span>
            </div>
          </div>
        </div>

        {/* Dropdown Menu */}
        {isDropdownOpen && (
          <>
            <div 
              className="fixed inset-0 z-30" 
              onClick={() => setIsDropdownOpen(false)} 
            />
            <div className="absolute left-5 top-[72px] z-40 w-64 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
              <div className="mb-4">
                <p className="font-body text-sm font-bold text-[#034C52]">{storeName}</p>
                <p className="font-body text-xs text-gray-500">{profile.ownerName}</p>
              </div>
              <button
                onClick={() => {
                  setIsDropdownOpen(false);
                  setIsLogoutModalOpen(true);
                }}
                className="w-full rounded-xl bg-red-50 py-2.5 font-body text-sm font-bold text-red-600 transition-colors hover:bg-red-100 active:bg-red-200"
              >
                Logout
              </button>
            </div>
          </>
        )}

        {/* Right: BANTAYOG logo */}
        <img
          src="/merchantLogos/darkTitle.png"
          alt="BANTAYOG"
          className="h-14 w-auto"
        />
      </header>

      {/* ── Content ── */}
      <div className="space-y-7 px-5 py-6">
        {/* 1. Wallet Balance Card */}
        <WalletBalanceCard
          balance={profile.walletBalance}
          walletAddress={profile.walletAddress}
          connected={profile.connected}
          isLoading={isLoading}
          isError={isError}
          refetch={refetch}
        />

        {/* 2. Merchant Actions — Scan Cart Items */}
        <section>
          <h2 className="mb-3 font-body text-xs font-semibold uppercase tracking-widest text-gray-400">
            Merchant Actions
          </h2>
          <Link
            href="/cart"
            className="flex items-center gap-4 rounded-2xl bg-[#f48d79] px-5 py-5 transition-colors hover:bg-[#f9a899] active:brightness-95"
            aria-label="Scan Cart Items - Verify and process cart items"
          >
            <img
              src="/merchantLogos/camera.png"
              alt="Camera"
              className="h-14 w-14 flex-shrink-0 rounded-xl"
            />
            <div className="flex-1">
              <p className="font-body text-base font-bold text-[#034C52]">
                Scan Cart Items
              </p>
              <p className="font-body text-sm text-[#034C52]/60">
                Verify and process cart items
              </p>
            </div>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#034C52"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
        </section>

        {/* 3. Recent Transactions */}
        <RecentTransactions />
      </div>

      {/* Logout Confirmation Modal */}
      <LogoutConfirmationModal 
        isOpen={isLogoutModalOpen} 
        onClose={() => setIsLogoutModalOpen(false)} 
      />
    </div>
  );
}
