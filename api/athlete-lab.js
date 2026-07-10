export const config = { runtime: 'edge' }

const GOAL_LABELS = {
  speed_pbs:        'sprint PBs',
  explosive_power:  'explosive power',
  strength_pbs:     'lift PBs',
  sport_performance:'sport performance',
  lean_muscle:      'lean muscle',
  endurance:        'endurance base',
  fat_loss:         'fat loss',
  vertical_jump:    'vertical jump height',
}

const PHASE_LABELS = {
  base_building:   'base-building',
  pre_competition: 'pre-competition',
  in_season:       'in-season',
  off_season:      'off-season',
}

// One protocol per sport — only the relevant ones get injected into the system prompt
const PROTOCOLS = {
  sprint:     'SPRINT/TRACK — drills: A-skip 4×20m (high knee, dorsiflexed ankle), B-skip 4×20m, wall-drive 3×8s, wicket runs 4×40m. plyos: horizontal bounds 3×6, drop jump 30cm box 3×5, pogo jumps 3×20. isos: split squat wall hold 3×30s/leg, Nordic hold 45° 3×6, iso calf raise 3×30s. pb_test: 10m fly sprint, 30m time, 100m PB, flying 20m.',
  plyo:       'PLYOMETRICS/JUMP — drills: approach mechanics, penultimate step load, arm swing timing, depth drop 4×5 (hold 2s on landing). plyos: bilateral→unilateral progression, max 150–200 ankle contacts/session, depth jump 40cm 3×5, broad jump 3×5, lateral bounds 3×8/side. isos: single-leg wall sit 3×45s, Spanish squat 3×30s, Copenhagen plank 3×20s/side. pb_test: standing vertical, approach vertical, broad jump, single-leg hop distance.',
  gym:        'GYM/STRENGTH — drills: hip circle bands 2×12/side, face pulls 3×15, lat activation dead hang, goblet tempo squat 2×8 (3-1-1). plyos: loaded jump squat 30–40% 1RM 3×5, med ball chest throw 3×6, box jump 3×5. isos: mid-thigh pull hold 6s×3 (max intent), iso bench press 6s×3, wall sit 3×30s. pb_test: squat 1RM, deadlift 1RM, bench 1RM, max strict pull-ups.',
  football:   'FOOTBALL — drills: 5-10-5 shuttle 4×, T-test agility, resisted sprint 15m 4×, lateral hurdle hop 3×10. plyos: reactive drop-and-cut 3×6/side, lateral bounds 3×8, single-leg reactive hops 3×8/leg. isos: Copenhagen plank 3×20–30s/side, Spanish squat 3×30s, single-leg glute bridge hold 3×20s. pb_test: 10m sprint, 30m sprint, T-test time, vertical jump.',
  rugby:      'RUGBY — drills: resisted sprint 10m 5×, hip carry sled 20m 4×, tackle bag work, scrum iso push 6s×4. plyos: broad jump 3×5, lateral bounds 3×8, rotational med ball 3×8/side. isos: scrum push 6s×4, Copenhagen plank 3×30s, Romanian deadlift hold 6s×3. pb_test: 10m sprint, 40m sprint, max chin-ups, vertical jump, carry repeat 20m×8.',
  basketball: 'BASKETBALL — drills: lane agility drill 4×, 3/4 court sprint 5×, defensive slide 3×20s, jump stop landing 3×8. plyos: approach vertical 4×5, lateral reactive hops 3×10, depth jump 3×5, single-leg landing 3×5/leg. isos: single-leg wall sit 3×30s, hip flexor hold 3×20s, ankle dorsiflexion wall hold 3×20s. pb_test: standing vertical, approach vertical, 3/4 court sprint, lane agility time.',
  mma:        'MMA/BOXING — drills: shadow footwork 3×3min, hip rotation med ball 3×10, resisted band punches 3×30s. plyos: explosive push-up 3×8, lateral box jump 3×6, rotational throw 3×8. isos: plank shoulder tap 3×30s, horse stance 3×45s, iso neck hold 3×20s/direction. pb_test: 3-min all-out pad round power, grip strength dynamometer, 20m shuttle repeat score.',
  running:    'DISTANCE RUNNING — drills: A-march 3×20m, B-skip 3×20m, single-leg calf raise 3×15, hip extension band 3×12. plyos: low-amplitude pogos 3×30s (stiff ankle, minimal knee bend), single-leg hops forward 3×8/leg. isos: single-leg calf hold 3×30s, Copenhagen plank 3×20s, wall sit 3×30s. pb_test: 5K time trial, 1-mile time, nasal-breathing threshold pace (max easy pace with nose breathing), 12-min Cooper test.',
  cycling:    'CYCLING — drills: single-leg pedal 3×30s/leg, standing sprint 5×10s, cadence spin 3×30s @100+rpm. plyos: box step-up explosive 3×8/leg, lateral lunge jump 3×6, hip flexor drive 3×10. isos: iso leg press hold 3×6s, glute bridge hold 3×30s, Copenhagen 3×20s. pb_test: 20-min FTP test (avg watts), 5-sec peak sprint power, VO2 max estimate (Garmin or 20-min max heart rate test).',
  crossfit:   'CROSSFIT — drills: muscle-up progressions, hollow body hold 3×20s, kipping timing drill, strict pull-up 3×max. plyos: box jump 3×5, broad jump 3×5, double-under 3×30s. isos: L-sit 3×10s accumulate, ring support hold 3×15s, wall sit 3×30s. pb_test: 500m row time, 1RM clean, Fran time (21-15-9 thrusters/pull-ups), max unbroken pull-ups.',
  tennis:     'TENNIS — drills: lateral shuffle 3×20m, split-step reaction 3×10, forehand rotation med ball 3×10, backpedal sprint 4×. plyos: lateral bounds 3×8/side, rotational throw 3×8, single-leg reactive hop 3×8/leg. isos: Copenhagen plank 3×20s, hip external rotator hold 3×20s/side, wrist extension iso 3×15s. pb_test: approach speed cone drill, service velocity estimate, reactive agility court test.',
  general:    'GENERAL ATHLETICISM — drills: multi-directional sprint 4×, acceleration ladder 3×, resisted bound 3×6. plyos: box jump 3×5, broad jump 3×5, lateral bound 3×6/side. isos: single-leg wall sit 3×30s, Copenhagen 3×20s, Spanish squat 3×30s. pb_test: 30m sprint, standing vertical jump, broad jump, 5-10-5 shuttle time.',
}

