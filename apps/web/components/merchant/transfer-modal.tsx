"use client";

import { useState, useRef, useEffect } from "react";
import { authFetch } from "@/lib/api";

// Transfer Modal — matches merchantPages/14.png

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
  balance: string;
  phpEquivalent: string;
  walletAddress: string | null;
  onTransferSuccess?: () => void;
}

export function TransferModal({
  open,
  onClose,
  balance,
  phpEquivalent,
  walletAddress,
  onTransferSuccess,
}: TransferModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus first interactive element on open
  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
    }
  }, [open]);

  // Escape key closes modal
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopy = async () => {
    if (!walletAddress) {
      setError("No wallet address available to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy did not succeed");
    }
  };

  const handleConfirm = async () => {
    if (!walletAddress) {
      setError("Wallet address is required for transfer");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await authFetch("/api/merchants/me/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: walletAddress,
        }),
      });

      if (res.ok) {
        onTransferSuccess?.();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? "Transfer failed. Please try again.");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Transfer to Freighter Wallet"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-sm rounded-3xl bg-white px-6 py-8 shadow-2xl">
        {/* Close button */}
        <button
          type="button"
          ref={closeButtonRef}
          onClick={onClose}
          disabled={loading}
          className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
          aria-label="Close"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Illustration: wallet → Freighter */}
        <div className="mb-5 flex items-center justify-center gap-4">
          <img
            src="/merchantLogos/wallet2.png"
            alt="Digital wallet"
            className="h-14 w-14 rounded-xl"
          />
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#034C52"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          <img
            src="/merchantLogos/wallet.png"
            alt="Freighter Wallet"
            className="h-14 w-14 rounded-xl"
          />
        </div>

        {/* Title */}
        <h2 className="mb-2 text-center font-body text-xl font-bold text-[#034C52]">
          Transfer to Freighter Wallet
        </h2>
        <p className="mb-6 text-center font-body text-sm text-gray-500">
          You are about to transfer your entire digital wallet balance to your
          Stellar (Freighter) Wallet Address
        </p>

        {/* Amount Card */}
        <div className="mb-3 rounded-xl border border-[#c8e6d0] bg-[#f0faf3] px-5 py-4">
          <p className="mb-1 font-body text-xs font-semibold uppercase tracking-wider text-[#034C52]">
            Amount to Transfer
          </p>
          <p className="font-body text-2xl font-extrabold text-[#034C52]">
            {balance} <span className="text-base font-bold">PHPC</span>
          </p>
          <p className="font-body text-sm text-gray-500">
            = {phpEquivalent} PHP
          </p>
        </div>

        {/* Address Card */}
        <div className="mb-5 rounded-xl border border-[#c8e6d0] bg-[#f0faf3] px-5 py-4">
          <p className="mb-1 font-body text-xs font-semibold uppercase tracking-wider text-[#034C52]">
            Stellar Wallet Address
          </p>
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate rounded-lg border border-gray-200 bg-white px-3 py-2 font-body text-sm text-gray-600">
              {walletAddress || ""}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white transition-colors hover:bg-gray-50"
              aria-label="Copy wallet address"
            >
              <img
                src="/merchantLogos/copy_paste.png"
                alt="Copy to clipboard"
                className="h-5 w-5 opacity-50"
              />
            </button>
          </div>
          {copied && (
            <p className="mt-1.5 font-body text-xs text-green-600" aria-live="polite">Copied!</p>
          )}
        </div>

        {/* Warning */}
        <div className="mb-6 flex items-start gap-2.5 rounded-lg bg-[#fef3e2] px-4 py-3">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#d97706"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 flex-shrink-0"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="font-body text-sm text-[#92400e]">
            Once transferred, this amount will be sent to your Freighter wallet
            and cannot be reversed.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-center" role="alert">
            <p className="font-body text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 rounded-full border-2 border-[#034C52] py-3 font-body text-sm font-bold text-[#034C52] transition-colors hover:bg-[#034C52]/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || !walletAddress}
            className="flex-1 rounded-full bg-[#f48d79] py-3 font-body text-sm font-bold text-[#034C52] transition-colors hover:bg-[#f9a899] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Sending...
              </span>
            ) : (
              "Confirm Transfer"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
