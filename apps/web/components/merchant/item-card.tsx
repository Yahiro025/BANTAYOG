
// Item Card — displays a single cart item in checkout / result views

interface ItemCardProps {
  name: string;
  price: number;
  quantity: number;
  eligibility: "eligible" | "ineligible";
  imageDataUrl?: string;
}

export function ItemCard({
  name,
  price,
  quantity,
  eligibility,
  imageDataUrl,
}: ItemCardProps) {
  const isEligible = eligibility === "eligible";
  const subtotal = price * quantity;

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white px-4 py-4">
      {/* Product image */}
      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100">
        {imageDataUrl ? (
          <img
            src={imageDataUrl}
            alt={name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="text-xs text-gray-400">No image</div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <p className="font-body text-base font-bold text-gray-900 truncate">
          {name}
        </p>
        <div className="mt-1 flex items-center gap-3">
          <span className="font-body text-sm text-gray-500">
            ₱{subtotal.toFixed(2)}
          </span>
          <span className="font-body text-sm text-gray-400">
            Qty: {quantity}
          </span>
        </div>
        <div className="mt-1.5">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-body text-[11px] font-semibold ${
              isEligible
                ? "border border-[#10b981] bg-[#ecfdf5] text-[#065f46]"
                : "border border-[#ef4444] bg-[#fef2f2] text-[#991b1b]"
            }`}
            role="status"
          >
            {isEligible ? "Good for Children" : "Not Good for Children"}
          </span>
        </div>
      </div>
    </div>
  );
}
