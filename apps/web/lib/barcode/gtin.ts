// GTIN (EAN-13/EAN-8/UPC-A/UPC-E) validation and normalization for the
// barcode-first product scan. This is a trust boundary: a decoded barcode
// is untrusted input until its length and check digit are verified.

const VALID_LENGTHS = [8, 13, 14]

/** Strips whitespace and non-digit characters from a raw barcode decode. */
export function normalizeGtin(raw: string): string {
  return raw.replace(/\D/g, '')
}

/**
 * Canonicalizes a UPC-A (12 digits) into its EAN-13 form (leading 0).
 * Product catalogs and barcode lookups must agree on one representation, or
 * a UPC-A scan will never match the same product stored as EAN-13.
 */
export function canonicalizeGtin(digits: string): string {
  return digits.length === 12 ? `0${digits}` : digits
}

/** GS1 mod-10 check digit validation, applied to UPC-E/UPC-A/EAN-8/EAN-13/GTIN-14. */
export function isValidGtin(raw: string): boolean {
  const digits = canonicalizeGtin(normalizeGtin(raw))
  if (!VALID_LENGTHS.includes(digits.length)) return false

  const payload = digits.slice(0, -1)
  const checkDigit = Number(digits[digits.length - 1])

  let sum = 0
  // Weighting alternates 3/1 from the rightmost payload digit.
  for (let i = 0; i < payload.length; i++) {
    const digit = Number(payload[payload.length - 1 - i])
    sum += i % 2 === 0 ? digit * 3 : digit
  }

  const computedCheckDigit = (10 - (sum % 10)) % 10
  return computedCheckDigit === checkDigit
}
