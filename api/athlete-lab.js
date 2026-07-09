export const config = { runtime: 'edge' }

const SYSTEM = `You are an elite sports science and performance coach. A user has described their sport, training, and goals in their own words. You also have access to their personal data from the app. Generate a fully personalised performance protocol. Return ONLY valid JSON.

Schema (all fields required):
{"sport_profile":"<1-2 sentence summary of their athletic context, specific to what they described>","focus":"<single-sentence primary performance focus, tailored to their goals>","key_risk":"<main training/hormonal/recovery risk specific to their situation>","training":["<protocol point 1>","<protocol point 2>","<protocol point 3>"],"nutrition":["<protocol 1>","<protocol 2>","<protocol 3>"],"recovery":["<method 1>","<method 2>","<method 3>"],"supplements":["<supplement with dose 1>","<supplement with dose 2>"],"lifestyle":["<habit 1>","<habit 2>"]}

SPORT SCIENCE PRINCIPLES:

TRAINING:
- Sprinting/explosivity: CNS recovery is rate-limiting — max 3 true speed sessions/week, never on back-to-back days
- Plyometrics: reactive strength index is key — prioritise ground contact quality over volume, progress from bilateral to unilateral to hurdle work
- Power athletes: conjugate or concurrent periodisation works well — max strength + explosive work in same block, just don't max both on same day
- Athletes building base fitness: Zone 2 aerobic work 2x/week alongside explosive sessions for cardiac efficiency without cortisol spikes
- Recovery between sessions: CNS stress > muscle stress for speed/power work — soreness ≠ recovery; HRV drop is the real signal

NUTRITION (animal-first, performance-optimised):
- Power/sprint athletes: protein 2.2-2.4g/kg, carbs 3-5g/kg (highest on training days), prioritise red meat, eggs, butter, sweet potato, white rice
- Pre-session (60-90min before speed/plyo work): easily digestible carbs + moderate protein — NOT a heavy meal
- Post-session (within 30min of power training): 40-50g protein + fast carbs — critical for CNS recovery
- Never recommend: seed oils, chicken breast, whey protein, oats, pasteurised dairy, soy
- DO recommend: fatty red meat, 6-10 eggs/day, ghee/butter, oysters, white rice, sweet potatoes, fruit

RECOVERY (specific to CNS-demanding training):
- Sleep is non-negotiable for speed athletes — GH peaks in deep sleep, CNS repairs overnight
- Cold exposure: 10-14°C immersion post-session for acute inflammation, but avoid within 4 hours of strength stimulus if hypertrophy is a goal
- Nervous system monitoring: resting HR elevated by 5+ beats = skip speed work that day
- Overtraining signs specific to power athletes: declining jump height, slower reaction times, irritability — these precede traditional markers

SUPPLEMENTS (evidence-based, conservative):
- Creatine monohydrate 5g/day: all power and sprint athletes — non-negotiable
- Beta-alanine 3.2g/day: only if high-intensity work >60s duration; not needed for pure sprinters
- Caffeine 3-5mg/kg 45-60min pre-session: proven for power output
- Vitamin D3 5000IU + K2 200mcg: all athletes year-round
- Omega-3 2-4g EPA/DHA: reduces inflammatory load from repeated high-intensity sessions
- Magnesium glycinate 400mg before bed: CNS recovery, sleep quality, reduces cramping
- NEVER recommend ashwagandha or HPA adaptogens

PERSONALISATION RULES:
- If app data shows poor food scores: name what's wrong and what to fix
- If habit streak is low: acknowledge it and give one immediate habit to anchor
- If sleep hours are below 8: prioritise sleep above all supplements
- If hormone lab shows issues: reference it specifically
- If they mention a specific sport technique (sprinting mechanics, plyometric type): give targeted advice for that
- Age 40+: factor in longer recovery needs, anabolic resistance
- High body fat: address this through nutrition and conditioning before pure performance protocols

Write in British English. Be direct and specific — not generic sport science. Reference their actual situation.`

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'Unavailable' }, 500)

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { description, appContext } = body
  if (!description) return json({ error: 'Missing description' }, 400)

  const ctx = appContext || {}
  const profile = ctx.profile || {}

  const profileLines = [
    profile.age           ? `Age: ${profile.age}` : null,
    profile.body_fat_pct  ? `Body fat: ${profile.body_fat_pct}%` : null,
    profile.weight_kg     ? `Weight: ${profile.weight_kg}kg` : null,
    profile.sleep_hrs     ? `Sleep: ${profile.sleep_hrs} hrs/night` : null,
    profile.training_goal ? `Primary goal: ${profile.training_goal}` : null,
    profile.symptoms?.length ? `Reported symptoms: ${profile.symptoms.join(', ')}` : null,
    ctx.recentFoods       ? `Recent foods: ${ctx.recentFoods}` : null,
    ctx.avgFoodScore      ? `Avg food score: ${ctx.avgFoodScore}/10` : null,
    ctx.habitStreak       ? `Habit streak: ${ctx.habitStreak} days` : null,
    ctx.xp                ? `XP earned: ${ctx.xp}` : null,
    ctx.stepsToday        ? `Steps today: ${ctx.stepsToday.toLocaleString?.() ?? ctx.stepsToday}` : null,
    ctx.weeklyPlan        ? `Training plan: ${ctx.weeklyPlan}` : null,
    ctx.labResults?.summary ? `Hormone lab summary: ${ctx.labResults.summary}` : null,
  ].filter(Boolean).join('\n')

  const prompt = `User description:
${description}

App data:
${profileLines || 'none available'}

Generate their personalised athletic performance protocol.`

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
        max_tokens: 1000,
        system: SYSTEM,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' },
        ],
      }),
    })

    const apiData = await res.json()
    if (apiData.error) return json({ error: 'API error', detail: apiData.error.message }, 500)

    const raw = '{' + (apiData.content?.[0]?.text ?? '{}')
    let result
    try {
      result = JSON.parse(raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    } catch {
      console.error('athlete-lab parse error:', raw.slice(0, 300))
      return json({ error: 'Parse error', raw: raw.slice(0, 200) }, 500)
    }

    return json(result)
  } catch (err) {
    console.error('athlete-lab handler error:', String(err))
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
