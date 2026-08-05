"use client";

import { Suspense, useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCartStore } from "@/stores/cart-store";
import { ProgressIndicator } from "@/components/merchant/progress-indicator";
import { QuantitySelector } from "@/components/merchant/quantity-selector";
import { EligibilityToggle } from "@/components/merchant/eligibility-toggle";
import { CartSummary } from "@/components/merchant/cart-summary";
import { ItemCard } from "@/components/merchant/item-card";
import { useCameraPreview } from "@/hooks/use-camera-preview";
import { authFetch, clearMerchantToken } from "@/lib/api";

type Stage = 1 | 2 | 3;

const UNITS = [
  "per piece",
  "per 100g",
  "per kilo",
  "per bundle/pack",
  "per liter",
  "per dozen",
];

export default function NonBrandedPage() {
  return (
    <Suspense>
      <NonBrandedContent />
    </Suspense>
  );
}

function NonBrandedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const addItem = useCartStore((s) => s.addItem);
  const setInputSource = useCartStore((s) => s.setInputSource);

  // ── Form State ──
  const [stage, setStage] = useState<Stage>(
    searchParams.get("resume") === "result" ? 3 : 1
  );
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState(UNITS[0]);

  // ── Validation State ──
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<{
    isJustified: boolean;
    isChildFriendly: boolean;
    reasoning: string;
    flaggedIngredients: string[];
    researchedPriceMin: number;
    researchedPriceMax: number;
    suggestedCategory: string;
    mismatchReason?: string;
  } | null>(null);

  // ── Camera State ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const {
    status: cameraStatus,
    errorMsg: cameraErrorMsg,
    retryCount,
    startCamera,
    stopCamera,
    retry: handleRetryCamera,
  } = useCameraPreview(videoRef);

  useEffect(() => {
    if (stage === 1 && !capturedImage) {
      startCamera("environment");
    } else {
      stopCamera();
    }
  }, [stage, capturedImage, startCamera, stopCamera]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    setCapturedImage(canvas.toDataURL("image/jpeg", 0.85));
    stopCamera();
    setStage(2);
  }, [stopCamera]);

  const handleValidate = async () => {
    if (!productName || !price || isNaN(parseFloat(price))) return;
    setIsValidating(true);
    setError(null);
    setValidationResult(null);

    try {
      const res = await authFetch("/api/vision/validate-non-branded", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: capturedImage,
          productName: productName.trim(),
          price: parseFloat(price),
          unit,
        }),
      });

      if (!res.ok) {
        let serverError = "";
        try {
          const errBody = await res.json();
          serverError = errBody?.message || "";
        } catch { /* ignore */ }

        if (res.status === 401 || res.status === 403) {
          clearMerchantToken();
          router.replace("/merchant-login");
          return;
        } else if (res.status === 429 || serverError.includes("rate_limit")) {
          setError("AI service is busy — please wait a moment and try again.");
        } else {
          setError(serverError || "Validation failed. Please try again.");
        }
        return;
      }

      const result = await res.json();
      setValidationResult(result);
    } catch {
      setError("Something went wrong during validation. Please try again.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleAddToCart = () => {
    if (!validationResult || !validationResult.isJustified || !validationResult.isChildFriendly) return;

    addItem({
      name: productName.trim(),
      price: parseFloat(price),
      quantity,
      unit,
      eligibility: "eligible",
      imageDataUrl: capturedImage || undefined,
      category: validationResult.suggestedCategory,
    });
    setInputSource("non-branded");
    setStage(3);
  };

  const handleAddAnother = () => {
    setStage(1);
    setCapturedImage(null);
    setProductName("");
    setPrice("");
    setQuantity(1);
    setUnit(UNITS[0]);
    setValidationResult(null);
    setError(null);
  };

  // ── Stage 1: Capture ──
  if (stage === 1) {
    return (
      <div className="min-h-dvh bg-[#fdf2ed]">
        <header className="flex items-center px-4 pt-5 pb-3">
          <Link
            href="/cart"
            className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-black/5"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#034C52" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <h1 className="flex-1 text-center font-title text-[1.35rem] font-black text-[#034C52]">
            Non-Branded Input
          </h1>
          <div className="w-9" />
        </header>

        <div className="h-px bg-gray-400" />
        <ProgressIndicator currentStep={1} />

        <div className="px-5 pb-8">
          <div className="relative overflow-hidden rounded-2xl border-[3px] border-[#b2dfdb] bg-gray-100">
            {cameraStatus === "ready" || cameraStatus === "loading" ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="aspect-[4/3] w-full object-cover"
                />
                {cameraStatus === "loading" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center bg-[#E3F0F2]">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#034C52] border-t-transparent" />
                    <p className="text-xs font-semibold text-[#034C52]/60">Camera starting...</p>
                  </div>
                )}
                {cameraStatus === "ready" && (
                  <>
                    <div className="pointer-events-none absolute inset-0">
                      <div className="absolute left-3 top-3 h-10 w-10 border-l-[3px] border-t-[3px] border-[#80cbc4]" />
                      <div className="absolute right-3 top-3 h-10 w-10 border-r-[3px] border-t-[3px] border-[#80cbc4]" />
                      <div className="absolute bottom-3 left-3 h-10 w-10 border-b-[3px] border-l-[3px] border-[#80cbc4]" />
                      <div className="absolute bottom-3 right-3 h-10 w-10 border-b-[3px] border-r-[3px] border-[#80cbc4]" />
                    </div>
                    <button
                      type="button"
                      onClick={capturePhoto}
                      className="absolute bottom-3 right-3 z-10 flex h-11 w-11 items-center justify-center"
                      aria-label="Capture photo"
                    >
                      <img src="/merchantLogos/cam-logo.png" alt="" className="h-10 w-10" />
                    </button>
                  </>
                )}
              </>
            ) : (
              <div className="flex flex-col aspect-[4/3] w-full items-center justify-center gap-3 p-4 text-center bg-[#E3F0F2]">
                <p className="text-xs font-semibold text-[#034C52]/60">
                  {cameraStatus === "timeout" ? "Camera activation timed out." : (cameraErrorMsg || "Camera unavailable")}
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleRetryCamera}
                    disabled={retryCount >= 3}
                    className="rounded-full bg-[#034C52] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#034C52]/90 disabled:opacity-50"
                  >
                    Retry ({retryCount}/3)
                  </button>
                </div>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <p className="mt-3 text-center font-body text-xs italic text-gray-400">
            Take a picture of the product to begin.
          </p>
        </div>
      </div>
    );
  }

  // ── Stage 2: Details & Validation ──
  if (stage === 2) {
    const isFormComplete = productName.trim().length > 0 && parseFloat(price) > 0;

    return (
      <div className="min-h-dvh bg-[#fdf2ed]">
        <header className="flex items-center px-4 pt-5 pb-3">
          <Link
            href="/cart"
            className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-black/5"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#034C52" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <h1 className="flex-1 text-center font-title text-[1.35rem] font-black text-[#034C52]">
            Non-Branded Input
          </h1>
          <div className="w-9" />
        </header>

        <div className="h-px bg-gray-400" />
        <ProgressIndicator currentStep={2} />

        <div className="px-5 pb-8">
          <div className="mt-2 text-center">
            <h2 className="font-body text-lg font-bold text-gray-900">Enter Details</h2>
            <p className="mt-1 font-body text-sm text-gray-500">Provide info for AI validation</p>
          </div>

          {capturedImage && (
            <div className="mt-5 flex justify-center">
              <div className="relative h-28 w-28 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <img src={capturedImage} alt="Captured" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => {
                    setCapturedImage(null);
                    setStage(1);
                  }}
                  className="absolute bottom-1 right-1 rounded-full bg-black/60 px-2 py-1 font-body text-[10px] font-bold text-white transition-colors hover:bg-black/80"
                >
                  Retake
                </button>
              </div>
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-gray-200 bg-white px-5 py-5">
            <div className="mb-4">
              <label htmlFor="product-name" className="mb-1.5 block font-body text-sm font-bold text-gray-800">
                Product Name
              </label>
              <input
                id="product-name"
                type="text"
                value={productName}
                onChange={(e) => {
                  setProductName(e.target.value);
                  setValidationResult(null);
                }}
                placeholder="e.g., Kangkong, Tilapia, Rice"
                className="w-full font-body text-lg font-bold text-gray-900 outline-none placeholder:text-gray-300 transition-colors focus:border-[#017075] border-b border-gray-200 pb-2"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="price" className="mb-1.5 block font-body text-xs font-medium text-gray-600">
                  Price (PHP)
                </label>
                <div className="flex w-full items-center gap-2 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 transition-colors focus-within:border-[#017075] focus-within:ring-1 focus-within:ring-[#017075]">
                  <span className="flex-shrink-0 font-body text-sm text-gray-500">₱</span>
                  <input
                    id="price"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={price}
                    onChange={(e) => {
                      setPrice(e.target.value);
                      setValidationResult(null);
                    }}
                    placeholder="0.00"
                    className="w-full bg-transparent font-body text-sm text-gray-800 outline-none"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="unit" className="mb-1.5 block font-body text-xs font-medium text-gray-600">
                  Unit
                </label>
                <select
                  id="unit"
                  value={unit}
                  onChange={(e) => {
                    setUnit(e.target.value);
                    setValidationResult(null);
                  }}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 font-body text-sm text-gray-800 outline-none transition-colors focus:border-[#017075] focus:ring-1 focus:ring-[#017075]"
                >
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-4">
              <QuantitySelector value={quantity} onChange={setQuantity} min={1} />
            </div>

            <div className="mt-5">
              <EligibilityToggle
                value={validationResult ? (validationResult.isChildFriendly ? "eligible" : "ineligible") : null}
                onChange={() => { }}
                disabled={true}
              />
            </div>
          </div>

          {!validationResult && (
            <button
              type="button"
              onClick={handleValidate}
              disabled={!isFormComplete || isValidating}
              className="mt-5 w-full rounded-2xl bg-[#034C52] py-4 font-body text-base font-bold text-white transition-colors hover:bg-[#017075] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isValidating ? "AI Validating..." : "Validate"}
            </button>
          )}

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-center">
              <p className="font-body text-xs font-semibold text-red-600">{error}</p>
            </div>
          )}

          {validationResult && (
            <div className="mt-5 overflow-hidden rounded-2xl border border-[#b2dfdb] bg-white shadow-sm">
              <div className={`px-4 py-3 flex items-center justify-between border-b ${validationResult.isJustified && validationResult.isChildFriendly ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
                <span className="font-body text-xs font-bold uppercase tracking-wider text-[#034C52]">
                  AI Validation Result
                </span>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-body text-xs font-semibold ${validationResult.isJustified ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                  {validationResult.isJustified ? "✓ Justified" : "⚠ Not Justified"}
                </span>
              </div>
              <div className="px-4 py-4 space-y-3">
                {!validationResult.isJustified && (
                  <div className="rounded-xl bg-red-50 p-3 border border-red-100">
                    <p className="font-body text-xs text-red-700 font-semibold leading-relaxed">
                      {validationResult.mismatchReason || "The provided details don't match the image or the price is unreasonable."}
                    </p>
                  </div>
                )}
                <div>
                  <h4 className="font-body text-[10px] font-semibold text-gray-400 uppercase tracking-wider">AI Reasoning</h4>
                  <p className="mt-1 font-body text-sm text-gray-700 leading-relaxed">{validationResult.reasoning}</p>
                </div>
                <div>
                  <h4 className="font-body text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Market Price Estimate</h4>
                  <p className="mt-1 font-body text-sm font-semibold text-[#034C52]">
                    ₱{validationResult.researchedPriceMin} - ₱{validationResult.researchedPriceMax} / {unit}
                  </p>
                </div>
                {validationResult.flaggedIngredients.length > 0 && (
                  <div>
                    <h4 className="font-body text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Flagged Ingredients</h4>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {validationResult.flaggedIngredients.map((ing, idx) => (
                        <span key={idx} className="inline-flex items-center rounded-lg bg-amber-50 border border-amber-200 px-2 py-1 font-body text-xs font-medium text-amber-800">
                          {ing}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {validationResult && !validationResult.isChildFriendly && (
            <div className="mt-4 rounded-xl bg-red-50 p-4 border border-red-100">
              <p className="font-body text-xs text-red-700 font-semibold leading-relaxed">
                ⚠ Purchase Blocked: This product is flagged as "Not Good for Children". In compliance with local nutritional health policies, it cannot be sold to beneficiaries.
              </p>
            </div>
          )}

          {validationResult && (
            <div className="mt-5 space-y-3">
              {(!validationResult.isJustified || !validationResult.isChildFriendly) ? (
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={isValidating}
                  className="w-full rounded-2xl bg-gray-200 py-4 font-body text-base font-bold text-gray-600 transition-colors hover:bg-gray-300 active:brightness-95"
                >
                  {isValidating ? "AI Validating..." : "Re-Validate Changes"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleAddToCart}
                  className="w-full rounded-2xl bg-[#f48d79] py-4 font-body text-base font-bold text-[#034C52] transition-colors hover:bg-[#f9a899] active:brightness-95"
                >
                  Add to Cart
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Stage 3: Result ──
  const lastItem = useCartStore.getState().items.slice(-1)[0];

  return (
    <div className="min-h-dvh bg-[#fdf2ed]">
      <header className="flex items-center px-4 pt-5 pb-3">
        <Link
          href="/cart"
          className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-black/5"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#034C52" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <h1 className="flex-1 text-center font-title text-[1.35rem] font-black text-[#034C52]">
          Non-Branded Input
        </h1>
        <div className="w-9" />
      </header>

      <div className="h-px bg-gray-400" />
      <ProgressIndicator currentStep={3} />

      <div className="px-5 pb-8">
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#10b981] bg-[#ecfdf5] px-4 py-3">
          <img src="/merchantLogos/green_correct.png" alt="Success" className="h-5 w-5 flex-shrink-0" />
          <span className="font-body text-sm font-semibold text-[#065f46]">
            Item added to cart successfully!
          </span>
        </div>

        {lastItem && (
          <div className="mt-5">
            <ItemCard
              name={lastItem.name}
              price={lastItem.price}
              quantity={lastItem.quantity}
              eligibility={lastItem.eligibility}
              imageDataUrl={lastItem.imageDataUrl}
            />
          </div>
        )}

        <div className="mt-5">
          <CartSummary />
        </div>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={handleAddAnother}
            className="w-full rounded-2xl bg-[#f48d79] py-4 font-body text-base font-bold text-[#034C52] transition-colors hover:bg-[#f9a899] active:brightness-95"
          >
            + Add Another Item
          </button>
          <Link
            href="/checkout"
            className="block w-full rounded-2xl bg-[#034C52] py-4 text-center font-body text-base font-bold text-white transition-colors hover:bg-[#017075] active:brightness-95"
          >
            Proceed to Checkout
          </Link>
        </div>
      </div>
    </div>
  );
}
