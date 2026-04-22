#!/usr/bin/env node
// One-shot script: creates starter funnels in PostHog via REST API.
//
// Usage (from project root):
//   node scripts/create-posthog-funnels.mjs
//
// Reads these from .env (project root):
//   POSTHOG_PERSONAL_API_KEY   — PostHog → avatar → Personal API keys → Create key
//                                Minimum scope: "insight:write"
//   POSTHOG_PROJECT_ID         — the number in the PostHog URL: /project/12345/...
//   POSTHOG_HOST               — optional, defaults to https://eu.posthog.com

import fs from 'node:fs'
import path from 'node:path'

// ── Minimal .env loader (no dotenv dependency) ─────────────────────────────
const envPath = path.resolve(process.cwd(), '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const KEY        = process.env.POSTHOG_PERSONAL_API_KEY
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID
const HOST       = process.env.POSTHOG_HOST || 'https://eu.posthog.com'

if (!KEY || !PROJECT_ID) {
  console.error('Missing env vars in .env:')
  if (!KEY)        console.error('  POSTHOG_PERSONAL_API_KEY (starts with phx_)')
  if (!PROJECT_ID) console.error('  POSTHOG_PROJECT_ID (the number in /project/XXXXX/)')
  process.exit(1)
}

const pageviewStep = (pathname, operator = 'exact') => ({
  kind:  'EventsNode',
  event: '$pageview',
  name:  '$pageview',
  properties: [
    { key: '$pathname', value: pathname, operator, type: 'event' },
  ],
})

const funnelQuery = (series) => ({
  kind: 'InsightVizNode',
  source: {
    kind: 'FunnelsQuery',
    series,
    funnelsFilter: { funnelVizType: 'steps' },
    dateRange:     { date_from: '-7d' },
  },
})

const FUNNELS = [
  {
    name:        'Landing → Signin → Brief',
    description: 'Auto-created starter funnel — visitor conversion through signin into first brief open',
    query: funnelQuery([
      pageviewStep('/'),
      pageviewStep('/login'),
      pageviewStep('/home'),
      pageviewStep('/brief', 'icontains'),
    ]),
  },
  {
    name:        'Signin completion',
    description: 'How many visitors who reach /login make it through to /home',
    query: funnelQuery([
      pageviewStep('/login'),
      pageviewStep('/home'),
    ]),
  },
  {
    name:        'Brief → Game engagement',
    description: 'Of users who open a brief, how many go on to start a game',
    query: funnelQuery([
      pageviewStep('/brief', 'icontains'),
      pageviewStep('/play',  'icontains'),
    ]),
  },
]

async function createInsight(funnel) {
  const res = await fetch(`${HOST}/api/projects/${PROJECT_ID}/insights/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(funnel),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status} — ${body}`)
  }
  return res.json()
}

console.log(`Creating ${FUNNELS.length} funnel(s) in project ${PROJECT_ID} @ ${HOST}\n`)
for (const f of FUNNELS) {
  try {
    const insight = await createInsight(f)
    const url = `${HOST}/project/${PROJECT_ID}/insights/${insight.short_id}`
    console.log(`  [ok]   ${f.name}`)
    console.log(`         ${url}\n`)
  } catch (err) {
    console.error(`  [fail] ${f.name}`)
    console.error(`         ${err.message}\n`)
  }
}
console.log('Done.')
