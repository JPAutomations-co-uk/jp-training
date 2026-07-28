export const config = { runtime: 'edge' }

// Admin endpoint — approve a user by email
// Usage: POST /api/admin?secret=<ADMIN_SECRET env var>
// Body: { "email": "user@example.com" }  → approves that user
// Body: { "self": true }  → approves the currently authenticated user (requires Bearer token)
// Body: { "wipe": true, "confirm": "WIPE ALL USERS" }  → deletes every auth user (testing resets only)
//
// SECURITY: the secret used to live hardcoded in this file
// ('jpt-admin-2026') and was committed to git history — anyone
// who found it could hit `wipe: true` and delete every real user
// account (there is at least one real user, Fraser, with live
// data). Moved to an env var with no hardcoded fallback, and the
// wipe path now needs a second, exact confirmation string on top
// of the secret so a stray/guessed request can't trigger it by
// accident. Set the secret via: vercel env add ADMIN_SECRET
const SUPA_URL = 'https://uzzcvrduoswjsrvuopgv.supabase.co'

export default async function handler(req) {
  const url = new URL(req.url)
  const secret = url.searchParams.get('secret')
  const ADMIN_SECRET = process.env.ADMIN_SECRET
  if (!ADMIN_SECRET) return json({ error: 'Server not configured — ADMIN_SECRET env var missing' }, 500)
  if (!secret || secret !== ADMIN_SECRET) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SERVICE_KEY) return json({ error: 'Missing service key' }, 500)

  let body = {}
  try { body = await req.json() } catch {}

  // Wipe all users (for testing resets). Requires the secret AND this exact
  // confirmation string in the body — a leaked/guessed secret alone is no
  // longer enough to trigger this.
  if (body.wipe) {
    if (body.confirm !== 'WIPE ALL USERS') {
      return json({ error: 'Add "confirm": "WIPE ALL USERS" to the request body to actually wipe.' }, 400)
    }
    const listRes = await fetch(`${SUPA_URL}/auth/v1/admin/users?per_page=1000`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    })
    const { users = [] } = await listRes.json()
    const deleted = []
    for (const u of users) {
      await fetch(`${SUPA_URL}/auth/v1/admin/users/${u.id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
      })
      deleted.push(u.email)
    }
    return json({ ok: true, deleted })
  }

  let userId = null

  if (body.self) {
    // Validate the JWT from Authorization header to get caller's user_id
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    if (!token) return json({ error: 'No auth token provided' }, 400 )

    const userRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` }
    })
    if (!userRes.ok) return json({ error: 'Invalid token' }, 401)
    const user = await userRes.json()
    userId = user.id
  } else if (body.email) {
    // Look up user by email using admin API
    const listRes = await fetch(`${SUPA_URL}/auth/v1/admin/users?email=${encodeURIComponent(body.email)}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    })
    const list = await listRes.json()
    const found = list.users?.find(u => u.email === body.email)
    if (!found) return json({ error: `No user found with email ${body.email}` }, 404)
    userId = found.id
  } else if (body.userId) {
    userId = body.userId
  } else {
    return json({ error: 'Provide email, userId, or self:true' }, 400)
  }

  // Upsert profile with approved status
  const upsertRes = await fetch(`${SUPA_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ id: userId, status: 'approved' }),
  })

  if (!upsertRes.ok) {
    const err = await upsertRes.text()
    return json({ error: err }, 500)
  }

  return json({ ok: true, userId, status: 'approved' })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
}
