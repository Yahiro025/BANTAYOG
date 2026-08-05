"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/stores/cart-store";
import { CartSummary } from "@/components/merchant/cart-summary";
import { ItemCard } from "@/components/merchant/item-card";
import { QRScanner } from "@/lib/qr/scanner";
import { authFetch, clearMerchantToken } from "@/lib/api";
import { useMerchantProfile } from "@/hooks/use-merchant-profile";

/**
 * Extracts the raw QR token from a scanned value. The beneficiary QR pass now
 * encodes a balance URL ( /balance?token=<jwt> ), but older passes may encode
 * the raw JWT directly — handle both.
 */
function extractQrToken(scanned: string): string {
  try {
    const url = new URL(scanned);
    const t = url.searchParams.get("token");
    if (t) return t;
  } catch {
    /* not a URL — fall through */
  }
  return scanned;
}

/**
 * Masks the beneficiary guardian's name for privacy.
 * e.g., "Juan Dela Cruz" -> "J*** D*** C***"
 */
function maskName(name: string): string {
  if (!name || name === "Beneficiary" || name === "Guardian") return name;
  return name
    .split(" ")
    .map((word) => {
      if (word.length === 0) return "";
      if (word.length === 1) return word;
      return word[0] + "*".repeat(word.length - 1);
    })
    .join(" ");
}

// Checkout Page + QR Scanner Modal + PIN Validation Modal (ref: 25-27.png)

type ModalState = "none" | "qr-scan" | "pin";

