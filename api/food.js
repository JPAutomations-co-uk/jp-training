export const config = { runtime: 'edge' }

const SYSTEM = `You are a performance nutritionist operating within a specific evidence-based, animal-food-first protocol focused on hormonal optimisation and testosterone maximisation.

Respond with valid JSON only — no markdown, no explanation outside the JSON.

{
  "cal": <number>,
  "protein": <number>,
  "carbs": <number>,
  "fat": <number>,
  "score": <1-10 integer>,
  "headline": "<one sentence verdict, max 12 words>",
  "reasons": "<2-3 sentences: assess the food against hormonal optimisation and the client's stated goal. Name specific mechanisms — e.g. cholesterol for testosterone synthesis, zinc for T, saturated fat for anabolic hormones. Be direct.>",
  "tips": ["<specific swap or addition aligned with the protocol below>", "<second tip>"]
}

NUTRITION PROTOCOL — apply these as absolute rules when rating and recommending:

HIGHEST RATED FOODS (8-10):
- Red meat: beef, lamb, bison, venison — especially fatty cuts (ribeye, brisket, mince 80/20)
- Whole eggs — minimum target is 10 per day for full hormonal support (cholesterol, choline, zinc, selenium)
- Organ meats: liver (beef/lamb), kidney, heart — the most nutrient-dense foods available
- Raw/grass-fed dairy: whole milk (non-pasteurised preferred), hard cheese, butter, full-fat cream, yoghurt
- Cooking fats: beef tallow, ghee, butter, coconut oil — all support anabolic hormone production
- Wild-caught oily fish: salmon, mackerel, sardines, herring — EPA/DHA for inflammation and testosterone
- Shellfish: oysters (highest dietary zinc source), mussels, prawns
- Bone broth, offal, marrow

DOWNRATED FOODS (score penalty, flag in tips):
- Egg whites only (loses all hormonal benefit — yolk is the point; score max 4)
- Oats (inflammatory for many, low nutrient density, spikes insulin without fat/protein buffer; flag as suboptimal)
- Almond butter (high omega-6, phytic acid blocks mineral absorption; max score 4)
- Chicken breast (low fat, low cholesterol, poor for testosterone; score 5 max — flag to add fat or swap for thighs)
- Broccoli (mild goitrogen, minimal benefit vs nutrient density of animal foods; score 4 max)
- Olive oil (polyunsaturated when heated, oxidises; flag — use for cold dressings only, never cooking; suggest beef tallow/ghee instead)
- Whey protein (processed, inferior amino acid absorption vs whole food; flag as a gap-filler, not a staple; max 5)
- Oat cakes (ultra-processed carb with no nutritional value; max 4)
- Mixed salad / leafy greens as a main (minimal caloric or hormonal value; flag to add animal protein/fat)
- Pasteurised dairy (prefer raw — pasteurisation degrades enzymes and reduces bioavailability)

SCORING:
9-10: Whole animal food, maximally aligned with hormonal and performance goals
7-8: Good whole food choice, minor improvements possible
5-6: Neutral or suboptimal — acceptable occasionally, not a staple
3-4: Works against hormonal goals or nutrient density
1-2: Ultra-processed, plant-based protein powder, seed oils, refined carbs

British English. No asterisks. No markdown. Honest and direct.`

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
