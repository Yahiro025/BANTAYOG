"use client";

import { Suspense } from "react";
import { useState, useRef, useCallback, useEffect } from "react";
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

// ---------------------------------------------------------------------------
// AI Image Scan Flow — 3 stages in one page (ref: 16-21.png)
// ---------------------------------------------------------------------------

type Stage = 1 | 2 | 3;

const MOCK_FOOD_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAADklEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export default function AIScanPage() {
  return (
    <Suspense>
      <AIScanContent />
    </Suspense>
  );
}

function AIScanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const addItem = useCartStore((s) => s.addItem);
  const setInputSource = useCartStore((s) => s.setInputSource);

  // ── Stage & form state ──
  const [stage, setStage] = useState<Stage>(
    searchParams.get("resume") === "result" ? 3 : 1,
  );
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [productName, setProductName] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [eligibility, setEligibility] = useState<
    "eligible" | "ineligible" | null
  >(null);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const [priceRangeMin, setPriceRangeMin] = useState<number | null>(null);
  const [priceRangeMax, setPriceRangeMax] = useState<number | null>(null);
  const [isUnrecognizedBrand, setIsUnrecognizedBrand] = useState(false);

  interface ChildSafetyAnalysis {
    product_name: string;
    is_child_friendly: boolean;
    flagged_ingredients: string[];
    reasoning: string;
  }
  const [analysisResult, setAnalysisResult] = useState<ChildSafetyAnalysis | null>(null);

  // ── Camera state ──
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

  // ── Start/stop camera based on stage & capturedImage ──
  useEffect(() => {
    if (stage === 1 && !capturedImage) {
      startCamera("environment");
    } else {
      stopCamera();
    }
  }, [stage, capturedImage, startCamera, stopCamera]);

  // ── Run AI Scan ──
  const runAIScan = async (image: string) => {
    setIsProcessing(true);
    setError(null);
    try {
      const res = await authFetch("/api/vision/analyze-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: image }),
      });

      if (!res.ok) {
        // Try to parse the actual error from server
        let serverError = "";
        try {
          const errBody = await res.json();
          serverError = errBody?.message || "";
        } catch { /* ignore */ }

        if (res.status === 401 || res.status === 403) {
          // Token expired or invalid — clear it and redirect to login
          clearMerchantToken();
          router.replace("/merchant-login");
          return;
        } else if (res.status === 429 || serverError.includes("rate_limit")) {
          setError("AI service is busy — please wait a moment and try again.");
        } else if (serverError.includes("image_error")) {
          setError("Could not read the image. Try capturing again in better lighting.");
        } else {
          setError(serverError || "Scan failed. Please try again.");
        }
        setCapturedImage(null);
        return;
      }

      const result = await res.json();

      if (result.status === "blurry") {
        setError("Photo is too blurry to analyze — please retake the picture");
        setCapturedImage(null); // Reset captured image to show camera viewfinder again
        return; // stay in Step 1
      }

      if (result.status === "unrecognized") {
        const detectedName = result.productName || "Unrecognized Brand";
        setProductName(detectedName);
        setEligibility(result.isChildFriendly ? "eligible" : "ineligible");
        setCategory(undefined);
        setAnalysisResult({
          product_name: detectedName,
          is_child_friendly: result.isChildFriendly,
          flagged_ingredients: result.flaggedIngredients || [],
          reasoning: result.reasoning || "Brand unrecognized. Please verify product details."
        });
        setPriceRangeMin(null);
        setPriceRangeMax(null);
        setIsUnrecognizedBrand(true);
        setStage(2); // Go to Step 2
        return;
      }

      if (result.status === "identified") {
        setProductName(result.productName);
        setEligibility(result.eligibilityStatus);
        setCategory(result.category);
        setImageUrl(result.imageUrl || null);
        setAnalysisResult({
          product_name: result.productName,
          is_child_friendly: result.isChildFriendly,
          flagged_ingredients: result.flaggedIngredients || [],
          reasoning: result.reasoning
        });
        setPriceRangeMin(result.priceRangeMin);
        setPriceRangeMax(result.priceRangeMax);
        setIsUnrecognizedBrand(false);
        setStage(2); // Go to Step 2
        return;
      }
    } catch (err: any) {
      // Try to get the real error from the server response body
      let userMessage = "Something went wrong. Please try again.";
      try {
        const serverMsg: string = err?.message || "";
        if (serverMsg.includes("rate_limit")) {
          userMessage = "AI service is busy — please wait a moment and try again.";
        } else if (serverMsg.includes("image_error")) {
          userMessage = "Could not read the image. Try capturing again with better lighting.";
        } else if (serverMsg.includes("scan_error")) {
          userMessage = "Scan failed. Please try again.";
        }
      } catch { /* ignore */ }
      setError(userMessage);
      setCapturedImage(null);
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Capture photo ──
  const capturePhoto = useCallback(() => {
    setError(null);
    if (!videoRef.current || !canvasRef.current) {
      setCapturedImage(MOCK_FOOD_IMAGE);
      stopCamera();
      runAIScan(MOCK_FOOD_IMAGE);
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCapturedImage(MOCK_FOOD_IMAGE);
      stopCamera();
      runAIScan(MOCK_FOOD_IMAGE);
      return;
    }

    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setCapturedImage(dataUrl);
    stopCamera();
    runAIScan(dataUrl);
  }, [stopCamera]);

  // ── Validate price ──
  const priceValue = parseFloat(price);
  const isPriceRangeValid = priceRangeMin !== null && priceRangeMax !== null
    ? (priceValue >= priceRangeMin && priceValue <= priceRangeMax)
    : true;
  const isPriceValid = !isNaN(priceValue) && priceValue > 0 && isPriceRangeValid;
  const isQuantityValid = quantity >= 1;
  const isFormValid = isPriceValid && isQuantityValid && productName.trim().length > 0;

  // ── Add to cart (Stage 2 → Stage 3) ──
  const handleAddToCart = async () => {
    if (!productName || !eligibility) return;

    if (isUnrecognizedBrand && (priceRangeMin === null || priceRangeMax === null)) {
      setIsProcessing(true);
      try {
        const res = await authFetch("/api/products/validate-or-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: productName,
            imageUrl: capturedImage || undefined,
            category: category || undefined
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.matched) {
            const p = data.product;
            setPriceRangeMin(p.price_range_min);
            setPriceRangeMax(p.price_range_max);
            setEligibility(p.eligibility_status);
            setCategory(p.category);
            setImageUrl(p.image_url || null);
            const val = parseFloat(price);
            if (val < p.price_range_min || val > p.price_range_max) {
              setError(`Price must be between ₱${p.price_range_min} and ₱${p.price_range_max}`);
              setIsProcessing(false);
              return;
            }
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsProcessing(false);
      }
    }

    const val = parseFloat(price);
    if (isNaN(val) || val <= 0) return;
    if (priceRangeMin !== null && priceRangeMax !== null) {
      if (val < priceRangeMin || val > priceRangeMax) {
        setError(`Price must be between ₱${priceRangeMin} and ₱${priceRangeMax}`);
        return;
      }
    }

    addItem({
      name: productName,
      price: val,
      quantity,
      eligibility,
      imageDataUrl: imageUrl || capturedImage || undefined,
      category,
    });
    setInputSource("branded");
    setStage(3);
  };

  // ── Reset for next item ──
  const handleAddAnother = () => {
    setStage(1);
    setCapturedImage(null);
    setImageUrl(null);
    setProductName("");
    setPrice("");
    setQuantity(1);
    setEligibility(null);
    setCategory(undefined);
    setError(null);
    setAnalysisResult(null);
    setPriceRangeMin(null);
    setPriceRangeMax(null);
    setIsUnrecognizedBrand(false);
  };

  // ── Stage 1 — Capture ──
  if (stage === 1) {
    return (
      <div className="min-h-dvh bg-[#fdf2ed]">
        {/* Header */}
        <header className="flex items-center px-4 pt-5 pb-3">
          <Link
            href="/cart"
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
            Branded Scan
          </h1>
          <div className="w-9" />
        </header>

        <div className="h-px bg-gray-400" />

        {/* Progress */}
        <ProgressIndicator currentStep={1} />

        <div className="px-5 pb-8">
          {/* Camera Viewfinder */}
          <div className="relative overflow-hidden rounded-2xl border-[3px] border-[#b2dfdb] bg-gray-100">
            {capturedImage ? (
              <div className="relative aspect-[4/3] w-full overflow-hidden">
                <img
                  src={capturedImage}
                  alt="Captured product"
                  className="h-full w-full object-cover"
                />
                {isProcessing && (
                  <>
                    <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-white border-t-[#80cbc4]" />
                      <span className="font-body text-xs font-bold text-white tracking-wider uppercase">AI Analyzing...</span>
                    </div>
                  </>
                )}
              </div>
            ) : (cameraStatus === "ready" || cameraStatus === "loading") ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="aspect-[4/3] w-full object-cover"
                  aria-label="Camera viewfinder for capturing product image"
                />
                {cameraStatus === "loading" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center bg-[#E3F0F2]" aria-live="polite">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#034C52] border-t-transparent" />
                    <p className="text-xs font-semibold text-[#034C52]/60">
                      Camera starting...
                    </p>
                  </div>
                )}
                {cameraStatus === "ready" && (
                  <>
                    {/* Corner brackets */}
                    <div className="pointer-events-none absolute inset-0">
                      <div className="absolute left-3 top-3 h-10 w-10 border-l-[3px] border-t-[3px] border-[#80cbc4]" />
                      <div className="absolute right-3 top-3 h-10 w-10 border-r-[3px] border-t-[3px] border-[#80cbc4]" />
                      <div className="absolute bottom-3 left-3 h-10 w-10 border-b-[3px] border-l-[3px] border-[#80cbc4]" />
                      <div className="absolute bottom-3 right-3 h-10 w-10 border-b-[3px] border-r-[3px] border-[#80cbc4]" />
                    </div>
                    {/* Camera capture button */}
                    <button
                      type="button"
                      onClick={capturePhoto}
                      className="absolute bottom-3 right-3 z-10 flex h-11 w-11 items-center justify-center"
                      aria-label="Capture photo"
                    >
                      <img
                        src="/merchantLogos/cam-logo.png"
                        alt=""
                        className="h-10 w-10"
                      />
                    </button>
                  </>
                )}
              </>
            ) : (
              <div className="flex flex-col aspect-[4/3] w-full items-center justify-center gap-3 p-4 text-center bg-[#E3F0F2]" aria-live="polite">
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

          {/* Instruction */}
          <p className="mt-3 text-center font-body text-xs italic text-gray-400">
            Take a picture of a single item in good lighting.
          </p>

          {/* Error */}
          {error && (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-center" role="alert">
              <p className="font-body text-xs font-semibold text-red-600">{error}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Stage 2 — Review ──
  if (stage === 2) {
    const isChildFriendly = eligibility === "eligible";

    return (
      <div className="min-h-dvh bg-[#fdf2ed]">
        {/* Header */}
        <header className="flex items-center px-4 pt-5 pb-3">
          <Link
            href="/cart"
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
            Branded Scan
          </h1>
          <div className="w-9" />
        </header>

        <div className="h-px bg-gray-400" />

        {/* Progress */}
        <ProgressIndicator currentStep={2} />

        <div className="px-5 pb-8">
          {/* Title */}
          <div className="mt-2 text-center">
            <h2 className="font-body text-lg font-bold text-gray-900">
              Review Detected Item
            </h2>
            <p className="mt-1 font-body text-sm text-gray-500">
              Please review the details and make any necessary edits
            </p>
          </div>

          {/* Product Image */}
          {capturedImage && (
            <div className="mt-5 flex justify-center">
              <div className="h-28 w-28 overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <img
                  src={capturedImage}
                  alt={productName || "Product"}
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          )}

          {/* Unrecognized Brand Hint */}
          {isUnrecognizedBrand && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3" role="alert">
              <span className="block font-body text-sm font-bold text-amber-800">
                ⚠ Unconfirmed – detected from package text only.
              </span>
              <span className="mt-1 block font-body text-xs text-amber-700">
                Please verify or edit before adding the item.
              </span>
            </div>
          )}

          {/* Child Safety Analysis Card */}
          {analysisResult && (
            <div className="mt-5 overflow-hidden rounded-2xl border border-[#b2dfdb] bg-white shadow-sm">
              <div className={`px-4 py-3 flex items-center justify-between border-b ${isChildFriendly ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
                <span className="font-body text-xs font-bold uppercase tracking-wider text-[#034C52]">
                  Nutritional Safety Scan
                </span>
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-body text-xs font-semibold ${isChildFriendly ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
                  {isChildFriendly ? "✓ Child Friendly" : "⚠ Not Good for Children"}
                </span>
              </div>
              <div className="px-4 py-4 space-y-3">
                <div>
                  <h4 className="font-body text-xs font-semibold text-gray-400 uppercase tracking-wider">AI Reasoning</h4>
                  <p className="mt-1 font-body text-sm text-gray-700 leading-relaxed">{analysisResult.reasoning}</p>
                </div>
                {analysisResult.flagged_ingredients.length > 0 && (
                  <div>
                    <h4 className="font-body text-xs font-semibold text-gray-400 uppercase tracking-wider">Flagged Ingredients</h4>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {analysisResult.flagged_ingredients.map((ing, idx) => (
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

          {/* Edit Form */}
          <div className="mt-5 rounded-2xl border border-gray-200 bg-white px-5 py-5">
            {/* Product Name */}
            <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-4">
              <label htmlFor="product-name" className="sr-only">Product Name</label>
              <input
                id="product-name"
                type="text"
                value={productName}
                readOnly
                disabled
                className="min-w-0 flex-1 font-body text-xl font-bold text-gray-500 outline-none placeholder:text-gray-300 cursor-not-allowed bg-transparent"
                placeholder="Product Name..."
              />
            </div>

            {/* Price & Quantity - ONLY if child friendly */}
            {isChildFriendly ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="price-ai" className="mb-1.5 block font-body text-xs font-medium text-gray-600">
                    Price (PHP)
                  </label>
                  <div className="flex w-full items-center gap-2 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 transition-colors focus-within:border-[#017075] focus-within:ring-1 focus-within:ring-[#017075]">
                    <span className="flex-shrink-0 font-body text-sm text-gray-500">
                      ₱
                    </span>
                    <div className="min-w-0 flex-1">
                      <input
                        id="price-ai"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="0.00"
                        className="w-full rounded-lg border border-[#017075] bg-white px-3 py-2 font-body text-sm text-gray-800 outline-none transition-colors focus:border-[#017075] focus:ring-1 focus:ring-[#017075]"
                      />
                    </div>
                  </div>
                  {/* Price limits helper */}
                  {priceRangeMin !== null && priceRangeMax !== null && (
                    <span className="mt-1 block font-body text-[10px] text-gray-400">
                      Allowed range: ₱{priceRangeMin} - ₱{priceRangeMax}
                    </span>
                  )}
                </div>
                <QuantitySelector
                  value={quantity}
                  onChange={setQuantity}
                  min={1}
                />
              </div>
            ) : (
              <div className="rounded-xl bg-red-50 p-4 border border-red-100">
                <p className="font-body text-xs text-red-700 font-semibold leading-relaxed">
                  ⚠ Purchase Blocked: This product is flagged as "Not Good for Children". In compliance with local nutritional health policies, it cannot be sold to beneficiaries.
                </p>
              </div>
            )}

            {/* Eligibility Toggle (visual representation only) */}
            <div className="mt-5">
              <EligibilityToggle value={eligibility} onChange={() => {}} disabled={true} />
            </div>
          </div>

          {/* Validation Error Banner */}
          {error && (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-center" role="alert">
              <p className="font-body text-xs font-semibold text-red-600">{error}</p>
            </div>
          )}

          {/* Add to Cart Button - HIDDEN entirely if ineligible */}
          {isChildFriendly && (
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={!isFormValid || isProcessing}
              aria-disabled={!isFormValid || isProcessing}
              aria-describedby="add-to-cart-hint"
              className="mt-5 w-full rounded-2xl bg-[#f48d79] py-4 font-body text-base font-bold text-[#034C52] transition-colors hover:bg-[#f9a899] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isProcessing ? "Validating price..." : "Add to Cart"}
            </button>
          )}
          <span id="add-to-cart-hint" className="sr-only">
            {!productName ? "Enter a product name" : !isPriceValid ? "Enter a valid price within catalog range" : "Select an eligibility classification"}
          </span>
        </div>
      </div>
    );
  }

  // ── Stage 3 — Result ──
  const lastItem = useCartStore.getState().items.slice(-1)[0];
  const isLastItemEligible = lastItem?.eligibility === "eligible";

  return (
    <div className="min-h-dvh bg-[#fdf2ed]">
      {/* Header */}
      <header className="flex items-center px-4 pt-5 pb-3">
        <Link
          href="/cart"
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
          Branded Scan
        </h1>
        <div className="w-9" />
      </header>

      <div className="h-px bg-gray-400" />

      {/* Progress */}
      <ProgressIndicator currentStep={3} />

      <div className="px-5 pb-8">
        {/* Success/Error Banner */}
        {isLastItemEligible ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#10b981] bg-[#ecfdf5] px-4 py-3" role="status">
            <img
              src="/merchantLogos/green_correct.png"
              alt="Success"
              className="h-5 w-5 flex-shrink-0"
            />
            <span className="font-body text-sm font-semibold text-[#065f46]">
              Item added to cart successfully!
            </span>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#ef4444] bg-[#fef2f2] px-4 py-3" role="status">
            <img
              src="/merchantLogos/red_wrong.png"
              alt="Not added"
              className="h-5 w-5 flex-shrink-0"
            />
            <span className="font-body text-sm font-semibold text-[#991b1b]">
              Item NOT added to cart.
            </span>
          </div>
        )}

        {/* Item Card */}
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

        {/* Cart Summary */}
        <div className="mt-5">
          <CartSummary />
        </div>

        {/* Action Buttons */}
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
