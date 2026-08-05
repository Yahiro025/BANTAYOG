
// Eligibility Toggle — Good for Children / Not Good for Children

type EligibilityValue = "eligible" | "ineligible" | null;

interface EligibilityToggleProps {
  value: EligibilityValue;
  onChange: (value: "eligible" | "ineligible") => void;
  disabled?: boolean;
}

export function EligibilityToggle({
  value,
  onChange,
  disabled = false,
}: EligibilityToggleProps) {
  const isEligible = value === "eligible";
  const isIneligible = value === "ineligible";

  return (
    <div>
      <label className="mb-2 block font-body text-xs font-medium text-gray-600">
        Category/Validation
      </label>
      <div className={`grid grid-cols-2 gap-3 ${disabled ? "opacity-50" : ""}`} role="radiogroup" aria-label="Item classification">
        {/* Eligible option */}
        <button
          type="button"
          role="radio"
          aria-checked={isEligible}
          onClick={() => !disabled && onChange("eligible")}
          disabled={disabled}
          className={`flex items-center gap-2 rounded-xl border-2 px-3 py-3 transition-all ${
            disabled ? "cursor-not-allowed border-gray-200 bg-gray-100" :
            isEligible
              ? "border-[#10b981] bg-[#ecfdf5]"
              : "border-gray-200 bg-gray-50 hover:bg-gray-100/50"
          }`}
        >
          <img
            src={
              isEligible
                ? "/merchantLogos/green_correct.png"
                : "/merchantLogos/gray_correct.png"
            }
            alt={isEligible ? "Eligible" : "Not selected"}
            className="h-5 w-5 flex-shrink-0"
          />
          <div className="text-left">
            <p
              className={`font-body text-xs font-semibold leading-tight ${
                isEligible ? "text-[#065f46]" : "text-gray-400"
              }`}
            >
              Good for Children
            </p>
            <p
              className={`font-body text-[10px] ${
                isEligible ? "text-[#059669]" : "text-gray-400"
              }`}
            >
              (Nutritious)
            </p>
          </div>
        </button>

        {/* Ineligible option */}
        <button
          type="button"
          role="radio"
          aria-checked={isIneligible}
          onClick={() => !disabled && onChange("ineligible")}
          disabled={disabled}
          className={`flex items-center gap-2 rounded-xl border-2 px-3 py-3 transition-all ${
            disabled ? "cursor-not-allowed border-gray-200 bg-gray-100" :
            isIneligible
              ? "border-[#ef4444] bg-[#fef2f2]"
              : "border-gray-200 bg-gray-50 hover:bg-gray-100/50"
          }`}
        >
          <img
            src={
              isIneligible
                ? "/merchantLogos/red_wrong.png"
                : "/merchantLogos/gray_wrong.png"
            }
            alt={isIneligible ? "Ineligible" : "Not selected"}
            className="h-5 w-5 flex-shrink-0"
          />
          <div className="text-left">
            <p
              className={`font-body text-xs font-semibold leading-tight ${
                isIneligible ? "text-[#991b1b]" : "text-gray-400"
              }`}
            >
              Not Good for Children
            </p>
            <p
              className={`font-body text-[10px] ${
                isIneligible ? "text-[#dc2626]" : "text-gray-400"
              }`}
            >
              (Not Nutritious)
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
