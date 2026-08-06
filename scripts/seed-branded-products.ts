import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { isValidGtin, normalizeGtin, canonicalizeGtin } from '../apps/web/lib/barcode/gtin'
import { headers, type CsvRow, type ProductRow, readRows, productRow } from './seed-product-mapping'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const CSV_PATH = '/home/yahiro/Downloads/philippine_product_gtins.csv'

function readCsv(): CsvRow[] {
  return readRows(fs.readFileSync(CSV_PATH, 'utf8'))
}

async function main() {
  const apply = process.argv.includes('--apply')
  const rows = readCsv()
  const report: Array<{ row: number; name: string; gtin: string; outcome: string; reason?: string }> = []
  const products: ProductRow[] = []

  for (const [index, row] of rows.entries()) {
    // Canonicalize to EAN-13 so every stored GTIN matches the barcode lookup.
    const normalized = canonicalizeGtin(normalizeGtin(row.gtin))
    const independentlyValid = isValidGtin(normalized)
    const csvCheck = row.check_digit_valid.trim().toLowerCase()
    const csvSaysValid = csvCheck === 'yes'
    const csvSaysInvalid = csvCheck === 'no'
    let outcome = 'ready-to-upsert'
    let reason = `csv=${row.verification_status}/${row.confidence_score}; independent=${independentlyValid}; sources=${row.primary_sources}`

    if ((csvSaysValid || csvSaysInvalid) && csvSaysValid !== independentlyValid) reason += '; CHECKSUM DISCREPANCY'
    if (csvSaysInvalid || !independentlyValid) {
      outcome = 'skipped-invalid-checksum'
      reason += csvSaysInvalid ? '; CSV check_digit_valid=no' : '; independent validator rejected GTIN'
    } else {
      const mapped = productRow(row, normalized)
      if (!mapped) { outcome = 'skipped-other-reason'; reason += '; no unambiguous category/name mapping' }
      else products.push(mapped)
    }
    report.push({ row: index + 1, name: row.product_name, gtin: normalized, outcome, reason })
  }

  if (new Set(products.map((product) => product.gtin)).size !== products.length) throw new Error('Duplicate valid GTIN in CSV')

  let upserted = false
  if (apply) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    // Upsert-update semantics: re-running the seed refreshes names and prices
    // on existing rows instead of skipping them (plain unique index on gtin).
    const { error } = await createClient(url, key).from('products').upsert(products, { onConflict: 'gtin', ignoreDuplicates: false })
    if (error) {
      console.error(`Supabase upsert failed: ${error.code ?? 'unknown'} ${error.message}`)
      if (error.code === 'PGRST204' || /gtin.*column/i.test(error.message)) console.error('Migration 00013 is not available in the live schema; stopped without a workaround.')
      for (const item of report) {
        if (item.outcome === 'ready-to-upsert') {
          item.outcome = 'upsert-blocked-schema'
          item.reason += '; no rows inserted because the live products schema lacks gtin'
        }
      }
      process.exitCode = 1
    } else {
      upserted = true
      for (const item of report) if (item.outcome === 'ready-to-upsert') item.outcome = 'upserted'
    }
  }

  for (const item of report) console.log(`${item.row}. ${item.outcome} | ${item.name} | ${item.gtin} | ${item.reason}`)
  console.log(`\n${apply ? (upserted ? `Valid rows upserted: ${products.length}` : 'Valid rows upserted: 0 (schema blocker)') : `Dry run; valid rows ready: ${products.length}`}`)
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
