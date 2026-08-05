
// Three-step progress indicator for AI Image Scan flow
// Steps: Capture → Review → Add to Cart

interface Step {
  label: string;
}

const STEPS: Step[] = [
  { label: "Capture" },
  { label: "Review" },
  { label: "Add to Cart" },
];

interface ProgressIndicatorProps {
  /** 1-indexed current step (1, 2, or 3) */
  currentStep: 1 | 2 | 3;
}

export function ProgressIndicator({ currentStep }: ProgressIndicatorProps) {
  return (
    <div className="flex items-start justify-between px-6 pt-5 pb-2" role="group" aria-label={`Step ${currentStep} of ${STEPS.length}: ${STEPS[currentStep - 1].label}`}>
      {STEPS.map((step, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum <= currentStep;

        return (
          <div key={step.label} className="flex flex-1 flex-col items-center">
            <div className="flex items-center w-full">
              {/* Left connector line */}
              {idx > 0 && (
                <div
                  className={`h-0.5 flex-1 ${
                    isActive ? "bg-[#10b981]" : "bg-gray-300"
                  }`}
                  style={{ marginTop: "12px" }}
                />
              )}

              {/* Step circle */}
              <div
                className={`flex h-[2.1rem] w-[2.1rem] flex-shrink-0 items-center justify-center rounded-full font-body text-sm font-bold ${
                  isActive
                    ? "bg-[#10b981] text-white"
                    : "bg-gray-300 text-white"
                }`}
              >
                {stepNum}
              </div>

              {/* Right connector line */}
              {idx < STEPS.length - 1 && (
                <div
                  className={`h-0.5 flex-1 ${
                    stepNum < currentStep ? "bg-[#10b981]" : "bg-gray-300"
                  }`}
                  style={{ marginTop: "12px" }}
                />
              )}
            </div>

            {/* Label */}
            <span
              className={`mt-2 font-body text-xs font-medium ${
                isActive ? "text-[#10b981]" : "text-gray-400"
              }`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
