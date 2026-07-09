export const config = { runtime: 'edge' }

const GOAL_LABELS = {
  speed_pbs:        'hit speed/sprint personal bests',
  explosive_power:  'build explosive power and athleticism',
  strength_pbs:     'hit new lift personal bests',
  sport_performance:'improve sport-specific performance',
  lean_muscle:      'build lean muscle without losing speed',
  endurance:        'build endurance base',
  fat_loss:         'reduce body fat while maintaining performance',
  vertical_jump:    'increase vertical jump height',
}

const PHASE_LABELS = {
  base_building:   'base-building phase',
  pre_competition: 'pre-competition phase',
  in_season:       'in-season / competing',
  off_season:      'off-season / recovery',
}

const SYSTEM = `You are an elite sports science and performance coach. Analyse the athlete's sport, goals, training phase, experience level, and existing training plan. Return a fully personalised protocol as ONLY valid JSON — no other text.

CRITICAL: Return ONLY the JSON object below. No preamble, no explanation. Start with { and end with }.

Schema:
{
  "sport_profile": "<1-2 sentences: their specific athletic context and what stage they're at>",
  "focus": "<single sentence: the primary performance lever for this athlete right now>",
  "plan_analysis": "<if a current training plan was provided: 1-2 sentences on what it's missing or doing wrong for the stated goals. If no plan provided: null>",
  "plan_optimisations": ["<specific change to make to existing plan, e.g. 'Replace Friday Upper B pull session with a dedicated sprint session: 6×40m at 95% effort with 4-min rest'>", "<another specific change>", "<third change>"],
  "key_risk": "<main risk specific to their sport and current approach>",
  "training": ["<protocol point 1>", "<protocol point 2>", "<protocol point 3>"],
  "nutrition": ["<protocol 1>", "<protocol 2>", "<protocol 3>"],
  "recovery": ["<method 1>", "<method 2>"],
  "supplements": ["<supplement with dose 1>", "<supplement 2>"],
  "lifestyle": ["<habit 1>", "<habit 2>"]
}

If no current training plan is provided, set plan_analysis to null and plan_optimisations to an empty array.
plan_optimisations must be specific and actionable — reference exact session names, days, or exercises from the plan if provided.

SPORT SCIENCE RULES:

SPRINTING/TRACK — CNS recovery is rate-limiting. Max 3 speed sessions/week, never consecutive days. Separate acceleration (0-30m) from max velocity (30m+). Short hill sprints 6-8s build force. Post-sprint: 40-50g protein + fast carbs within 30min. Cold water 10-15min post-sprint for inflammation.

PLYOMETRICS — RSI (reactive strength index) over raw jump height. Bilateral before unilateral. Max 150-200 ankle contacts/session. Loaded jump squats and hex bar deadlifts build elastic strength base. Pre-bed protein (red meat) for overnight tendon collagen synthesis.

GYM/STRENGTH — Double progression (reps first, then weight). Compound lifts 2-3x/week minimum. Creatine 5g/day non-negotiable. Protein 2.2-2.4g/kg across 4+ meals, minimum 35g/meal. Deload every 4-6 weeks.

TEAM SPORTS — In-season: strength 2x/week minimum, volume 25-35% lower than pre-season. Match day: carbs 2-3hrs pre, protein+carbs within 30min post. HRV monitoring for fixture density management.

ENDURANCE — Zone 2 (nasal breathing pace) 2-3x/week. RED-S risk at high mileage — never cut below maintenance calories. Carbs 5-8g/kg on high-volume days. Electrolytes for sweat losses.

NUTRITION (all athletes):
- Base: fatty red meat, 6-10 whole eggs/day, ghee/butter, sweet potatoes, white rice, fruit
- Pre-session (60-90min): light digestible carbs + moderate protein
- Post-session (within 30min): 40-50g protein + fast carbs
- NEVER recommend: seed oils, chicken breast, whey, oats, pasteurised dairy, soy

SUPPLEMENTS — only recommend what applies:
- Creatine 5g/day: all power/speed/strength athletes — always
- Caffeine 3-5mg/kg, 45-60min pre: all athletes
- Vitamin D3 5000IU + K2 200mcg: all athletes year-round
- Omega-3 2-4g EPA/DHA: all athletes
- Magnesium glycinate 400mg pre-bed: CNS recovery and sleep
- Beta-alanine 3.2g: only high-intensity intervals >60s
- NEVER recommend ashwagandha or any HPA adaptogens

Write in British English. Be specific, direct, and reference actual data provided.`

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'Unavailable' }, 500)

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { sport, goals = [], phase, frequency, experience, notes, appContext } = body
  if (!sport) return json({ error: 'Missing sport' }, 400)

  const goalLines   = goals.map(g => GOAL_LABELS[g] || g).join(', ') || 'general performance'
  const phaseLabel  = PHASE_LABELS[phase] || phase || 'unspecified phase'
  const ctx         = appContext || {}
  const profile     = ctx.profile || {}

  const profileLines = [
    profile.age           ? `Age: ${profile.age}` : null,
    profile.body_fat_pct  ? `Body fat: ${profile.body_fat_pct}%` : null,
    profile.weight_kg     ? `Weight: ${profile.weight_kg}kg` : null,
    profile.sleep_hrs     ? `Sleep: ${profile.sleep_hrs}hrs/night` : null,
    profile.training_goal ? `App training goal: ${profile.training_goal}` : null,
    profile.symptoms?.length ? `Reported symptoms: ${profile.symptoms.join(', ')}` : null,
    ctx.recentFoods       ? `Recent foods logged: ${ctx.recentFoods}` : null,
    ctx.avgFoodScore      ? `Avg food quality score: ${ctx.avgFoodScore}/10` : null,
    ctx.habitStreak       ? `Habit streak: ${ctx.habitStreak} days` : null,
    ctx.stepsToday        ? `Steps today: ${ctx.stepsToday}` : null,
    ctx.labResults?.summary ? `Hormone lab: ${ctx.labResults.summary}` : null,
    ctx.labResults?.estimates?.total_t ? `Estimated total T: ${ctx.labResults.estimates.total_t.value} ${ctx.labResults.estimates.total_t.unit} (${ctx.labResults.estimates.total_t.status})` : null,
  ].filter(Boolean).join('\n')

  const prompt = `Sport/Activity: ${sport}
Goals: ${goalLines}
Training phase: ${phaseLabel}
${frequency ? `Training frequency: ${frequency} days/week` : ''}
${experience ? `Experience level: ${experience}` : ''}
${notes ? `Additional context: ${notes}` : ''}

Profile data:
${profileLines || 'none available'}

Current training plan:
${ctx.currentTrainingPlan || 'not provided'}

Analyse this athlete and return the JSON protocol.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: SYSTEM,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' },
        ],
      }),
    })

    const apiData = await res.json()
    if (apiData.error) {
      console.error('athlete-lab anthropic error:', JSON.stringify(apiData.error))
      return json({ error: 'API error', detail: apiData.error.message }, 500)
    }

    const raw = '{' + (apiData.content?.[0]?.text ?? '{}')
    let result
    try {
      result = JSON.parse(raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    } catch (parseErr) {
      console.error('athlete-lab parse error. stop_reason:', apiData.stop_reason, 'raw:', raw.slice(0, 400))
      return json({ error: 'Parse error', stop_reason: apiData.stop_reason, raw: raw.slice(0, 300) }, 500)
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
