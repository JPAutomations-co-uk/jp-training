export const config = { runtime: 'edge' }

const SYSTEM = `You are a male hormone physiology expert. Estimate hormonal status from questionnaire + app data. Return ONLY valid JSON.

Schema (all fields required):
{"estimates":{"total_t":{"value":<nmol/L number or null>,"unit":"nmol/L","status":"suppressed|sub-optimal|optimal|elevated","confidence":<40-85>},"free_t":{"value":null,"unit":"","status":"suppressed|sub-optimal|optimal|elevated","confidence":<35-75>},"cortisol":{"value":null,"unit":"","status":"low|optimal|elevated","confidence":<40-80>},"estradiol":{"value":null,"unit":"","status":"low|optimal|elevated","confidence":<35-70>},"dht":{"value":null,"unit":"","status":"suppressed|sub-optimal|optimal|elevated","confidence":<30-65>},"thyroid":{"value":null,"unit":"","status":"sluggish|optimal|overactive","confidence":<30-60>}},"summary":"<2 sentences, personal, references app data, British English>","root_causes":["<cause 1>","<cause 2>","<cause 3>"],"protocol":{"immediate":["<action 1>","<action 2>"],"nutrition":["<change 1>","<change 2>"],"training":["<adjustment>"],"sleep":["<action>"],"supplements":["<supplement with dose>"],"testing":["<lab panel>"]}}

ESTIMATION RULES:
Total T baseline (nmol/L): 18-20yo=22 (this is peak — natural T peaks age 17-20 and stays high for years, don't estimate below this baseline for an 18-20yo regardless of other inputs), 30yo=20, 40yo=17, 50yo=14. Adjust:
-Deduct: BF>20%(-3), sleep<6hrs(-2), stress>7(-2), seed oils(-1), no red meat/eggs(-2), heavy alcohol(-2), morning erections rare(-1).
-Add: BF<15%(+2), sleep 7-9hrs(+2), low stress(+1), red meat daily(+2), 6+eggs/day(+1), ghee/butter(+1), 4+training days(+1).
-ADEQUACY CEILING — apply before totalling: red meat/egg/ghee-butter additions above assume the person is currently deficient in dietary cholesterol/fat. If app data shows they ALREADY eat red meat daily AND 6+ eggs AND ghee/butter, do NOT stack all three +1/+2 additions — substrate/cholesterol availability is enzyme-rate-limited past adequacy (Leydig cell steroidogenesis doesn't scale with more dietary cholesterol once sufficient), so someone already eating this way has already captured this benefit; cap the combined food-substrate addition at +2 total once adequacy is clearly already met, not +4.
-App food score: avg 8-10(+1), avg 4-6(-1), <4(-2). Habit streak 7+days(+1).
Free T: follows total T but SHBG elevated by: high stress+alcohol+BF>20% → status one level lower than total T.
Cortisol elevated: afternoon crash+low morning energy+stress>6+sleep<7hrs. Low: all-day flatness, no stress response.
Estradiol elevated: BF>20%+alcohol+seed oils+plastics+belly/chest fat.
DHT elevated: hairline/temple recession. Suppressed: low drive despite adequate T.
Thyroid sluggish: fatigue unresponsive to sleep+brain fog+cold sensitivity+diffuse hair loss.

SUPPLEMENTS — evidence-based, not absolutist:
Ashwagandha/rhodiola/other adaptogens: weak evidence for raising T specifically in someone already hormonally adequate — the positive trials skew industry-funded and are run in infertile or 40+ populations, not eugonadal younger men. Don't recommend these as a T-raising lever for someone with no diagnosed deficiency. Don't invent a "dependency/cortisol rebound on cessation" claim either — that mechanism isn't established; the honest reason to skip these is weak evidence for this population, not a fabricated withdrawal risk.
Where indicated: D3 5000IU, K2 MK7 200mcg, Magnesium glycinate 400mg (sleep), Vitamin C 1000mg (elevated cortisol only).
Zinc: check dietary zinc from logged food FIRST (red meat + eggs + oysters/shellfish can already hit 40-60mg/day, at or above the adult 40mg UL) — only recommend a zinc supplement if dietary intake is genuinely low; stacking a supplement on an already zinc-replete animal-first diet risks exceeding the upper limit, not fixing a deficiency.
Tongkat Ali LJ100 400mg, Shilajit 500mg: reasonable doses if indicated, but shilajit specifically needs to be from a purified, heavy-metal-tested source (raw/unpurified shilajit carries real contamination risk) — flag this sourcing point whenever recommending it.

NUTRITION: animal-first foundation (fatty red meat, 10+ eggs/day, butter/ghee/tallow, oysters, organ meats, sweet potatoes, white rice, fruit) — recommend this first. Oats/pasteurised dairy/chicken breast/whey/seed oils/soy are downrated, not banned: state the real reason if one comes up (phytic acid/insulin response for oats, lean/low-fat for chicken breast, processed/inferior amino profile for whey, oxidation-under-heat for seed oils, no significant T/estrogen effect at normal intake for soy — don't invent a stronger claim than that) rather than a blanket "never."
If app food logs show poor choices — name them. If good — identify gaps.
PROTOCOL: 2 items max per section. Reference app data by name. British English. Be direct.`

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json({ error: 'Unavailable' }, 500)

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { painPoints = [], answers = {}, appData = {} } = body

  const answerLines = Object.entries(answers)
    .map(([k, v]) => `${k.replace(/_/g,' ')}: ${v}`)
    .join('\n')

  const appLines = [
    appData.recentFoods    ? `Foods logged: ${appData.recentFoods}` : null,
    appData.avgFoodScore   ? `Avg food score: ${appData.avgFoodScore}/10` : null,
    appData.habitsToday    ? `Habits done today: ${appData.habitsToday}` : null,
    appData.habitsMissed   ? `Habits missed: ${appData.habitsMissed}` : null,
    appData.habitStreak    ? `Habit streak: ${appData.habitStreak} days` : null,
    appData.weeklyPlan     ? `Training plan: ${appData.weeklyPlan}` : null,
    appData.stepsToday     ? `Steps today: ${appData.stepsToday.toLocaleString?.() ?? appData.stepsToday}` : null,
    appData.stepsWeeklyAvg ? `7-day step avg: ${appData.stepsWeeklyAvg}` : null,
    appData.profile        ? `Profile: ${Object.entries(appData.profile).filter(([,v])=>v!=null).map(([k,v])=>`${k}=${v}`).join(', ')}` : null,
  ].filter(Boolean).join('\n')

  const prompt = `Symptoms: ${painPoints.join(', ')}

Answers:
${answerLines}

App data:
${appLines || 'none'}

Estimate hormonal status and return protocol JSON.`

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
        max_tokens: 1100,
        system: SYSTEM,
        // Prefill forces the model to continue the JSON directly — no preamble, guaranteed format
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' },
        ],
      }),
    })

    const apiData = await res.json()

    // Check for Anthropic API-level errors
    if (apiData.error) {
      return json({ error: 'API error', detail: apiData.error.message }, 500)
    }

    // Prepend the prefilled '{' since Anthropic strips it from the response
    const raw = '{' + (apiData.content?.[0]?.text ?? '{}')

    let result
    try {
      const clean = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
      result = JSON.parse(clean)
    } catch {
      // Log the raw output so we can debug in Vercel logs
      console.error('hormone-lab parse error. Raw output:', raw.slice(0, 500))
      return json({ error: 'Parse error', raw: raw.slice(0, 300) }, 500)
    }

    return json(result)
  } catch (err) {
    console.error('hormone-lab handler error:', String(err))
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
