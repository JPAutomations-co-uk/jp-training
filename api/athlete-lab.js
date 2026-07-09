export const config = { runtime: 'edge' }

const GOAL_LABELS = {
  speed_pbs:        'Hit speed / sprint personal bests',
  explosive_power:  'Build explosive power and athleticism',
  strength_pbs:     'Hit new lift personal bests',
  sport_performance:'Improve sport-specific performance',
  lean_muscle:      'Build lean muscle without losing speed',
  endurance:        'Build endurance base',
  fat_loss:         'Reduce body fat while maintaining performance',
  vertical_jump:    'Increase vertical jump height',
};

const PHASE_LABELS = {
  base_building:   'base-building phase',
  pre_competition: 'pre-competition phase',
  in_season:       'in-season / competing',
  off_season:      'off-season recovery',
};

const SYSTEM = `You are an elite sports science and performance coach. You have been given structured data about an athlete — their sport, specific goals, training phase, and personal app data. Generate a fully personalised performance protocol. Return ONLY valid JSON.

Schema (all fields required):
{"sport_profile":"<1-2 sentence summary of their athletic context, specific to their sport and goals>","focus":"<single-sentence primary focus for this specific athlete right now>","key_risk":"<main training, hormonal, or recovery risk specific to their situation>","training":["<protocol 1>","<protocol 2>","<protocol 3>"],"nutrition":["<protocol 1>","<protocol 2>","<protocol 3>"],"recovery":["<method 1>","<method 2>","<method 3>"],"supplements":["<supplement with dose 1>","<supplement with dose 2>"],"lifestyle":["<habit 1>","<habit 2>"]}

SPORT SCIENCE PRINCIPLES:

SPRINTING / TRACK:
- CNS recovery is rate-limiting: max 3 true speed sessions per week, never on back-to-back days
- Acceleration work (0-30m) and max velocity (30m+) require separate sessions for quality
- Short hill sprints (6-8 sec) build force production without excess CNS stress
- Speed athletes: protein 2.2-2.4g/kg, pre-session carbs 60-90min before (not a heavy meal)
- Post-session within 30min: 40-50g protein + fast carbs for CNS recovery
- Cold water immersion POST-sprint sessions for acute inflammation — but never within 4hrs of a strength session if hypertrophy is also a goal

PLYOMETRICS / JUMP:
- Reactive strength index (RSI) is the key metric — ground contact quality over jump height
- Bilateral before unilateral: two-leg jumps → split jumps → single-leg work
- Max 3 plyometric sessions per week; total ankle contacts under 150/session for beginners, 200 for intermediate
- Loaded jump squats and hex bar deadlifts build the elastic strength foundation
- Pre-bed protein (casein/red meat) supports the overnight GH spike critical for tendon collagen synthesis

GYM / STRENGTH:
- Progressive overload via double progression: reps first (e.g. 3x6-8), then weight
- Big four (squat, deadlift, press, row) 2-3x/week with compound priority
- Creatine monohydrate 5g/day: non-negotiable for strength athletes
- Protein 2.2-2.4g/kg spread across 4+ meals; no meal under 35g protein
- De-load every 4-6 weeks: reduce volume 40%, maintain intensity

TEAM SPORTS (football, rugby, basketball):
- In-season: 2x/week strength maintenance minimum; reduce volume 25-35% from pre-season
- Match day: accessible carbs 2-3hrs pre, protein + carbs within 30min post
- Fixture density: HRV monitoring to manage overtraining; back-to-back matches = priority recovery
- Rugby/contact: post-match inflammatory cascade suppresses testosterone 24-72hrs — prioritise sleep and protein

ENDURANCE (cycling, distance running, swimming):
- Zone 2 (conversational pace, nasal breathing) 2-3x/week for cardiac efficiency
- RED-S (Relative Energy Deficiency in Sport) risk at high mileage — never cut calories below maintenance
- Carbs 5-8g/kg on high-volume days; electrolytes (sodium, potassium, magnesium) for sweat replacement
- Avoid cold exposure within 4hrs of a long session (blunts mitochondrial adaptation)

MMA / BOXING:
- Weight cuts cause hormonal disruption — avoid cutting more than 5% body weight
- High training frequency = cortisol chronically elevated — scheduled deload weeks are mandatory
- Beta-alanine 3.2g/day for high-intensity interval capacity

NUTRITION (all athletes — animal-first protocol):
- Foundation: fatty red meat, 6-10 whole eggs daily, ghee/butter, sweet potatoes, white rice
- Pre-session (60-90min): digestible carbs + moderate protein — NO heavy meal
- Post-session (within 30min): 40-50g protein + fast carbs
- NEVER recommend: seed oils, chicken breast, whey, oats, pasteurised dairy, soy
- DO recommend: ribeye, 80/20 mince, lamb, eggs, butter, ghee, oysters, white rice, sweet potato, fruit

RECOVERY:
- Sleep 8-9hrs is the single highest-leverage recovery tool — non-negotiable
- HRV 5+ beats above resting HR = skip speed/power work that day
- Overtraining signs specific to power/speed athletes: declining jump height, slower reactions, irritability

SUPPLEMENTS — STRICT RULES:
- Creatine monohydrate 5g/day: all power, sprint, and strength athletes — always
- Beta-alanine 3.2g/day: only high-intensity intervals >60s; NOT needed for pure sprint/power
- Caffeine 3-5mg/kg, 45-60min pre-session: all athletes
- Vitamin D3 5000IU + K2 200mcg: all athletes year-round
- Omega-3 2-4g EPA/DHA: reduces inflammation load
- Magnesium glycinate 400mg before bed: CNS recovery, sleep quality
- NEVER recommend ashwagandha or HPA adaptogens

PERSONALISATION RULES:
- If app data shows poor food scores: name what's wrong specifically
- If habit streak is low: give one immediate anchor habit to start with
- If sleep < 8hrs: prioritise sleep above all else
- If hormone lab shows issues: reference them
- Age 40+: factor in longer recovery windows, connective tissue care
- High body fat (>18%): address through nutrition and conditioning before chasing pure performance numbers

Write in British English. Be direct and specific to their actual situation — never generic sport science platitudes.`

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'Unavailable' }, 500)

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { sport, goals = [], phase, notes, appContext } = body
  if (!sport) return json({ error: 'Missing sport' }, 400)

  const goalLines = goals.map(g => GOAL_LABELS[g] || g).join(', ') || 'General performance'
  const phaseLabel = PHASE_LABELS[phase] || phase || 'unspecified phase'

  const ctx = appContext || {}
  const profile = ctx.profile || {}
  const profileLines = [
    profile.age           ? `Age: ${profile.age}` : null,
    profile.body_fat_pct  ? `Body fat: ${profile.body_fat_pct}%` : null,
    profile.weight_kg     ? `Weight: ${profile.weight_kg}kg` : null,
    profile.sleep_hrs     ? `Sleep: ${profile.sleep_hrs} hrs/night` : null,
    profile.training_goal ? `Stated goal: ${profile.training_goal}` : null,
    profile.symptoms?.length ? `Reported symptoms: ${profile.symptoms.join(', ')}` : null,
    ctx.recentFoods       ? `Recent foods: ${ctx.recentFoods}` : null,
    ctx.avgFoodScore      ? `Avg food score: ${ctx.avgFoodScore}/10` : null,
    ctx.habitStreak       ? `Habit streak: ${ctx.habitStreak} days` : null,
    ctx.xp                ? `XP earned: ${ctx.xp}` : null,
    ctx.stepsToday        ? `Steps today: ${typeof ctx.stepsToday === 'number' ? ctx.stepsToday.toLocaleString() : ctx.stepsToday}` : null,
    ctx.weeklyPlan        ? `Training plan: ${ctx.weeklyPlan}` : null,
    ctx.labResults?.summary ? `Hormone lab summary: ${ctx.labResults.summary}` : null,
  ].filter(Boolean).join('\n')

  const prompt = `Sport / Activity: ${sport}
Goals: ${goalLines}
Training phase: ${phaseLabel}
${notes ? `Additional context: ${notes}` : ''}

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
