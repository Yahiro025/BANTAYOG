import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Repo-wide static check: zero forbidden EVM/Ronin/Sky Mavis references
// remain outside historical spec documentation.
//
// This file lives at apps/server/src/static-checks/forbidden-references.test.ts
// so the repo root is four directory levels up:
//   static-checks -> src -> server -> apps -> <repo root>

const REPO_ROOT = resolve(__dirname, '../../../..')

const FORBIDDEN_PATTERNS = [
  /Ronin/i,
  /Tanto/i,
  /Waypoint/i,
  /SKY_MAVIS/i,
  /\b31337\b/,
  /\bviem\b/,
  /\bPolygon\b/,
  /\bAmoy\b/,
  /\b80002\b/,
  /PHPCSubsidy/,
  /ERC-20/,
  /Hardhat/i,
  /MetaMask/i,
  /personal_sign/,
]

const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.turbo',
  'artifacts',
  'cache',
  '.next',
  'dist',
  'coverage',
  '.kiro',
  'typechain-types',
])

// Paths (relative, forward-slash) where forbidden terms are allowed to
// appear because they are out of scope for this migration. Each entry is
// narrowly justified rather than a broad directory exclusion:
//  - this test's own source (which necessarily names the forbidden terms
//    in its patterns);
//  - ADR 001 and ADR 004, which are historical decision records that must
//    describe the prior (Ronin, then Polygon Amoy/EVM) chain layer to
//    explain why and what changed — rewriting them to omit the old chain
//    would falsify the record;
//  - the migration runbook, a procedural document whose entire content is
//    "what to remove and what to replace it with" — it inherently names
//    every forbidden term as the thing being torn out, phase by phase;
//  - docs/SMART_CONTRACT_OPS.md, explicitly marked "Superseded" and kept
//    only as a historical pointer to the current Stellar operations
//    equivalent; it must name the deleted contract once to explain why the
//    document is superseded;
//  - migration 00003, an already-applied, append-only SQL file that
//    introduced the original EVM address CHECK constraint. Per the
//    "migrations are append-only" rule, this file is never edited; migration
//    00011 is the one that actually swaps the constraint going forward.
const ALLOWLISTED_PATH_SUBSTRINGS = [
  '/apps/server/src/static-checks/forbidden-references.test.ts',
  '/docs/adr/001-transactional-outbox.md',
  '/docs/adr/004-stellar-migration.md',
  '/docs/STELLAR_MIGRATION_RUNBOOK.md',
  '/docs/SMART_CONTRACT_OPS.md',
  '/supabase/migrations/00003_polygon_amoy_migration.sql',
  '/AGENTS.md',
]

// True when `line` is a comment line: a `//` or `--` line comment, or a line
// inside/starting a `* ... *\/` block comment. Explanatory comments that
// merely document already-removed Ronin/Sky Mavis/Polygon code (e.g.
// "replaces the old Ronin Saigon client" or a SQL migration's "Old:
// '^0x...' (Ethereum)" note) are historical prose, not runtime behavior, so
// they don't violate this check's "no runtime/shipped-doc reference" intent.
function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('--')
  )
}

function walk(dir: string, results: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return results
  }
  for (const entry of entries) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue
    const fullPath = join(dir, entry)
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      walk(fullPath, results)
    } else if (
      /\.(ts|tsx|js|jsx|sol|json|md|sql|snap)$/.test(entry) ||
      entry === '.env.example'
    ) {
      // Real .env/.env.local files are gitignored, developer-local, and
      // outside the shipped codebase — scanning them would fail this check
      // on a developer's own leftover values rather than on committed code.
      // .env.example files ARE scanned, since those are committed templates.
      results.push(fullPath)
    }
  }
  return results
}

describe('static check: no forbidden EVM/Ronin/Sky Mavis references remain', () => {
  it('finds zero matches outside the allowlisted spec docs', () => {
    const files = walk(REPO_ROOT)

    // Sanity check: the walk must actually traverse a substantial number of
    // files, otherwise a path-resolution bug could make this test vacuously
    // pass by scanning an empty or wrong directory tree.
    expect(files.length).toBeGreaterThan(100)

    const violations: { file: string; pattern: string; line: number }[] = []

    for (const file of files) {
      const relPath = file.replace(REPO_ROOT, '').replace(/\\/g, '/')
      if (ALLOWLISTED_PATH_SUBSTRINGS.some((s) => relPath.includes(s))) continue

      let content: string
      try {
        content = readFileSync(file, 'utf8')
      } catch {
        continue
      }

      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            // Explanatory doc comments about ALREADY-removed EVM/Ronin code
            // are historical prose, not runtime behavior — allowed anywhere,
            // since they describe removal rather than reintroducing a reference.
            if (isCommentLine(line)) {
              continue
            }
            violations.push({ file: relPath, pattern: pattern.source, line: i + 1 })
          }
        }
      }
    }

    if (violations.length > 0) {
      const summary = violations.map((v) => `${v.file}:${v.line} matched ${v.pattern}`).join('\n')
      expect.fail(`Found forbidden references:\n${summary}`)
    }

    expect(violations).toHaveLength(0)
  })
})
