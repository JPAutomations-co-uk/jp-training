export const config = { runtime: 'edge' }

const SYSTEM_PROMPT = `You are JP's AI performance coach inside the JP Training app.

You help men aged 14–55 optimise their training, nutrition, sleep, hormones, and recovery using evidence-based protocols.

Rules:
- Answers are direct, specific, and actionable. No filler, no hype.
- British English. Conversational but expert — like a knowledgeable coach, not a textbook.
- If they ask about something outside your scope (medical diagnosis, prescriptions), say so clearly and refer them to their GP.
- Maximum 3–4 short paragraphs per response. If they need more detail, they'll ask.
- Never make up specific values (blood ranges, dosages) you aren't confident in.`

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Coach unavailable' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }

  let body
  try { body = await req.json() } catch {
    return new Response('Bad request', { status: 400 })
  }

  const { messages = [], userProfile = {}, userContext = null } = body

  let systemWithProfile = SYSTEM_PROMPT
  if (userProfile?.display_name) systemWithProfile += `\n\nClient name: ${userProfile.display_name}`
  if (userContext) systemWithProfile += `\n\nClient profile: ${userContext}`

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
        max_tokens: 600,
        system: systemWithProfile,
        messages,
      }),
    })

    const data = await res.json()
    const reply = data.content?.[0]?.text ?? 'Something went wrong — try again.'

    return new Response(JSON.stringify({ reply }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Coach unavailable' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
}
