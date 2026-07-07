export const config = { runtime: 'edge' }

const SYSTEM = `You are an elite strength and performance coach. Your job is to:
1. Analyse the training programme submitted by the client
2. Return a structured weekly plan based on it, optimised for their goals
3. Give honest coaching feedback — what's working, what needs fixing

Return ONLY valid JSON. No markdown. No explanation outside the JSON.

{
  "analysis": "<2-3 paragraph honest assessment of the programme — structure, volume, intensity, progression, recovery. Name specific exercises. Be direct.>",
  "improvements": [
    "<specific, actionable improvement — e.g. 'Your bench frequency is once per week — move to 2x for faster progress'>",
    "<improvement 2>",
    "<improvement 3>"
  ],
  "weeklyPlan": [
    {
      "day": "Monday",
      "sessionName": "<e.g. Push A — Chest, Shoulders, Triceps>",
      "type": "training",
      "keyLifts": "<1 sentence on the priority of this session>",
      "exercises": [
        {
          "name": "<exercise name>",
          "sets": <number>,
          "reps": "<e.g. 5 or 8-10 or AMRAP>",
          "load": "<e.g. 100kg or RPE 8 or bodyweight>",
          "rest": "<e.g. 3 min or 90 sec>",
          "notes": "<coaching cue or progression note — keep under 12 words>"
        }
      ]
    },
    {
      "day": "Tuesday",
      "sessionName": "Rest",
      "type": "rest",
      "keyLifts": "Full recovery — sleep, nutrition, walk",
      "exercises": []
    }
  ]
}

Rules:
- Use every exercise the client listed. Do not invent new ones unless fixing a clear gap.
- Map sessions to days logically based on their frequency (e.g. PPL = Mon Push, Tue Pull, Wed Legs, Thu Push, Fri Pull, Sat Legs, Sun Rest)
- Fill in load based on any weights/reps they mentioned. If not given, use RPE targets.
- Rest days should be complete rest or Zone 2 walk only.
- British English. No asterisks.`

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'Unavailable' }, 500)

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { programme, goal, experience, days, injuries } = body
  if (!programme?.trim()) return json({ error: 'Programme required' }, 400)

  const ctx = [
    goal ? `Primary goal: ${goal}` : null,
    experience ? `Training experience: ${experience}` : null,
    days ? `Training days per week: ${days}` : null,
    injuries ? `Injuries/limitations: ${injuries}` : null,
  ].filter(Boolean).join('\n')

  const prompt = `Client profile:\n${ctx || 'No profile provided'}\n\nCurrent programme:\n${programme}\n\nAnalyse and restructure into an optimised weekly plan.`

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
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  const data = await res.json()
  const text = data.content?.[0]?.text ?? '{}'

  let result
  try {
    const clean = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    result = JSON.parse(clean)
  } catch {
    return json({ error: 'Parse error', raw: text.slice(0, 200) }, 500)
  }

  return json(result)
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
