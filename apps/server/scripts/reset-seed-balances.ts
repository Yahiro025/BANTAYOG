// One-off maintenance script: reset every existing beneficiary's
// `credit_balance` to match the fixed tier-based allocation model.
// • Tier 1 (Critical 1,000-Day Window) → 5,000 PHPC
// • Tier 2 (Standard)                  → 3,500 PHPC
// Older seed beneficiaries were created before the Polygon Amoy migration
// and carry arbitrary balances that no longer reflect the tier model. This
// script recomputes each beneficiary's tier from `created_at` +
// `child_age_months` and writes the corresponding fixed amount.
// Run with:  pnpm --filter @bantayog/server exec tsx --env-file .env scripts/reset-seed-balances.ts
import { createServiceClient } from '../src/lib/supabase.js'
import { computeTier } from '../src/domain/eligibility.js'

const TIER_1_ALLOCATION_PHPC = 5000
const TIER_2_ALLOCATION_PHPC = 3500

async function main() {
  const db = createServiceClient()

  const { data: beneficiaries, error } = await (db as any)
    .from('beneficiaries')
    .select('id, child_name, created_at, child_age_months, credit_balance')

  if (error) {
    console.error('Failed to fetch beneficiaries:', error.message)
    process.exit(1)
  }

  if (!beneficiaries || beneficiaries.length === 0) {
    console.log('No beneficiaries found. Nothing to reset.')
    return
  }

  console.log(`Found ${beneficiaries.length} beneficiaries. Resetting balances to tier amounts...\n`)

  let updated = 0
  for (const b of beneficiaries) {
    const tier = computeTier(b.created_at, b.child_age_months)
    const target = tier === 1 ? TIER_1_ALLOCATION_PHPC : TIER_2_ALLOCATION_PHPC
    const current = Number(b.credit_balance)

    if (current === target) {
      console.log(`  = ${b.child_name} (Tier ${tier}) already ${target} PHPC`)
      continue
    }

    const { error: updErr } = await (db as any)
      .from('beneficiaries')
      .update({ credit_balance: target })
      .eq('id', b.id)

    if (updErr) {
      console.error(`  ! ${b.child_name}: update failed — ${updErr.message}`)
      continue
    }

    console.log(`  ✓ ${b.child_name} (Tier ${tier}): ${current} → ${target} PHPC`)
    updated++
  }

  console.log(`\nDone. Updated ${updated} of ${beneficiaries.length} beneficiaries.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
