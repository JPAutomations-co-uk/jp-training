export const config = { runtime: 'edge' }

const GOAL_LABELS = {
  speed_pbs:        'sprint PBs',
  explosive_power:  'explosive power',
  strength_pbs:     'lift PBs',
  sport_performance:'sport performance',
  lean_muscle:      'lean muscle',
  endurance:        'endurance base',
  fat_loss:         'fat loss',
  vertical_jump:    'vertical jump',
}

const PHASE_LABELS = {
  base_building:   'base-building',
  pre_competition: 'pre-competition',
  in_season:       'in-season',
  off_season:      'off-season',
}

const SYSTEM = `You are a sports performance coach. Return ONLY valid JSON — no preamble, no explanation.

SCHEMA (required, all fields, British English, be specific and concise):
{"sport_profile":"<1 sentence: athlete context>","focus":"<1 sentence: #1 lever right now>","key_risk":"<1 sentence: main risk>","training":["<actionable point>","<actionable point>","<actionable point>"],"nutrition":["<specific guidance>","<specific guidance>"],"recovery":["<method>","<method>"],"supplements":["<name dose timing>","<name dose timing>"],"lifestyle":["<habit>"]}

RULES — never break these:
- Nutrition base: fatty red meat, 10 eggs/day, ghee/butter, sweet potatoes, white rice, fruit
- NEVER: seed oils, chicken breast, whey, oats, pasteurised dairy, soy
- Always recommend creatine 5g/day for power/speed/strength athletes
- NEVER recommend ashwagandha or any HPA adaptogen
- Sprinting/plyos: CNS recovery is rate-limiting, max 3 speed sessions/week, never consecutive days
- Strength: double progression, compound-first, deload every 4-6 weeks
- Supplements: D3 5000IU + K2 200mcg year-round, magnesium glycinate 400mg pre-bed`

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'Unavailable' }, 500)

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { sport, goals = [], phase, frequency, experience, notes, appContext } = body
  if (!sport) return json({ error: 'Missing sport' }, 400)

  const ctx     = appContext || {}
  const profile = ctx.profile || {}

  const lines = [
    `Sport: ${sport}`,
    goals.length  ? `Goals: ${goals.map(g => GOAL_LABELS[g] || g).join(', ')}` : null,
    phase         ? `Phase: ${PHASE_LABELS[phase] || phase}` : null,
    frequency     ? `Training frequency: ${frequency} days/week` : null,
    experience    ? `Experience: ${experience}` : null,
    notes         ? `Notes: ${notes}` : null,
    profile.age           ? `Age: ${profile.age}` : null,
    profile.body_fat_pct  ? `Body fat: ${profile.body_fat_pct}%` : null,
    profile.weight_kg     ? `Weight: ${profile.weight_kg}kg` : null,
    profile.sleep_hrs     ? `Sleep: ${profile.sleep_hrs}hrs` : null,
    ctx.avgFoodScore      ? `Avg food score: ${ctx.avgFoodScore}/10` : null,
    ctx.habitStreak       ? `Habit streak: ${ctx.habitStreak} days` : null,
    ctx.currentTrainingPlan ? `Current plan: ${ctx.currentTrainingPlan}` : null,
    ctx.labResults?.summary ? `Hormone status: ${ctx.labResults.summary}` : null,
  ].filter(Boolean).join('\n')

  try {
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
        system: SYSTEM,
        messages: [
          { role: 'user', content: lines },
          { role: 'assistant', content: '{' },
        ],
      }),
    })

    const apiData = await res.json()
    if (apiData.error) {
      return json({ error: 'API error', detail: apiData.error.message }, 500)
    }

    const raw = '{' + (apiData.content?.[0]?.text ?? '}')
    let result
    try {
      result = JSON.parse(raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    } catch {
      return json({ error: 'Parse error', stop_reason: apiData.stop_reason }, 500)
    }

    return json(result)
  } catch (err) {
    return json({ error: 'Unavailable', detail: String(err) }, 500)
  }
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  })
}
