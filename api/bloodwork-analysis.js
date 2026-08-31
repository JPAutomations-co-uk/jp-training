export const config = { runtime: 'edge' }

import { scoreBloodwork, MARKER_NAMES } from '../lib/bloodwork-scoring.js'

// Same Supabase project as app.html — SUPA_URL and the anon key are public
// values already shipped client-side, safe to duplicate here rather than
// invent a new secret-passing mechanism (same note as hormone-lab.js).
const SUPA_URL = 'https://uzzcvrduoswjsrvuopgv.supabase.co'
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6emN2cmR1b3N3anNydnVvcGd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NDQyNDcsImV4cCI6MjA5NzUyMDI0N30.5tD1xhZdSJaZFnNWfDXozPsvHceeqHl682pClUppUFo'

const RATE_LIMIT_PER_HOUR = 8

// Tiered by design, agreed explicitly before this was built: values that
// are in-range or only mildly off, with an established lifestyle lever,
// get full direct guidance referencing the user's real app data — no
// hedging. Values in `clinicalReview` (computed deterministically in
// lib/bloodwork-scoring.js, never by this model) get called out
// specifically as needing a doctor, not folded into generic advice or
// buried under a blanket disclaimer. The model is not a substitute for a
// doctor for those findings — it cannot examine the user, cannot order
// follow-up differential tests, and has no accountability mechanism if it
// gets the triage wrong. This is a deliberate scope boundary, not a
// hedge — see the design conversation this was built from.
const NARRATIVE_SYSTEM = `You are a physiology coach writing personalised narrative for a client, given PRE-COMPUTED marker classifications you must not alter. Return ONLY valid JSON.

Schema (all fields required):
{"summary":"<2-4 sentences, personal, references specific markers and app data by name, British English>","in_scope_guidance":{"nutrition":["<change 1>","<change 2>"],"training":["<adjustment>"],"sleep":["<action>"],"testing":["<specific follow-up marker or panel worth retesting, if any>"]},"clinical_flags":[{"marker_or_pattern":"<name>","why":"<1-2 sentences, in the client's own terms, explaining specifically why this is outside what diet/training can address and needs a doctor — not a generic 'consult your doctor' line>"}]}

RULES:
- You are given a list of classified markers (in_range/low/high/critical_low/critical_high) and a separate list of clinicalReview findings. Do NOT invent a different classification, a numeric value, or a confidence percentage for any marker — those do not exist in this system and must never appear in your output.
- clinical_flags must contain exactly one entry per item in the given clinicalReview list — do not add extras, do not omit any, do not soften or generalise the given reason. If clinicalReview is empty, clinical_flags must be an empty array.
- in_scope_guidance must ONLY address markers classified low/high (not critical_low/critical_high, and not any marker referenced in clinicalReview) where the established literature has a real lifestyle-modifiable lever. If a marker has no established food/training/sleep lever, leave it out rather than inventing one.
- NUTRITION: reference the client's real app data (their actual current nutrition plan, training load) — identify the actual gap or actual excess, don't give generic advice that ignores what they're already doing.
- Never recommend a supplement. This client's protocol is whole-food and training only — reframe any supplement-shaped idea as a food or lifestyle lever, or omit it.
- 2 items max per in_scope_guidance section. British English. Be direct, no hedging filler on in-scope findings — hedging belongs only in clinical_flags, where it's warranted.`

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

  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const rlRes = await fetch(
      `${SUPA_URL}/rest/v1/bloodwork_assessments?user_id=eq.${userId}&created_at=gt.${encodeURIComponent(since)}&select=id`,
      { headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${token}` } }
    )
    if (rlRes.ok) {
      const rows = await rlRes.json().catch(() => [])
      if (Array.isArray(rows) && rows.length >= RATE_LIMIT_PER_HOUR) {
        return json({ error: 'Rate limited', detail: `Max ${RATE_LIMIT_PER_HOUR} assessments per hour — try again shortly` }, 429)
      }
    }
  } catch (err) {
    console.error('bloodwork-analysis rate-limit check error (failing open):', String(err))
  }

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { markers = {}, appData = {} } = body

  // The only source of truth for what's in/out of range — computed in
  // real, testable code, never handed to the LLM to invent.
  const scored = scoreBloodwork(markers)

  const apiKey = process.env.ANTHROPIC_API_KEY
  let narrative = null
  let narrativeModel = null

  if (apiKey) {
    try {
      narrative = await generateNarrative({ apiKey, appData, scored })
      narrativeModel = 'claude-haiku-4-5-20251001'
    } catch (err) {
      console.error('bloodwork-analysis narrative error (falling back to templated narrative):', String(err))
      narrative = fallbackNarrative(scored)
    }
  } else {
    narrative = fallbackNarrative(scored)
  }

  // Deterministic output must never depend on the LLM call succeeding —
  // flags and clinicalReview are always returned even if narrative
  // generation failed.
  return json({ ...scored, narrative, narrativeModel })
}

async function generateNarrative({ apiKey, appData, scored }) {
  const flagLines = scored.flags.map(f => {
    const name = MARKER_NAMES[f.marker] || f.marker
    return `${name}: ${f.value}${f.unit ? ' ' + f.unit : ''} (range ${f.refLow}-${f.refHigh}) — ${f.status}`
  }).join('\n')

  const clinicalLines = scored.clinicalReview.map(c => `${c.pattern} [${c.markers.join(', ')}]: ${c.reason}`).join('\n')

  const appLines = [
    appData.currentNutritionPlan ? `Current nutrition plan: ${appData.currentNutritionPlan}` : null,
    appData.avgFoodScore ? `Avg food score: ${appData.avgFoodScore}/10` : null,
    appData.currentTrainingPlan ? `Current training plan: ${appData.currentTrainingPlan}` : null,
    appData.habitStreak ? `Habit streak: ${appData.habitStreak} days` : null,
    appData.sleepHrs ? `Sleep: ${appData.sleepHrs}hrs/night` : null,
  ].filter(Boolean).join('\n')

  const prompt = `Classified markers (do not change these):
${flagLines || 'none scoreable'}

Clinical-review findings — computed deterministically, must each get exactly one clinical_flags entry, verbatim reasoning:
${clinicalLines || 'none'}

App data:
${appLines || 'none'}

Write the summary, in_scope_guidance, and clinical_flags JSON.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
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

  if (typeof parsed.summary !== 'string' || typeof parsed.in_scope_guidance !== 'object' || !Array.isArray(parsed.clinical_flags)) {
    throw new Error('Narrative response missing expected shape')
  }
  return parsed
}

// Simple, deterministic narrative used whenever the LLM call is unavailable
// or fails — flags and clinicalReview are never blocked by this, and
// clinical_flags is built directly from clinicalReview so nothing gets
// silently dropped just because the LLM call failed.
function fallbackNarrative(scored) {
  const offRange = scored.flags.filter(f => f.status !== 'in_range')
  const summary = offRange.length
    ? `${offRange.length} marker${offRange.length > 1 ? 's are' : ' is'} outside the reference range you submitted — see the flags below for specifics.`
    : `Everything you submitted classified as within range.`
  return {
    summary,
    in_scope_guidance: { nutrition: [], training: [], sleep: [], testing: [] },
    clinical_flags: scored.clinicalReview.map(c => ({ marker_or_pattern: c.pattern, why: c.reason })),
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
