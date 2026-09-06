/**
 * Backfill every inbox thread missing a flow outbound bubble.
 *
 * Usage:
 *   npx tsx scripts/backfill-missing-flow-messages.ts
 *   npx tsx scripts/backfill-missing-flow-messages.ts --days 90
 *   npx tsx scripts/backfill-missing-flow-messages.ts --dry-run
 *
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1]?.trim() : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main() {
  const daysRaw = arg('days')
  const lookbackDays = daysRaw ? Math.max(1, Number(daysRaw)) : 90
  const dryRun = hasFlag('dry-run')

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  if (Number.isNaN(lookbackDays)) {
    console.error('--days must be a number')
    process.exit(1)
  }

  const { supabaseAdmin } = await import('../src/lib/automations/admin-client')
  const { bulkRepairMissingFlowOutboundMessages } = await import(
    '../src/lib/flows/backfill-outbound-prompt'
  )

  console.info(
    dryRun ? '[dry-run] Scanning flow message_sent events…' : 'Repairing missing flow messages…',
    { lookbackDays },
  )

  const result = await bulkRepairMissingFlowOutboundMessages({
    db: supabaseAdmin(),
    lookbackDays,
    dryRun,
  })

  const { details, ...summary } = result
  console.log(JSON.stringify(summary, null, 2))
  if (details.length > 0) {
    console.info(`\nSample details (${Math.min(details.length, 25)} of ${details.length}):`)
    console.log(JSON.stringify(details.slice(0, 25), null, 2))
  }

  if (!dryRun && result.failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
