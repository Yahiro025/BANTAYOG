import { describe, it, expect } from 'vitest'
import { getFoodGroupLabel, CATEGORY_FOOD_GROUPS } from './nutrition-policy.js'

describe('getFoodGroupLabel', () => {
  it('maps every known nutrition category to a non-empty food group label', () => {
    for (const category of Object.keys(CATEGORY_FOOD_GROUPS)) {
      expect(getFoodGroupLabel(category)).toBe(CATEGORY_FOOD_GROUPS[category])
      expect(getFoodGroupLabel(category).length).toBeGreaterThan(0)
    }
  })

  it('defaults to "Other" for an unrecognized category instead of throwing', () => {
    expect(getFoodGroupLabel('NOT_A_REAL_CATEGORY')).toBe('Other')
  })
})
