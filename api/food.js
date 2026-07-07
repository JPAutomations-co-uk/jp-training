export const config = { runtime: 'edge' }

const SYSTEM = `You are a sports nutritionist. Given a food description, estimate macros and rate it for this specific client.

Respond with valid JSON only — no markdown, no explanation outside the JSON.

{
  "cal": <number>,
  "protein": <number>,
  "carbs": <number>,
  "fat": <number>,
  "score": <1-10 integer>,
  "headline": "<one sentence verdict, max 12 words>",
  "reasons": "<2-3 sentences specific to their goals — what's good, what's not>",
  "tips": ["<specific actionable swap or improvement>", "<second tip>"]
}

Scoring (relative to the client's stated goals):
9-10: Excellent — whole food, high protein, perfectly aligned
7-8: Good — solid with minor improvements possible
5-6: Okay — neutral or mixed
3-4: Poor — works against their goals
1-2: Very poor — ultra-processed, no value, actively harmful

Be direct. Name the actual food. British English. No asterisks, no markdown.`

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'Unavailable' }, 500)

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { name, goals, weight, bodyFat, primaryGoal } = body
  if (!name?.trim()) return json({ error: 'Food name required' }, 400)

  const ctx = [
    goals || primaryGoal ? `Primary goal: ${goals || primaryGoal}` : null,
    weight ? `Weight: ${weight}kg` : null,
    bodyFat ? `Body fat: ~${bodyFat}%` : null,
  ].filter(Boolean).join('. ')

  const prompt = ctx
    ? `Food: "${name}"\nClient context: ${ctx}\n\nEstimate macros and rate this food.`
    : `Food: "${name}"\n\nEstimate macros and give a general rating.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
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
    return json({ error: 'Parse error' }, 500)
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
