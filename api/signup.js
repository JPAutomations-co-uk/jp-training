export const config = { runtime: 'edge' }

// Server-side signup — creates user + profile atomically using service role key
export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const SUPA_URL = 'https://uzzcvrduoswjsrvuopgv.supabase.co'
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SERVICE_KEY) return json({ error: 'Server config error' }, 500)

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400 }) }

  const { name, email, password } = body
  if (!name || !email || !password) return json({ error: 'Missing fields' }, 400)
  if (password.length < 8) return json({ error: 'Password must be 8+ characters' }, 400)

  // 1. Create auth user via admin API (bypasses email confirmation)
  const createRes = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    }),
  })

  const createData = await createRes.json()
  if (!createRes.ok) {
    return json({ error: createData.message || createData.msg || 'Signup failed' }, 400)
  }

  const userId = createData.id

  // 2. Create profile row using service role (bypasses RLS)
  await fetch(`${SUPA_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: userId,
      display_name: name,
      status: 'pending',
      onboarding_completed: false,
    }),
  })

  // 3. Sign the user in to get a session token for the client
  const signinRes = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  const sessionData = await signinRes.json()

  return json({
    ok: true,
    userId,
    accessToken: sessionData.access_token || null,
    refreshToken: sessionData.refresh_token || null,
  })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
}
