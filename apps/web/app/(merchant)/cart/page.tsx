import Link from "next/link";

// Scan Cart Items — Method Choice (ref: 15.png)

export default function ScanCartItemsPage() {
  return (
    <div className="min-h-dvh bg-[#fdf2ed]">
      {/* ── Header ── */}
      <header className="flex items-center px-4 pt-5 pb-3">
        <Link
          href="/dashboard"
          className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-black/5"
          aria-label="Back to dashboard"
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
          Scan Cart Items
        </h1>
        <div className="w-9" />
      </header>

      {/* ── Divider ── */}
      <div className="h-px bg-gray-400" />

      {/* ── Content ── */}
      <div className="px-5 pt-7 pb-8">
        {/* Title */}
        <h2 className="font-body text-[1.3rem] font-bold leading-tight text-[#1a1a2e]">
          How would you like to
          <br />
          process your cart items?
        </h2>
        <p className="mt-2 font-body text-sm text-gray-500">
          Choose a method to process items.
        </p>

        {/* Option Cards */}
        <div className="mt-8 space-y-5">
          {/* Branded Products */}
          <Link
            href="/cart/branded"
            className="flex items-center gap-4 rounded-2xl bg-[#fde8e6] px-4 py-4 transition-colors hover:bg-[#f9d8d4] active:brightness-95"
            aria-label="Branded Products - Scan branded/packaged items and let AI identify and validate them"
          >
            <img
              src="/merchantLogos/aiCam.png"
              alt="AI Camera"
              className="h-[4.5rem] w-[4.5rem] flex-shrink-0"
            />
            <div className="flex-1">
              <p className="font-body text-base font-bold text-[#034C52]">
                Branded Products
              </p>
              <p className="mt-0.5 font-body text-sm leading-snug text-gray-600">
                Scan branded/packaged items and let AI identify and validate them.
              </p>
            </div>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9e8e82"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>

          {/* Non-Branded Products */}
          <Link
            href="/cart/non-branded"
            className="flex items-center gap-4 rounded-2xl bg-[#e8f5e9] px-4 py-4 transition-colors hover:bg-[#dceee0] active:brightness-95"
            aria-label="Non-Branded Products - For wet market items (fruits, vegetables, rice, meat, etc.). Enter details manually and AI validates."
          >
            <img
              src="/merchantLogos/manualInput.png"
              alt="Manual input form"
              className="h-[4.5rem] w-[4.5rem] flex-shrink-0"
            />
            <div className="flex-1">
              <p className="font-body text-base font-bold text-[#034C52]">
                Non-Branded Products
              </p>
              <p className="mt-0.5 font-body text-sm leading-snug text-gray-600">
                For wet market items (fruits, veg, meat). Enter details manually and AI validates.
              </p>
            </div>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9e8e82"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="flex-shrink-0"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
        </div>

        {/* Tip */}
        <div className="mt-8 flex items-center gap-3 rounded-xl border border-[#a8d5ba] bg-[#f0faf3] px-4 py-3">
          <img
            src="/merchantLogos/lightBulb.png"
            alt="Tip"
            className="h-6 w-6 flex-shrink-0"
          />
          <p className="font-body text-sm leading-snug text-[#034C52]">
            <span className="font-semibold">Tip:</span> Choose Branded for packaged goods and Non-Branded for wet market items.
          </p>
        </div>
      </div>
    </div>
  );
}
