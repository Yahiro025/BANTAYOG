// Domain logic: Eligibility & Tier Computation
// Computes a beneficiary's intervention tier based on age in days.
// Tier 1 (Critical): ≤ 1,000 days  (~33 months)
// Tier 2 (Standard): > 1,000 days
// Pure functions — no side effects, no I/O.

export type Tier = 1 | 2;

export interface TierResult {
  tier: Tier;
  daysOld: number;
  isTransition: boolean;
}

// Milliseconds per day (accounting for average leap-year drift).
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Critical threshold in days.
const CRITICAL_DAYS = 1000;

// Compute intervention tier from a birthdate.
// @param birthdate  The child's birthdate.
// @param currentDate Optional reference date (defaults to now). Used for testing.
// @returns TierResult with tier, daysOld, and whether this is a transition boundary.
export function computeTier(
  birthdate: Date,
  currentDate: Date = new Date(),
): TierResult {
  const msDiff = currentDate.getTime() - birthdate.getTime();
  const daysOld = Math.floor(msDiff / MS_PER_DAY);

  // Exact boundary handling: exactly 1,000 days = Tier 1 (critical)
  const tier: Tier = daysOld <= CRITICAL_DAYS ? 1 : 2;

  return {
    tier,
    daysOld,
    isTransition: daysOld === CRITICAL_DAYS || daysOld === CRITICAL_DAYS + 1,
  };
}

// Re-evaluate tier for an existing beneficiary record.
// Detects if the tier has changed since last evaluation.
// @param birthdate    The child's birthdate.
// @param previousTier The previously stored tier (1 or 2).
// @param currentDate  Optional reference date.
// @returns TierResult with transition flag set if tier changed.
export function reEvaluateTier(
  birthdate: Date,
  previousTier: Tier,
  currentDate: Date = new Date(),
): TierResult & { changed: boolean } {
  const result = computeTier(birthdate, currentDate);
  return {
    ...result,
    changed: result.tier !== previousTier,
  };
}

// Derive an approximate birthdate from age in months.
// Used when the DB stores child_age_months instead of a birthdate column.
// @param ageMonths Integer months.
// @param referenceDate Optional reference date (defaults to now).
// @returns Approximate birthdate.
export function deriveBirthdateFromAgeMonths(
  ageMonths: number,
  referenceDate: Date = new Date(),
): Date {
  const d = new Date(referenceDate);
  d.setMonth(d.getMonth() - ageMonths);
  return d;
}

// Format age details string for the frontend table.
// @param ageMonths Integer months.
// @returns Formatted string like "~24 months\n(730 days)".
export function formatAgeDetails(ageMonths: number): string {
  const days = Math.round(ageMonths * 30.44);
  return `~${ageMonths} months\n(${days} days)`;
}
