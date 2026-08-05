
// Cart Summary — shows eligible items breakdown and totals
// Used in AI Scan result (Stage 3) and Checkout page

import { useCartStore } from "@/stores/cart-store";

export function CartSummary() {
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clearCart);

  const eligibleItems = items.filter((i) => i.eligibility === "eligible");
  const ineligibleItems = items.filter((i) => i.eligibility === "ineligible");

  const eligibleTotal = eligibleItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const ineligibleTotal = ineligibleItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const subtotal = eligibleTotal + ineligibleTotal;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 py-5">
      <h3 className="mb-4 font-body text-base font-bold text-[#034C52]">
        Cart Summary
      </h3>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-body text-sm text-gray-600">Subtotal</span>
          <span className="font-body text-sm font-medium text-gray-800">
            ₱{subtotal.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-body text-sm text-gray-600">
            Eligible Items
          </span>
          <span className="font-body text-sm font-medium text-gray-800">
            ₱{eligibleTotal.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-body text-sm text-gray-600">
            Ineligible Items
          </span>
          <span className="font-body text-sm font-medium text-gray-800">
            ₱{ineligibleTotal.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="my-3 h-px bg-gray-200" />

      <div className="flex items-center justify-between">
        <span className="font-body text-base font-bold text-[#034C52]">
          Total
        </span>
        <span className="font-body text-lg font-extrabold text-[#034C52]">
          ₱{subtotal.toFixed(2)}
        </span>
      </div>

      {items.length > 0 && (
        <button
          type="button"
          onClick={clearCart}
          className="mt-4 w-full rounded-xl border border-gray-200 py-2.5 font-body text-sm font-medium text-gray-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-500"
        >
          Clear Cart
        </button>
      )}
    </div>
  );
}
