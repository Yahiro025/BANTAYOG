// BE1-2.2 · Domain Logic: Nutrition Policy
// Pure module defining:
// - Category classifications (eligible nutritious items vs. ineligible items).
// - Subsidy limits and credit rules per tier.

// Eligible nutritious categories based on health guidelines
export const ELIGIBLE_CATEGORIES = [
  'milk',
  'eggs',
  'vegetables',
  'fruits',
  'cereals',
  'fish',
  'meat',
  'legumes',
  'infant_formula'
] as const;

// Maximum monthly credit limits for beneficiaries per spec/guidelines
export const MONTHLY_CREDIT_LIMITS = {
  1: 1500.00, // Tier 1 Critical (1,500 PHP)
  2: 1000.00  // Tier 2 Standard (1,000 PHP)
} as const;

// Checks if a category is eligible under the nutrition policy.
export function isCategoryEligible(category: string): boolean {
  return ELIGIBLE_CATEGORIES.includes(category.toLowerCase() as any);
}

// Gets the maximum monthly credit allocation for a given tier.
export function getMonthlyLimit(tier: 1 | 2): number {
  return MONTHLY_CREDIT_LIMITS[tier];
}

// Validates if an allocation amount is within limits.
export function isAllocationValid(tier: 1 | 2, amount: number): boolean {
  if (amount <= 0) return false;
  return amount <= getMonthlyLimit(tier);
}
