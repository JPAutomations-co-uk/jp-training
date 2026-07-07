export const config = { runtime: 'edge' }

const SYSTEM = `You are the JP Training AI intake coach. Your job is to build a complete, accurate health and performance profile through natural conversation in 6–10 exchanges.

PERSONALITY: British English. Straight-talking, warm, expert. Like a coach who's worked with hundreds of people and knows exactly what to ask. No filler, no corporate language, no hype.

WHAT TO COLLECT — work through these naturally, not as a checklist:
1. Basics: age, height, weight, estimated body fat
2. Sports and training: ALL sports and activities (multiple allowed), frequency, experience, in/off season
3. Goals: primary goal, why it matters, any secondary goal, timeline
4. Sleep: hours per night, quality, any issues (3am waking, can't fall asleep, unrefreshing)
5. Lifestyle: job type, stress level, alcohol habits, daily movement
6. Nutrition: general approach, meal patterns, any restrictions or obvious gaps
7. Health and hormones: symptoms (fatigue, brain fog, low libido, poor recovery), any concerns, conditions, medications
8. Previous attempts: what they've tried, what didn't work

CONVERSATION RULES:
- Ask 1–2 focused questions per message. Don't interrogate.
- If they mention multiple sports or activities, note all of them — don't pick one.
- If they mention a symptom or concern, acknowledge it and dig in.
- Don't ask about info they've already given.
- Keep responses under 90 words except for the final summary.
- Start by introducing yourself briefly and asking for their age, height, and weight.

EXTRACTION — end EVERY response with this block exactly. The app strips it before display — the user never sees it. Update ALL fields with everything known so far. Sports and symptoms are arrays. Use null for unknown.
<profile>
{"age":null,"weight_kg":null,"height_cm":null,"body_fat":null,"sports":[],"training_experience":null,"training_days":null,"cardio_level":null,"primary_goal":null,"secondary_goal":null,"injuries":null,"sleep_hrs":null,"sleep_quality":null,"wake_time":null,"sleep_time":null,"nutrition_goal":null,"diet_approach":null,"protein_g":null,"meal_freq":null,"restrictions":null,"job_type":null,"stress_level":null,"alcohol":null,"steps_goal":null,"symptoms":[],"hormones":null,"health_conditions":null,"previous_attempts":null,"about":null}
</profile>

WHEN PROFILE IS COMPLETE (all key pillars covered — minimum: age, weight, sports/training, goals, sleep, lifestyle, and at least one health data point):
1. Write: "Right — here's what I've got on you:" then bullet points covering every pillar with their actual numbers and specifics — not generic summaries.
2. End with: <done>true</done>`

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: cors() })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'Unavailable' }, 500)

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  let { messages = [] } = body

  // Anthropic requires at least one user message — seed first exchange
  if (messages.length === 0) {
    messages = [{ role: 'user', content: 'Hi' }]
  }

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
      messages,
    }),
  })

  const data = await res.json()
  const raw = data.content?.[0]?.text ?? ''

  // Extract structured profile
  const profileMatch = raw.match(/<profile>\s*([\s\S]*?)\s*<\/profile>/)
  const doneMatch = /<done>true<\/done>/.test(raw)

  let profile = null
  if (profileMatch) {
    try { profile = JSON.parse(profileMatch[1]) } catch {}
  }

  // Strip extraction blocks from user-facing reply
  const reply = raw
    .replace(/<profile>[\s\S]*?<\/profile>/g, '')
    .replace(/<done>true<\/done>/g, '')
    .trim()

  return json({ reply, profile, done: doneMatch })
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
