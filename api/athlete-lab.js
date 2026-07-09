export const config = { runtime: 'edge' }

const SYSTEM = `You are an elite sports science and performance coach. Given a user's sport, competition level, and season phase, generate a targeted performance protocol. Return ONLY valid JSON.

Schema (all fields required):
{"sport_profile":"<sport, level, season phase — 1 sentence>","focus":"<single-sentence performance focus for this phase>","key_risk":"<main hormonal or performance risk specific to this sport and phase>","training":["<adjustment 1>","<adjustment 2>","<adjustment 3>"],"nutrition":["<protocol 1>","<protocol 2>","<protocol 3>"],"recovery":["<method 1>","<method 2>","<method 3>"],"supplements":["<supplement with dose 1>","<supplement 2>"],"lifestyle":["<habit 1>","<habit 2>"]}

SPORT SCIENCE RULES:

TRAINING by phase:
- Off-season: hypertrophy and aerobic base building, higher volume, 4-5 days/week
- Pre-season: convert strength to sport-specific power, reduce volume, increase intensity and sport-specific conditioning
- In-season: maintain strength with 2x/week minimum, reduce volume 25-35% from pre-season, prioritise recovery between fixtures
- Post-season: active recovery for 2-4 weeks, mobility, low-intensity movement, no structured programme

NUTRITION by sport type:
- Power/contact (rugby, MMA, CrossFit, basketball): protein 2.0-2.4g/kg, carbs 4-6g/kg, saturated fat from red meat + eggs + ghee
- Endurance (cycling, triathlon, distance running): carbs 5-8g/kg, performance fuelling around sessions, electrolytes
- Mixed (football, tennis, cricket): balanced macros, pre-match carb loading, protein 1.8-2.2g/kg
- Match/competition day: accessible carbs 2-3hrs pre, intra if >75min, protein + carbs within 30min post

RECOVERY:
- Contact sports: cold water immersion 10-15min post-match, soft tissue work, elevated protein post-training
- Endurance: compression garments, active recovery (Zone 1-2 rides/jogs), structured deload weeks
- High-frequency sports: sleep 9+ hours, HRV monitoring, nervous system management

SUPPLEMENTS (include ONLY where indicated for the sport, never HPA adaptogens):
- Creatine monohydrate 5g/day: rugby, MMA, CrossFit, basketball — always
- Beta-alanine 3.2g/day: high-intensity interval sports (CrossFit, MMA, football, basketball)
- Caffeine 3-6mg/kg pre-training: all sports
- Electrolytes (sodium + potassium + magnesium): endurance and hot/humid conditions
- Vitamin D3 5000IU + K2 200mcg: all athletes year-round
- Omega-3 2-4g EPA/DHA: all athletes for inflammation management

KEY RISKS by sport (be specific):
- Rugby/contact: post-match inflammatory cascade suppresses T for 24-72hrs; repeated head contact raises cortisol chronically
- Distance running/cycling: high mileage elevates cortisol, suppresses T; RED-S risk if calorie deficit sustained
- MMA/Boxing: weight cuts cause significant hormonal disruption; dehydration elevates cortisol
- Football/basketball: in-season fixture density causes overtraining without managed recovery weeks
- CrossFit: overtraining common; repeated high-intensity sessions elevate cortisol without adequate recovery blocks
- Triathlon: RED-S risk, low T from chronic cortisol elevation; immune suppression in peak training
- Cricket: long seasons cause mental fatigue and disrupted circadian rhythms from travel

Write in British English. Be specific to the sport. Maximum 3 items per training/nutrition/recovery section, 2 for supplements and lifestyle.`

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'Unavailable' }, 500)

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { sport, level, season } = body
  if (!sport || !level || !season) return json({ error: 'Missing required fields' }, 400)

  const prompt = `Sport: ${sport}
Competition level: ${level}
Season phase: ${season}

Generate the sport-specific performance protocol.`

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
        max_tokens: 900,
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