export default function CheckoutPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const inputSource = useCartStore((s) => s.inputSource);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clearCart);

  const { data: profile } = useMerchantProfile();
  const storeName = profile?.storeName || "Unnamed Store";

  const [modalState, setModalState] = useState<ModalState>("none");
  const [beneficiaryData, setBeneficiaryData] = useState<{
    id: string;
    name: string;
    guardianName: string;
    balance: number;
  } | null>(null);
  /** Raw signed QR token, forwarded to POST /api/transactions as `qrToken`. */
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [pinError, setPinError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  /**
   * Bug 3 fix — back-button loop:
   * After the user presses Back on the PIN modal, we re-open the QR scanner.
   * Without a cooldown the camera instantly re-scans the card still in front
   * of the lens and jumps straight back to the PIN modal. The cooldown
   * suppresses scan results for 2 seconds, giving the user time to move the card.
   */
  const [scanCooldown, setScanCooldown] = useState(false);
  const checkoutButtonRef = useRef<HTMLButtonElement>(null);
  const qrCloseButtonRef = useRef<HTMLButtonElement>(null);

  // QR Scanner ref — html5-qrcode uses a container div ID, not a video ref
  const scannerRef = useRef<QRScanner | null>(null);
  const QR_CONTAINER_ID = "bantayog-qr-reader";

  // Filter to eligible items only
  const eligibleItems = items.filter((i) => i.eligibility === "eligible");
  const total = eligibleItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  // Back navigation based on input source
  const backHref =
    inputSource === "branded" ? "/cart/branded?resume=result" : "/cart/non-branded?resume=result";

  // ── Handle QR Scanner Close ──
  const handleCloseQRScanner = useCallback(() => {
    scannerRef.current?.stop().catch(() => {});
    setCameraError(null);
    setScanCooldown(false);
    setModalState("none");
    // Return focus to the trigger element
    setTimeout(() => checkoutButtonRef.current?.focus(), 0);
  }, []);

  // ── Start QR Scanner when modal opens ──
  useEffect(() => {
    if (modalState !== "qr-scan") return;

    // html5-qrcode needs the container div to exist in the DOM before we
    // call start(). A short timeout lets React finish rendering the modal.
    const timeout = setTimeout(() => {
      const scanner = new QRScanner();
      scannerRef.current = scanner;

      scanner
        .start(
          QR_CONTAINER_ID,
          (result) => {
            // Bug 3 fix: ignore scan results during the cooldown window so
            // pressing Back on the PIN modal doesn't instantly re-trigger it.
            if (scanCooldown) return;
            handleQRScanResult(result.text);
          },
          (err) => {
            setCameraError(
              err.message || "Camera access denied. Please allow camera access.",
            );
          },
        )
        .catch((err) => {
          setCameraError(
            err instanceof Error
              ? err.message
              : "Camera access denied. Please allow camera access.",
          );
        });
    }, 100);

    return () => {
      clearTimeout(timeout);
      scannerRef.current?.stop().catch(() => {});
      scannerRef.current = null;
    };
  }, [modalState]);

  // ── Escape key closes QR scanner modal ──
  useEffect(() => {
    if (modalState !== "qr-scan") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCloseQRScanner();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalState, handleCloseQRScanner]);

  // ── Focus QR scanner close button on open ──
  useEffect(() => {
    if (modalState === "qr-scan") {
      qrCloseButtonRef.current?.focus();
    }
  }, [modalState]);

  // ── Handle QR Scan Result ──
  const handleQRScanResult = useCallback(
    (scanned: string) => {
      if (scanned.startsWith("http://") || scanned.startsWith("https://")) {
        setCameraError("Invalid QR Code: Please scan the 'Merchant Scan' QR code.");
        setScanCooldown(true);
        setTimeout(() => {
          setScanCooldown(false);
          setCameraError(null);
        }, 3000);
        return;
      }

      // Stop scanner after successful scan
      scannerRef.current?.stop();

      const token = extractQrToken(scanned);
      setQrToken(token);
      setSubmitError(null);
      setPinError(false);

      // Decode the JWT payload purely for display (name/guardian). The token
      // is verified server-side during the transaction; this client-side
      // decode is best-effort and never trusted for authorization.
      let display = {
        id: "",
        name: "Beneficiary",
        guardianName: "Guardian",
        balance: 0,
      };
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(
            atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
          );
          display = {
            id: payload.beneficiaryId || payload.sub || "",
            name: payload.childName || payload.name || "Beneficiary",
            guardianName: payload.guardianName || "Guardian",
            balance: 0,
          };
        }
      } catch {
        /* keep defaults — server will reject an invalid token */
      }

      setBeneficiaryData(display);
      setModalState("pin");
    },
    [],
  );

  // ── PIN Verification + real on-chain settlement (POST /api/transactions) ──
  const handlePinComplete = useCallback(
    async (pin: string) => {
      setPinError(false);
      setSubmitError(null);
      if (!beneficiaryData || !qrToken || submitting) return;

      // Map cart items to the transaction API schema. Cart items carry a
      // nutrition category (which defaults to VEGETABLES if missing); the
      // credit cost is the whole-PHPC line total (server converts 1 credit =
      // 1 PHPC and requires integer amounts).
      const txItems = eligibleItems.map((item) => ({
        category: (item.category || "VEGETABLES") as any,
        name: item.name,
        quantity: item.quantity,
        unitPricePhp: item.price,
        creditCost: Math.max(1, Math.round(item.price * item.quantity)),
        imageUrl: item.imageDataUrl,
      }));

      // Frontend Validations
      const totalQuantityValid = txItems.every((item) => item.quantity > 0);
      const totalPricesValid = txItems.every((item) => item.unitPricePhp >= 0);
      const computedTotal = eligibleItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const totalMatches = Math.abs(computedTotal - total) < 0.001;

      if (!totalQuantityValid) {
        setSubmitError("Transaction aborted: Item quantities must be greater than zero.");
        return;
      }
      if (!totalPricesValid) {
        setSubmitError("Transaction aborted: Unit prices cannot be negative.");
        return;
      }
      if (!totalMatches) {
        setSubmitError("Transaction aborted: Cart total mismatch detected.");
        return;
      }

      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      setSubmitting(true);
      try {
        const res = await authFetch("/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            qrToken,
            pin,
            items: txItems,
            idempotencyKey,
          }),
        });

        if (res.ok) {
          const txData = await res.json();
          const totalDeducted = txItems.reduce((s, i) => s + i.creditCost, 0);

          const params = new URLSearchParams({
            amount: totalDeducted.toFixed(2),
            beneficiary: maskName(beneficiaryData.name),
          });
          if (typeof txData?.remainingBalance === 'number') {
            params.set("remaining", txData.remainingBalance.toFixed(2));
          }

          // Clear cart and checkout state as a guardrail for the next transaction
          clearCart();
          setQrToken(null);
          setBeneficiaryData(null);
          setModalState("none");

          router.push(`/checkout/complete?${params.toString()}`);
          return;
        }

        const body = await res.json().catch(() => ({}));
        const message: string = body?.message ?? "";

        // 401 with a PIN-specific message → wrong guardian PIN (retryable).
        if (res.status === 401 && /pin/i.test(message)) {
          setPinError(true);
        } else if (res.status === 429) {
          setSubmitError(
            "Too many incorrect PIN attempts. This pass is temporarily locked. Try again later.",
          );
        } else if (res.status === 401) {
          if (/session/i.test(message) || /merchant/i.test(message)) {
            clearMerchantToken();
            router.replace("/merchant-login");
            return;
          } else {
            setSubmitError(message || "Invalid or expired QR token.");
          }
        } else {
          setSubmitError(
            message || "Transaction failed. Please try again.",
          );
        }
      } catch {
        setSubmitError("Network error. Please check your connection and try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [beneficiaryData, qrToken, eligibleItems, submitting, router],
  );

  // ── Empty Cart ──
  if (eligibleItems.length === 0) {
    return (
      <div className="min-h-dvh bg-[#fdf2ed]">
        <header className="flex items-center px-4 pt-5 pb-3">
          <Link
            href={backHref}
            className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-black/5"
            aria-label="Back"
          >
            <svg
              width="20"
              height="20"
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
          <h1 className="flex-1 text-center font-title text-[1.35rem] font-black text-[#034C52]">
            Checkout
          </h1>
          <div className="w-11" />
        </header>
        <div className="h-px bg-gray-400" />
        <div className="flex flex-col items-center justify-center px-5 py-16">
          <p className="font-body text-sm text-gray-500">
            No eligible items in your cart.
          </p>
          <Link
            href="/cart"
            className="mt-4 rounded-full bg-[#034C52] px-6 py-3 font-body text-sm font-bold text-white"
          >
            Add Items
          </Link>
        </div>
      </div>
    );
  }

  const isModalOpen = modalState !== "none";

  return (
    <div className="min-h-dvh bg-[#fdf2ed]">
      <div aria-hidden={isModalOpen || undefined}>
        {/* ── Header ── */}
        <header className="flex items-center px-4 pt-5 pb-3">
          <Link
            href={backHref}
            className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-black/5"
            aria-label="Back"
          >
            <svg
              width="20"
              height="20"
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
          <h1 className="flex-1 text-center font-title text-[1.35rem] font-black text-[#034C52]">
            Checkout
          </h1>
          <div className="w-11" />
        </header>

        <div className="h-px bg-gray-400" />

        {/* ── Content ── */}
        <div className="px-5 pb-8">
          {/* Store Info */}
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#034C52]">
              <img
                src="/merchantLogos/profile.png"
                alt="Store profile"
                className="h-8 w-8 rounded-full"
              />
            </div>
            <div>
              <p className="font-body text-base font-bold text-gray-900">
                {storeName}
              </p>
              <div className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-[#a8d5ba] bg-[#f0faf3] px-2 py-0.5">
                <img
                  src="/merchantLogos/verifiedBadge.png"
                  alt="LGU Verified"
                  className="h-3 w-3"
                />
                <span className="font-body text-[10px] font-semibold text-[#034C52]">
                  LGU Verified Store
                </span>
              </div>
            </div>
          </div>

          {/* Cart Items */}
          <div className="mt-5 rounded-2xl border border-gray-200 bg-white px-4 py-4">
            <h3 className="mb-3 font-body text-base font-bold text-[#034C52]">
              Cart Items ({eligibleItems.length})
            </h3>
            <ul className="space-y-3 list-none p-0 m-0">
              {eligibleItems.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <ItemCard
                      name={item.name}
                      price={item.price}
                      quantity={item.quantity}
                      eligibility={item.eligibility}
                      imageDataUrl={item.imageDataUrl}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="mt-4 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                    aria-label={`Remove ${item.name}`}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Cart Summary */}
          <div className="mt-5">
            <CartSummary />
          </div>

          {/* Payment Method */}
          <div className="mt-5 rounded-2xl border border-gray-200 bg-white px-4 py-4">
            <h3 className="mb-3 font-body text-base font-bold text-[#034C52]">
              Payment Method
            </h3>
            <button
              type="button"
              onClick={() => setModalState("qr-scan")}
              className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 transition-colors hover:bg-gray-100"
            >
              <img
                src="/merchantLogos/qrSample.png"
                alt="QR Code"
                className="h-8 w-8 flex-shrink-0"
              />
              <span className="flex-1 text-left font-body text-sm font-medium text-gray-700">
                Bantayog Credit
              </span>
              <span className="font-body text-sm font-semibold text-gray-600">
                {total.toFixed(2)} PHPC
              </span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#9e8e82"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {/* Checkout Button */}
          <button
            type="button"
            ref={checkoutButtonRef}
            onClick={() => setModalState("qr-scan")}
            className="mt-6 w-full rounded-2xl bg-[#034C52] py-4 font-body text-base font-bold text-white transition-colors hover:bg-[#017075] active:brightness-95"
          >
            Confirm & Checkout
          </button>
        </div>
      </div>

      {/* ── QR Scanner Modal (FE2-3.6) ── */}
      {modalState === "qr-scan" && (
        <div
          className="fixed inset-0 z-50 flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-scanner-title"
        >
          {/* Dark overlay */}
          <div className="absolute inset-0 bg-black/60" aria-hidden="true" />

          {/* Content */}
          <div className="relative flex flex-1 flex-col">
            {/* Header */}
            <div className="flex items-center px-4 pt-5 pb-3">
              <button
                type="button"
                ref={qrCloseButtonRef}
                onClick={handleCloseQRScanner}
                className="flex h-11 w-11 items-center justify-center"
                aria-label="Close QR scanner"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
              <div className="flex-1 text-center">
                <span
                  id="qr-scanner-title"
                  className="inline-block rounded-full bg-[#f48d79] px-6 py-2 font-title text-sm font-black text-[#034C52]"
                >
                  QR Scanner
                </span>
              </div>
              <div className="w-11" />
            </div>

            {/* Scanner Area */}
            <div className="flex flex-1 flex-col items-center justify-center px-8">
              {/* QR Scanner Frame */}
              <div className="relative w-full max-w-sm aspect-square">
                {/* Black background */}
                <div className="absolute inset-0 rounded-3xl bg-black" />

                {/* html5-qrcode injects its own <video> into this div.
                    It must be empty and have a stable ID. */}
                <div
                  id={QR_CONTAINER_ID}
                  className="absolute inset-0 h-full w-full rounded-3xl overflow-hidden"
                  aria-label="Camera viewfinder for scanning QR codes"
                />

                {/* Cooldown overlay — shown briefly after Back is pressed */}
                {scanCooldown && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 rounded-3xl gap-2 p-4 text-center z-10" aria-live="polite">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#f48d79] border-t-transparent" />
                    <p className="font-body text-sm font-semibold text-white/80">
                      Please remove the QR card…
                    </p>
                  </div>
                )}

                {/* Scanner frame border */}
                <div className="pointer-events-none absolute inset-2 rounded-2xl border-2 border-dashed border-[#f48d79]" />

                {/* Corner brackets */}
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute left-4 top-4 h-12 w-12 border-l-[4px] border-t-[4px] border-[#f48d79] rounded-tl-lg" />
                  <div className="absolute right-4 top-4 h-12 w-12 border-r-[4px] border-t-[4px] border-[#f48d79] rounded-tr-lg" />
                  <div className="absolute bottom-4 left-4 h-12 w-12 border-b-[4px] border-l-[4px] border-[#f48d79] rounded-bl-lg" />
                  <div className="absolute bottom-4 right-4 h-12 w-12 border-b-[4px] border-r-[4px] border-[#f48d79] rounded-br-lg" />
                </div>
              </div>

              {/* Camera Error Message */}
              {cameraError && (
                <div
                  className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-center"
                  role="alert"
                  aria-live="assertive"
                >
                  <p className="font-body text-sm text-red-300">
                    {cameraError}
                  </p>
                </div>
              )}

              {/* Instruction */}
              <p className="mt-5 text-center font-body text-sm font-semibold text-white">
                Align Beneficiary QR Card inside the frame
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── PIN Validation Modal (FE2-3.7) ── */}
      {modalState === "pin" && (
        <PINModal
          guardianName={beneficiaryData?.guardianName || "Beneficiary"}
          error={pinError}
          submitError={submitError}
          busy={submitting}
          onBack={() => {
            // Bug 3 fix: activate cooldown before reopening the scanner so
            // the card still in frame isn't instantly re-scanned.
            setScanCooldown(true);
            setModalState("qr-scan");
            setPinError(false);
            setSubmitError(null);
            // Lift the cooldown after 2 seconds — enough time to remove the card.
            setTimeout(() => setScanCooldown(false), 2000);
          }}
          onComplete={handlePinComplete}
          onEscapeToNone={() => {
            handleCloseQRScanner();
            setPinError(false);
            setSubmitError(null);
          }}
        />
      )}
    </div>
  );
}

// PIN Validation Modal Component

function PINModal({
  guardianName,
  error,
  submitError,
  busy,
  onBack,
  onComplete,
  onEscapeToNone,
}: {
  guardianName: string;
  error: boolean;
  submitError?: string | null;
  busy?: boolean;
  onBack: () => void;
  onComplete: (pin: string) => void;
  onEscapeToNone: () => void;
}) {
  const [pin, setPin] = useState("");
  const maxDigits = 6;
  const firstDigitRef = useRef<HTMLButtonElement>(null);

  // Focus first digit button on mount
  useEffect(() => {
    firstDigitRef.current?.focus();
  }, []);

  // Clear entered digits when the server reports an incorrect PIN so the
  // guardian can retry cleanly.
  useEffect(() => {
    if (error) setPin("");
  }, [error]);

  const handleDigit = (digit: string) => {
    if (busy) return;
    if (pin.length < maxDigits) {
      const newPin = pin + digit;
      setPin(newPin);

      // Auto-submit on 6th digit
      if (newPin.length === maxDigits) {
        setTimeout(() => onComplete(newPin), 300);
      }
    }
  };

  const handleClear = () => {
    setPin("");
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        handleBackspace();
      } else if (e.key === "Escape") {
        onEscapeToNone();
      } else if (e.key === "Delete") {
        handleClear();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pin, onEscapeToNone]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-[#034C52]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-modal-title"
    >
      {/* Header */}
      <header className="flex items-center px-4 pt-5 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-11 w-11 items-center justify-center"
          aria-label="Back to QR scanner"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex-1 text-center">
          <span className="inline-block rounded-full bg-[#f48d79] px-6 py-2 font-title text-sm font-black text-[#034C52]">
            Pin Validation
          </span>
        </div>
        <button
          type="button"
          onClick={onEscapeToNone}
          className="flex h-11 w-11 items-center justify-center"
          aria-label="Close PIN validation and return to checkout"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      {/* Content */}
      <div className="flex flex-1 flex-col items-center px-6 pt-6">
        {/* Lock Icon */}
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#f48d79]/30">
          <img
            src="/merchantLogos/lock2.png"
            alt="Security lock icon"
            className="h-8 w-8"
          />
        </div>

        {/* Title */}
        <h2
          id="pin-modal-title"
          className="text-center font-body text-lg font-bold text-white"
        >
          Enter Beneficiary Guardian Security PIN
        </h2>
        <p className="mt-2 text-center font-body text-sm text-white/70">
          Authorizing voucher transaction for
        </p>
        <p className="mt-1 text-center font-body text-sm font-bold text-[#f48d79]">
          {maskName(guardianName)}
        </p>

        {/* PIN Progress Circles */}
        <div
          className="mt-6 flex items-center gap-3"
          role="status"
          aria-label={`${pin.length} of ${maxDigits} digits entered`}
        >
          {Array.from({ length: maxDigits }).map((_, i) => (
            <div
              key={i}
              className={`h-4 w-4 rounded-full border-2 transition-all ${i < pin.length
                  ? "border-white bg-white"
                  : "border-white/40 bg-transparent"
                }`}
              aria-hidden="true"
            />
          ))}
        </div>

        {/* Busy / Error Messages */}
        {busy && (
          <p
            className="mt-4 inline-flex items-center gap-2 font-body text-sm font-semibold text-white/80"
            role="status"
            aria-live="polite"
          >
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Processing checkout payment…
          </p>
        )}
        {!busy && error && (
          <p
            className="mt-4 font-body text-sm font-semibold text-red-400"
            role="alert"
            aria-live="assertive"
          >
            Incorrect PIN. Please try again.
          </p>
        )}
        {!busy && !error && submitError && (
          <p
            className="mt-4 max-w-xs text-center font-body text-sm font-semibold text-red-400"
            role="alert"
            aria-live="assertive"
          >
            {submitError}
          </p>
        )}

        {/* Numeric Keypad */}
        <div
          className="mt-8 grid w-full max-w-xs grid-cols-3 gap-3"
          role="group"
          aria-label="PIN keypad"
        >
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit, idx) => (
            <button
              key={digit}
              ref={idx === 0 ? firstDigitRef : undefined}
              type="button"
              onClick={() => handleDigit(digit)}
              aria-label={`Enter digit ${digit}`}
              className="flex h-14 min-h-[56px] min-w-[56px] items-center justify-center rounded-xl bg-[#017075] font-body text-xl font-bold text-white transition-colors hover:bg-[#015f63] active:brightness-90 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#034C52]"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear all digits"
            className="flex h-14 min-h-[56px] min-w-[56px] items-center justify-center rounded-xl font-body text-sm font-bold text-[#f48d79] transition-colors hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-[#f48d79] focus:ring-offset-2 focus:ring-offset-[#034C52]"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => handleDigit("0")}
            aria-label="Enter digit 0"
            className="flex h-14 min-h-[56px] min-w-[56px] items-center justify-center rounded-xl bg-[#017075] font-body text-xl font-bold text-white transition-colors hover:bg-[#015f63] active:brightness-90 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#034C52]"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            aria-label="Delete last digit"
            className="flex h-14 min-h-[56px] min-w-[56px] items-center justify-center rounded-xl font-body text-sm font-bold text-white transition-colors hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#034C52]"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
