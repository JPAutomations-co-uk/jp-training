export const config = { runtime: 'edge' }

import { scoreAllPatterns } from '../lib/hormone-scoring.js'

// Same Supabase project as app.html — SUPA_URL and the anon key are public
// values already shipped client-side (app.html:2360-2361), safe to duplicate
// here rather than invent a new secret-passing mechanism.
const SUPA_URL = 'https://uzzcvrduoswjsrvuopgv.supabase.co'
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6emN2cmR1b3N3anNydnVvcGd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NDQyNDcsImV4cCI6MjA5NzUyMDI0N30.5tD1xhZdSJaZFnNWfDXozPsvHceeqHl682pClUppUFo'

const RATE_LIMIT_PER_HOUR = 8

// Narrative-only system prompt. The old version told the model a prose
// "formula" and let it invent nmol/L values, statuses, and confidence
// percentages — nothing forced it to actually follow the arithmetic. Now
// the model receives already-computed, deterministic pattern likelihoods
// (lib/hormone-scoring.js) and is only allowed to write prose and a
// protocol on top of them — it must not invent or override the numbers.
const NARRATIVE_SYSTEM = `You are a male hormone physiology coach writing personalised narrative for a client, given PRE-COMPUTED pattern likelihoods you must not alter. Return ONLY valid JSON.

Schema (all fields required):
{"summary":"<2-3 sentences, personal, references the given patterns and app data by name, British English>","protocol":{"immediate":["<action 1>","<action 2>"],"nutrition":["<change 1>","<change 2>"],"training":["<adjustment>"],"sleep":["<action>"],"supplements":["<supplement with dose, or omit if none indicated>"],"testing":["<specific lab panel to confirm the likely pattern(s)>"]}}

RULES:
- You are given a list of patterns, each with a tier (likely/possible/unlikely/not_applicable), a stage where relevant, and the specific evidence (which answers) drove that tier. Do NOT invent a different tier, a numeric hormone value, or a confidence percentage — those do not exist in this system anymore and must never appear in your output.
- Write as if explaining real, computed screening results — not a guess you're making up on the spot.
- If androgen_axis is not_applicable (client is on TRT), do not discuss natural testosterone deficiency — discuss TRT management markers instead (oestradiol, haematocrit) if relevant, or omit that pattern from the summary entirely.
- Reference "likely" and "possible" patterns first; only mention "unlikely" patterns if directly relevant to ruling something out the client asked about.
- testing: recommend the specific UK-relevant blood panel(s) that would confirm each "likely" pattern (e.g. morning fasted total + free testosterone, SHBG, LH/FSH for androgen; 4-point salivary cortisol or DUTCH for HPA; TSH/fT4/fT3/rT3 for thyroid; fasting insulin + glucose for HOMA-IR).
- SUPPLEMENTS — evidence-based, not absolutist: adaptogens (ashwagandha/rhodiola) have weak evidence for raising T in someone not diagnosed deficient — don't recommend as a T-raising lever without a "likely" androgen_axis tier. Zinc: only if diet appears low (check app food data first) — red meat + eggs can already hit the adult upper limit. Shilajit: only from a purified, heavy-metal-tested source — always flag this if recommending it.
- NUTRITION: animal-first foundation (fatty red meat, eggs, butter/ghee/tallow, oysters, organ meats) as the default recommendation unless app food logs already show this is being met, in which case identify the actual gap instead.
- PROTOCOL: 2 items max per section. Reference app data by name where relevant. British English. Be direct, no hedging filler.`

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  if (!token) return json({ error: 'Not authenticated' }, 401)

  const userRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${token}` },
  })
  if (!userRes.ok) return json({ error: 'Invalid session' }, 401)
  const user = await userRes.json()
  const userId = user.id

  // Rate limit: count the caller's own assessments in the last hour, scoped
  // by RLS via their own token (no service-role key needed). Fails open —
  // if the check itself errors, don't block a legitimate user over it.
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const rlRes = await fetch(
      `${SUPA_URL}/rest/v1/hormone_lab_assessments?user_id=eq.${userId}&created_at=gt.${encodeURIComponent(since)}&select=id`,
      { headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${token}` } }
    )
    if (rlRes.ok) {
      const rows = await rlRes.json().catch(() => [])
      if (Array.isArray(rows) && rows.length >= RATE_LIMIT_PER_HOUR) {
        return json({ error: 'Rate limited', detail: `Max ${RATE_LIMIT_PER_HOUR} assessments per hour — try again shortly` }, 429)
      }
    }
  } catch (err) {
    console.error('hormone-lab rate-limit check error (failing open):', String(err))
  }

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { painPoints = [], answers = {}, appData = {}, profile = {} } = body

  // The only source of truth for the pattern likelihoods — computed in
  // real, unit-tested code, never handed to the LLM to invent.
  const scored = scoreAllPatterns({ answers, profile })

  const apiKey = process.env.ANTHROPIC_API_KEY
  let narrative = null
  let narrativeModel = null

  if (apiKey) {
    try {
      narrative = await generateNarrative({ apiKey, painPoints, appData, profile, patterns: scored.patterns })
      narrativeModel = 'claude-haiku-4-5-20251001'
    } catch (err) {
      console.error('hormone-lab narrative error (falling back to templated narrative):', String(err))
      narrative = fallbackNarrative(scored.patterns)
    }
  } else {
    narrative = fallbackNarrative(scored.patterns)
  }

  // The diagnostic output must never depend on the LLM call succeeding —
  // patterns are always returned even if narrative generation failed.
  return json({ ...scored, narrative, narrativeModel })
}