function matchProtocols(sport) {
  const s = sport.toLowerCase()
  const matches = []
  if (s.includes('sprint') || s.includes('track') || s.includes('athletics'))   matches.push(PROTOCOLS.sprint)
  if (s.includes('plyo') || s.includes('jump'))                                  matches.push(PROTOCOLS.plyo)
  if (s.includes('gym') || s.includes('strength'))                               matches.push(PROTOCOLS.gym)
  if (s.includes('football') || s.includes('soccer'))                            matches.push(PROTOCOLS.football)
  if (s.includes('rugby'))                                                        matches.push(PROTOCOLS.rugby)
  if (s.includes('basketball'))                                                   matches.push(PROTOCOLS.basketball)
  if (s.includes('mma') || s.includes('box'))                                    matches.push(PROTOCOLS.mma)
  if (s.includes('distance') || s.includes('running') || s.includes('endurance'))matches.push(PROTOCOLS.running)
  if (s.includes('cycl'))                                                         matches.push(PROTOCOLS.cycling)
  if (s.includes('crossfit'))                                                     matches.push(PROTOCOLS.crossfit)
  if (s.includes('tennis'))                                                       matches.push(PROTOCOLS.tennis)
  if (!matches.length || s.includes('general') || s.includes('other'))           matches.push(PROTOCOLS.general)
  return matches.join('\n')
}

const BASE_SYSTEM = `You are an elite sports performance coach. Return ONLY compact single-line JSON — no newlines, no indentation, no preamble.

FIELDS (British English):
- sport_profile: 1 sentence, their context + level
- focus: the #1 priority lever right now, 1 sentence
- key_risk: biggest injury/performance risk, 1 sentence
- pb_test: ARRAY of 3 — format each as "Test name: exact protocol (how to measure) — target by timeframe"
- drills: ARRAY of 5 — format each as "Exercise sets×reps/dist — WHY: what athletic quality it builds for their sport/position"
- plyos: ARRAY of 5 — format each as "Exercise volume — WHY: what it develops (vertical jump / sprint speed / reactive strength etc)"
- isos: ARRAY of 3 — format each as "Exercise duration/sets — WHY: injury prevention or stability function"
- nutrition: ARRAY of 2, max 20 words each
- recovery: ARRAY of 2, max 15 words each
- supplements: ARRAY of 2, format "name dose timing"

SPORT PROTOCOL (use these exact exercises):
`

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'Unavailable' }, 500)

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { sport, goals = [], phase, frequency, experience, position, level, weaknesses = [], notes, appContext } = body
  if (!sport) return json({ error: 'Missing sport' }, 400)

  const ctx     = appContext || {}
  const profile = ctx.profile || {}

  // Build system prompt with only the relevant sport protocol(s)
  const system = BASE_SYSTEM + matchProtocols(sport) + `

NUTRITION BASE (all athletes): fatty red meat + 10 eggs/day + ghee/butter + sweet potatoes/white rice.
NEVER: seed oils, whey, oats, pasteurised dairy, soy, chicken breast.
ALWAYS creatine 5g/day for power/speed/strength athletes. NEVER ashwagandha or any HPA adaptogens.`

  const lines = [
    `Sport: ${sport}`,
    position      ? `Position / event: ${position}` : null,
    level         ? `Competition level: ${level}` : null,
    weaknesses.length ? `Performance gaps to prioritise: ${weaknesses.join(', ')}` : null,
    goals.length  ? `Goals: ${goals.map(g => GOAL_LABELS[g] || g).join(', ')}` : null,
    phase         ? `Training phase: ${PHASE_LABELS[phase] || phase}` : null,
    frequency     ? `Frequency: ${frequency} days/week` : null,
    experience    ? `Experience: ${experience}` : null,
    notes         ? `Notes: ${notes}` : null,
    profile.age           ? `Age: ${profile.age}` : null,
    profile.body_fat_pct  ? `Body fat: ${profile.body_fat_pct}%` : null,
    profile.weight_kg     ? `Weight: ${profile.weight_kg}kg` : null,
    profile.sleep_hrs     ? `Sleep: ${profile.sleep_hrs}hrs/night` : null,
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
        max_tokens: 2000,
        system,
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
