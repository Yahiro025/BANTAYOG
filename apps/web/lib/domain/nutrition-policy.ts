// Domain logic: Nutrition Policy
// Defines subsidy rules per tier and nutrition category eligibility.
// Pure module — no side effects.

import type { NutritionCategory } from "@bantayog/schema";

// Categories considered nutritious (eligible for subsidy).
const ELIGIBLE_CATEGORIES: readonly NutritionCategory[] = [
  "FRUITS",
  "VEGETABLES",
  "MEATS",
  "BEVERAGES",
  "DAIRY",
  "GRAINS",
  "CANNED_GOODS",
];

// Subsidy multiplier per tier (Tier 1 gets higher subsidy).
const TIER_MULTIPLIER: Record<1 | 2, number> = {
  1: 1.5, // Critical tier: 1.5x subsidy
  2: 1.0, // Standard tier: 1.0x subsidy
};

// Maximum subsidy amount per tier (PHP).
const TIER_MAX_SUBSIDY: Record<1 | 2, number> = {
  1: 2000,
  2: 1200,
};

// Check if a nutrition category is eligible for subsidy.
export function isEligibleCategory(category: NutritionCategory): boolean {
  return ELIGIBLE_CATEGORIES.includes(category);
}

// Calculate total PHPC subsidy for a cart of items based on tier.
// @param tier  Beneficiary intervention tier (1 = Critical, 2 = Standard).
// @param items Array of { category, quantity, unitPricePhp }.
// @returns Total subsidy amount in PHP (capped per tier).
export function calculateSubsidy(
  tier: 1 | 2,
  items: { category: NutritionCategory; quantity: number; unitPricePhp: number }[],
): number {
  let total = 0;

  for (const item of items) {
    if (!isEligibleCategory(item.category)) continue;

    const itemCost = item.quantity * item.unitPricePhp;
    const subsidy = itemCost * TIER_MULTIPLIER[tier];
    total += subsidy;
  }

  // Cap at tier maximum
  return Math.min(total, TIER_MAX_SUBSIDY[tier]);
}

// Get the maximum allowed subsidy for a given tier.
export function getMaxSubsidy(tier: 1 | 2): number {
  return TIER_MAX_SUBSIDY[tier] ?? 1200;
}

// Alias for getMaxSubsidy used by tests.
export const getDefaultMaxCredits = getMaxSubsidy;

// Alias for TIER_MULTIPLIER lookup used by tests.
export function getCriticalWindowMultiplier(tier: 1 | 2): number {
  return TIER_MULTIPLIER[tier] ?? 1.0;
}

export { ELIGIBLE_CATEGORIES, TIER_MULTIPLIER, TIER_MAX_SUBSIDY };
