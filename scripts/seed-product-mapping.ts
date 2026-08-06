// Pure CSV→product-row mapping for scripts/seed-branded-products.ts.
// No imports on purpose: the seed script and its unit tests load this module,
// and it must have zero side effects (no dotenv, no supabase client).

export const headers = [
  'gtin', 'gtin_format', 'check_digit_valid', 'brand', 'product_name', 'variant_size',
  'net_weight_volume', 'packaging_type', 'manufacturer_distributor', 'country_of_origin',
  'official_product_image_url', 'product_description', 'ingredients', 'allergen_info',
  'nutrition_facts_link_or_summary', 'official_product_page_url', 'gs1_company_prefix',
  'date_verified', 'primary_sources', 'verification_status', 'confidence_score',
  'verification_notes',
] as const

export type CsvRow = Record<(typeof headers)[number], string>
export type ProductRow = {
  name: string
  category: 'DAIRY' | 'VEGETABLES' | 'MEATS' | 'GRAINS' | 'FRUITS' | 'CANNED_GOODS' | 'BEVERAGES' | 'SNACKS'
  eligibility_status: 'eligible' | 'ineligible'
  price_range_min: number
  price_range_max: number
  gtin: string
}

export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++ } else quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(field); field = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(Boolean)) rows.push(row)
      row = []
    } else field += char
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

export function readRows(csv: string): CsvRow[] {
  const [csvHeader, ...rows] = parseCsv(csv.replace(/^\uFEFF/, ''))
  if (csvHeader.join(',') !== headers.join(',')) throw new Error('CSV header does not match the expected dataset')
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])) as CsvRow)
}

export function productRow(row: CsvRow, gtin: string): ProductRow | null {
  const text = `${row.brand} ${row.product_name} ${row.variant_size}`.toLowerCase()
  const size = row.variant_size.replace(/,\s*/g, ', ').trim()
  const brandPrefix = row.brand.trim() && !row.product_name.toLowerCase().includes(row.brand.toLowerCase())
    ? `${row.brand} `
    : ''
  const name = size && !row.product_name.toLowerCase().includes(size.toLowerCase())
    ? `${brandPrefix}${row.product_name} (${size})`
    : `${brandPrefix}${row.product_name}`

  if (!name || !row.variant_size) return null
  if (/dutch mill/.test(text)) {
    return { name, category: 'DAIRY', eligibility_status: 'eligible', price_range_min: /5x|400/.test(text) ? 35 : 15, price_range_max: /5x|400/.test(text) ? 90 : 30, gtin }
  }
  if (/alaska|bear brand/.test(text)) {
    const isCondensed = /condensed/.test(text)
    const isEligible = !isCondensed
    const min = /840|850/.test(text) ? 280 : /450|400/.test(text) ? 150 : /300/.test(text) ? 105 : 35
    return { name, category: isCondensed ? 'CANNED_GOODS' : 'DAIRY', eligibility_status: isEligible ? 'eligible' : 'ineligible', price_range_min: min, price_range_max: min + (min > 100 ? 80 : 45), gtin }
  }
  if (/milo/.test(text)) return { name, category: /cereal/.test(text) ? 'GRAINS' : 'BEVERAGES', eligibility_status: 'eligible', price_range_min: /12x/.test(text) ? 65 : /20 g/.test(text) ? 8 : 115, price_range_max: /12x/.test(text) ? 95 : /20 g/.test(text) ? 15 : 185, gtin }
  if (/gardenia/.test(text)) return { name, category: 'GRAINS', eligibility_status: 'eligible', price_range_min: 70, price_range_max: 110, gtin }
  if (/lucky me/.test(text)) return { name, category: 'CANNED_GOODS', eligibility_status: 'ineligible', price_range_min: 12, price_range_max: 25, gtin }
  if (/century|555|argentina|cdo/.test(text)) return { name, category: 'CANNED_GOODS', eligibility_status: 'ineligible', price_range_min: 35, price_range_max: 95, gtin }
  if (/monde|skyflakes/.test(text)) return { name, category: 'SNACKS', eligibility_status: 'ineligible', price_range_min: 25, price_range_max: 65, gtin }
  return null
}
