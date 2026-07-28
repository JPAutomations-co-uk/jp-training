export const config = { runtime: 'edge' }

// One-time setup — creates progress_checkins table
// Visit: /api/setup?secret=<SETUP_SECRET env var>
//
// SECURITY: this secret used to be hardcoded ('jpt-setup-2026')
// and committed to git history. Moved to an env var with no
// hardcoded fallback. Set via: vercel env add SETUP_SECRET
export default async function handler(req) {
  const secret = new URL(req.url).searchParams.get('secret')
  const SETUP_SECRET = process.env.SETUP_SECRET
  if (!SETUP_SECRET) {
    return new Response('Server not configured — SETUP_SECRET env var missing', { status: 500 })
  }
  if (!secret || secret !== SETUP_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const SUPA_URL = 'https://uzzcvrduoswjsrvuopgv.supabase.co'
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!SERVICE_KEY) {
    return new Response('Missing SUPABASE_SERVICE_ROLE_KEY', { status: 500 })
  }

  // Create table using Supabase's undocumented SQL endpoint available via service role
  const queries = [
    `CREATE TABLE IF NOT EXISTS progress_checkins (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
      date date NOT NULL DEFAULT CURRENT_DATE,
      energy integer CHECK (energy BETWEEN 1 AND 10),
      sleep_q integer CHECK (sleep_q BETWEEN 1 AND 10),
      mood integer CHECK (mood BETWEEN 1 AND 10),
      libido integer CHECK (libido BETWEEN 1 AND 10),
      adherence integer CHECK (adherence BETWEEN 1 AND 10),
      notes text,
      created_at timestamptz DEFAULT now() NOT NULL,
      UNIQUE(user_id, date)
    )`,
    `ALTER TABLE progress_checkins ENABLE ROW LEVEL SECURITY`,
    `DO $do$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='progress_checkins' AND policyname='Users manage own checkins') THEN
         CREATE POLICY "Users manage own checkins" ON progress_checkins FOR ALL USING (auth.uid() = user_id);
       END IF;
     END $do$`,
  ]

  const results = []

  for (const query of queries) {
    // Use Supabase REST + service role to call a stored procedure
    // Fallback: try the pg-meta SQL endpoint
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/exec_raw`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: query }),
    })

    const text = await res.text()
    results.push({ query: query.slice(0, 60), status: res.status, response: text.slice(0, 200) })
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  })
}