async function generateNarrative({ apiKey, painPoints, appData, profile, patterns }) {
  const patternLines = patterns.map(p => {
    if (p.tier === 'not_applicable') return `${p.pattern}: not_applicable — ${p.note}`
    const evidenceStr = p.evidence.map(e => e.note).join('; ') || 'no supporting evidence'
    const stageStr = p.stage ? `, stage ${p.stage}` : ''
    return `${p.pattern}: ${p.tier} (score ${p.score}${stageStr}) — evidence: ${evidenceStr}`
  }).join('\n')

  const appLines = [
    appData.recentFoods ? `Foods logged: ${appData.recentFoods}` : null,
    appData.avgFoodScore ? `Avg food score: ${appData.avgFoodScore}/10` : null,
    appData.habitsToday ? `Habits done today: ${appData.habitsToday}` : null,
    appData.habitsMissed ? `Habits missed: ${appData.habitsMissed}` : null,
    appData.habitStreak ? `Habit streak: ${appData.habitStreak} days` : null,
    appData.weeklyPlan ? `Training plan: ${appData.weeklyPlan}` : null,
    appData.stepsToday ? `Steps today: ${appData.stepsToday.toLocaleString?.() ?? appData.stepsToday}` : null,
    appData.stepsWeeklyAvg ? `7-day step avg: ${appData.stepsWeeklyAvg}` : null,
    profile.health_conditions ? `Health conditions / medications: ${profile.health_conditions}` : null,
    profile.onTRT ? `Currently on TRT / hormone therapy` : null,
  ].filter(Boolean).join('\n')

  const prompt = `Symptoms selected: ${painPoints.join(', ') || 'none'}

Computed pattern likelihoods (do not change these):
${patternLines}

App data:
${appLines || 'none'}

Write the summary and protocol JSON.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system: NARRATIVE_SYSTEM,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: '{' },
      ],
    }),
  })

  const apiData = await res.json()
  if (apiData.error) throw new Error(apiData.error.message || 'Anthropic API error')

  const raw = '{' + (apiData.content?.[0]?.text ?? '{}')
  const clean = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
  const parsed = JSON.parse(clean)

  if (typeof parsed.summary !== 'string' || typeof parsed.protocol !== 'object' || !parsed.protocol) {
    throw new Error('Narrative response missing expected shape')
  }
  return parsed
}

// Simple, deterministic narrative used whenever the LLM call is unavailable
// or fails — the pattern likelihoods themselves are never blocked by this.
function fallbackNarrative(patterns) {
  const flagged = patterns.filter(p => p.tier === 'likely' || p.tier === 'possible')
  const names = { androgen_axis: 'low testosterone', hpa_dysregulation: 'cortisol/HPA-axis dysregulation', thyroid: 'thyroid dysfunction', metabolic: 'insulin resistance' }
  const summary = flagged.length
    ? `Your answers flag ${flagged.map(p => `${names[p.pattern] || p.pattern} (${p.tier})`).join(', ')} as worth investigating with real bloodwork.`
    : `Nothing in your answers strongly flags any of the four patterns screened here — that's a good sign, but if symptoms persist it's still worth a baseline blood panel.`
  return {
    summary,
    protocol: {
      immediate: [],
      nutrition: [],
      training: [],
      sleep: [],
      supplements: [],
      testing: flagged.length
        ? ['Book a private blood panel covering the flagged pattern(s) — see the evidence list on each card for what to test.']
        : [],
    },
  }
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  })
}
