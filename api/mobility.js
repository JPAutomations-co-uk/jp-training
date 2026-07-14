export const config = { runtime: 'edge' }

const GOAL_MAP = {
  flexibility:  'improve overall flexibility and range of motion',
  posture:      'correct postural imbalances',
  height:       'maximise height through spinal decompression and posture',
  stiffness:    'reduce chronic stiffness and joint pain',
  injury_prev:  'prevent injuries through prehab and mobility work',
  performance:  'enhance athletic performance through mobility',
  morning:      'create an energising morning movement routine',
  wind_down:    'create a calming evening wind-down routine',
}

const PROBLEM_MAP = {
  hip_flexors:      'tight hip flexors',
  hamstrings:       'tight hamstrings',
  thoracic:         'restricted thoracic spine / upper back',
  shoulders:        'tight shoulders and chest',
  calves:           'tight calves and ankles',
  neck:             'tight neck and upper traps',
  lower_back:       'lower back stiffness',
  groin:            'tight groin and inner thighs',
  knees:            'IT band tightness and knee issues',
}

const POSTURE_MAP = {
  forward_head:       'forward head posture (chin juts forward)',
  rounded_shoulders:  'rounded/hunched shoulders',
  apt:                'anterior pelvic tilt (excessive lower back arch)',
  ppt:                'posterior pelvic tilt (flat back, glutes tucked)',
  scoliosis:          'scoliosis (lateral spinal curve)',
}

const FLEX_MAP = {
  very_stiff: 'very stiff — cannot reach shins',
  stiff:      'stiff — can touch toes on a good day',
  average:    'average — can touch toes',
  flexible:   'flexible — palms flat on floor',
}

const SYSTEM = `You are an expert mobility coach, physiotherapist, and movement specialist. Return ONLY compact single-line JSON — no newlines, no indentation, no preamble, no markdown.

FIELDS:
- summary: 2 sentences describing their movement profile and main opportunity
- key_focus: the single most impactful thing they should address first, 1 sentence
- morning_routine: ARRAY of 4-6 objects: {name, duration, how_to, why}
- desk_breaks: ARRAY of 3 objects: {name, duration, how_to}
- evening_routine: ARRAY of 4-6 objects: {name, duration, how_to, why}
- posture_corrections: ARRAY of 3-5 objects: {name, sets_reps, how_to, why, priority}
- height_protocol: ARRAY of 3-4 objects (ONLY if still_growing=yes): {name, duration, how_to, why}
- habits_to_add: ARRAY of 1-3 objects: {id, name, desc} — simple habit names like "Morning Mobility (10 min)" and "Evening Stretch (15 min)"

RULES:
- All exercises must be appropriate for home/no equipment (unless gym is specified)
- Duration format: "30 sec each side", "2 min", "10 reps", "3×30 sec"
- how_to: clear step-by-step in 2-4 sentences
- why: 1 sentence on the specific benefit for THIS person's goal/issue
- posture_corrections must directly address the specific posture issues reported
- height_protocol: focus on spinal decompression (hanging, cat-cow, child's pose), growth plate loading (jump protocol), and sleep/posture habits
- Match total routine length to their available time
- British English throughout`

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'Unavailable' }, 500)

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { goals=[], problems=[], posture=[], desk='8+', time='10', pref='morning', growing='no', flex='average', injuries='', appContext={} } = body

  const profile = appContext.profile || {}

  const lines = [
    goals.length    ? `Goals: ${goals.map(g => GOAL_MAP[g] || g).join(', ')}` : null,
    problems.length ? `Tight areas: ${problems.map(p => PROBLEM_MAP[p] || p).join(', ')}` : null,
    posture.filter(p=>p!=='none').length ? `Posture issues: ${posture.filter(p=>p!=='none').map(p => POSTURE_MAP[p] || p).join(', ')}` : 'No specific posture issues identified',
    `Hours sitting per day: ${desk}`,
    `Daily time available: ${time} minutes`,
    `Preferred time: ${pref}`,
    `Still growing: ${growing === 'yes' ? 'Yes — include height protocol' : 'No'}`,
    `Flexibility level: ${FLEX_MAP[flex] || flex}`,
    injuries ? `Injuries / areas to avoid: ${injuries}` : null,
    profile.age         ? `Age: ${profile.age}` : null,
    profile.weight_kg   ? `Weight: ${profile.weight_kg}kg` : null,
    profile.height_cm   ? `Height: ${profile.height_cm}cm` : null,
    appContext.obHabits?.stress_level ? `Stress level: ${appContext.obHabits.stress_level}` : null,
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
        max_tokens: 2500,
        system: SYSTEM,
        messages: [
          { role: 'user', content: lines },
          { role: 'assistant', content: '{' },
        ],
      }),
    })

    const apiData = await res.json()
    if (apiData.error) return json({ error: 'API error', detail: apiData.error.message }, 500)

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
