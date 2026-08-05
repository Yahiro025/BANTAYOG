// BE1-2.1 · Domain Logic: Eligibility & Tier Computation
// Calculations are based on the child's age in days.
// The Philippine "First 1,000 Days" (RA 11148) begins at conception and ends
// at the child's second birthday (270 days gestation + 730 days childhood).
// Since the schema does not store an explicit birthdate, the birthdate is
// calculated relative to registration (`created_at` and `child_age_months`).
// Tier 1 (Critical): Age from conception <= 1,000 days (equivalent to age from birth <= 730 days)
// Tier 2 (Standard): Age from conception > 1,000 days (equivalent to age from birth > 730 days)

export const GESTATIONAL_PERIOD_DAYS = 270;
export const TIER_1_MAX_CONCEPTION_DAYS = 1000;
export const DAYS_PER_MONTH = 30.4375; // Average days in a month

// Calculates the child's birth date based on registration timestamp and age in months.
export function calculateBirthdate(createdAt: Date | string, ageMonths: number): Date {
  const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const birthdateMs = created.getTime() - ageMonths * DAYS_PER_MONTH * 24 * 60 * 60 * 1000;
  return new Date(birthdateMs);
}

// Calculates the child's current age in days from birth.
export function computeAgeInDays(
  createdAt: Date | string,
  ageMonths: number,
  currentDate: Date = new Date()
): number {
  const birthdate = calculateBirthdate(createdAt, ageMonths);
  const diffMs = currentDate.getTime() - birthdate.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

// Computes the child's age in days from conception.
export function computeAgeFromConception(
  createdAt: Date | string,
  ageMonths: number,
  currentDate: Date = new Date()
): number {
  const ageInDays = computeAgeInDays(createdAt, ageMonths, currentDate);
  return ageInDays + GESTATIONAL_PERIOD_DAYS;
}

// Returns Tier 1 (Critical) if age from conception <= 1,000 days, or Tier 2 (Standard) otherwise.
export function computeTier(
  createdAt: Date | string,
  ageMonths: number,
  currentDate: Date = new Date()
): 1 | 2 {
  const ageFromConception = computeAgeFromConception(createdAt, ageMonths, currentDate);
  return ageFromConception <= TIER_1_MAX_CONCEPTION_DAYS ? 1 : 2;
}

// Re-evaluates a beneficiary's tier and eligibility status.
// Returns the current computed tier and whether it has changed.
export function reEvaluateTier(
  beneficiary: {
    created_at: Date | string;
    child_age_months: number;
    eligibility_status: string;
  },
  currentDate: Date = new Date()
): {
  tier: 1 | 2;
  hasChanged: boolean;
} {
  const currentTier = computeTier(beneficiary.created_at, beneficiary.child_age_months, currentDate);

  // Map database status string or standard check to determine if tier representation has changed
  // In the db, the active tier representation will map to 1 or 2.
  // We assume the db field is checked against this computed tier.
  const storedTier = beneficiary.eligibility_status === 'ELIGIBLE' ? 1 : 2; // Default mapping example
  const hasChanged = currentTier !== storedTier;

  return {
    tier: currentTier,
    hasChanged
  };
}
