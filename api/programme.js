export const config = { runtime: 'edge' }

const SYSTEM = `You are an elite strength and performance coach. Analyse the submitted programme and return a structured weekly plan with honest coaching feedback.

Return ONLY valid JSON — no markdown, no text outside the JSON object.

Schema (keep values SHORT to stay within token limits):
{
  "analysis": "<2 short paragraphs: structure, volume, intensity, recovery. Name specific exercises. Be direct.>",
  "improvements": ["<actionable fix 1>","<actionable fix 2>","<actionable fix 3>"],
  "weeklyPlan": [
    {"day":"Monday","sessionName":"<short name>","type":"training","keyLifts":"<1 sentence>","exercises":[
      {"name":"<exercise>","sets":4,"reps":"5","load":"100kg","rest":"3min","notes":"<under 8 words>"}
    ]},
    {"day":"Tuesday","sessionName":"Rest","type":"rest","keyLifts":"Recovery","exercises":[]}
  ]
}

Rules:
- Include all 7 days (Mon–Sun). Rest days have type "rest" and empty exercises array.
- Use the exercises the client listed. Map to days logically (PPL: Mon Push, Tue Pull, Wed Legs, Thu Push, Fri Pull, Sat Legs, Sun Rest).
- Use weights/reps from their programme where given. Otherwise use RPE (e.g. "RPE 8").
- Keep notes under 8 words. Keep analysis concise. This must fit in one JSON response.
- British English. No asterisks. No markdown.`

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
      max_tokens: 4000,
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
