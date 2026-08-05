
// Quantity Selector — minus/plus buttons with numeric display

interface QuantitySelectorProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  disabled?: boolean;
}

export function QuantitySelector({
  value,
  onChange,
  min = 1,
  disabled = false,
}: QuantitySelectorProps) {
  const decrement = () => {
    if (!disabled && value > min) {
      onChange(value - 1);
    }
  };

  const increment = () => {
    if (!disabled) {
      onChange(value + 1);
    }
  };

  return (
    <div>
      <label className="mb-1.5 block font-body text-xs font-medium text-gray-600">
        Quantity
      </label>
      <div className={`flex items-center overflow-hidden rounded-xl border border-gray-200 ${disabled ? "bg-gray-100 opacity-50" : "bg-white"}`}>
        <button
          type="button"
          onClick={decrement}
          disabled={disabled || value <= min}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center text-lg font-bold text-gray-500 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:cursor-not-allowed disabled:text-gray-300"
          aria-label="Decrease quantity"
        >
          -
        </button>
        <span
          className="flex-1 text-center font-body text-base font-semibold text-gray-800"
          aria-live="polite"
          aria-atomic="true"
        >
          {value}
        </span>
        <button
          type="button"
          onClick={increment}
          disabled={disabled}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center text-lg font-bold text-gray-500 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:cursor-not-allowed disabled:text-gray-300"
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>
    </div>
  );
}
