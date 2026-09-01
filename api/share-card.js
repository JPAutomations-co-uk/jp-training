export const config = { runtime: 'edge' }

import { ImageResponse } from '@vercel/og'

// Mirrors app.html's :root CSS custom properties — Satori's isolated render
// tree can't see the page's actual stylesheet, so these are duplicated here
// by hand. If the app's theme colors change, update both places.
const COLOR = {
  black: '#000',
  white: '#FFF',
  teal: '#2CD4C4',
  muted: '#888',
  dim: '#444',
  border: '#1A1A1A',
  red: '#f87171',
}

// Loaded once at module scope so a warm invocation reuses the resolved
// ArrayBuffers instead of re-fetching on every request.
const fontBarlowBold = fetch(new URL('../assets/fonts/BarlowCondensed-Bold.ttf', import.meta.url)).then(r => r.arrayBuffer())
const fontBarlowBlack = fetch(new URL('../assets/fonts/BarlowCondensed-Black.ttf', import.meta.url)).then(r => r.arrayBuffer())
const fontPoppinsRegular = fetch(new URL('../assets/fonts/Poppins-Regular.ttf', import.meta.url)).then(r => r.arrayBuffer())
const fontPoppinsSemiBold = fetch(new URL('../assets/fonts/Poppins-SemiBold.ttf', import.meta.url)).then(r => r.arrayBuffer())

// Plain object-literal element tree — this file has no JSX transform
// (same as every other file in api/), so Satori's React-shaped VDOM is
// built by hand instead. `h` just saves repeating {type,props} everywhere.
function h(type, style, children) {
  return { type, props: { style, children } }
}

function scoreColor(score) {
  if (score == null) return COLOR.dim
  if (score >= 8) return COLOR.teal
  if (score >= 5) return COLOR.white
  return COLOR.red
}

// App's own convention is comma-separated ("200g chicken breast, rice,
// broccoli") — confirmed via the add-food placeholder text and every
// existing foods.map().join(', ') call site, not semicolons.
function parseIngredients(foodName) {
  const parts = String(foodName || '').split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length <= 1) return { lines: [String(foodName || '').trim()], more: 0 }
  return { lines: parts.slice(0, 5), more: Math.max(0, parts.length - 5) }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors() })

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400, headers: cors() }) }

  const { score = null, headline = null, foodName = '', calories = 0, protein = 0, carbs = 0, fat = 0 } = body
  const { lines: ingredientLines, more } = parseIngredients(foodName)
  const badgeColor = scoreColor(score)
  const displayHeadline = headline || (ingredientLines[0] ? `${ingredientLines[0]} — logged` : 'Logged with JP Training')

  const [barlowBold, barlowBlack, poppinsRegular, poppinsSemiBold] = await Promise.all([
    fontBarlowBold, fontBarlowBlack, fontPoppinsRegular, fontPoppinsSemiBold,
  ])

  const tree = h('div', {
    width: 1080, height: 1080, display: 'flex', flexDirection: 'column',
    backgroundColor: COLOR.black, padding: 64, fontFamily: 'Poppins',
  }, [
    // Header — text logotype doubles as the branding watermark
    h('div', { display: 'flex', flexDirection: 'row', alignItems: 'center' }, [
      h('span', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontSize: 34, color: COLOR.white, textTransform: 'uppercase', letterSpacing: 1 }, 'JP '),
      h('span', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontSize: 34, color: COLOR.teal, textTransform: 'uppercase', letterSpacing: 1 }, 'Training'),
    ]),

    // Score badge
    h('div', { display: 'flex', flexDirection: 'row', alignItems: 'baseline', marginTop: 36 }, [
      h('span', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontSize: 180, color: badgeColor, lineHeight: 1 }, score != null ? String(score) : '—'),
      score != null ? h('span', { fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 48, color: COLOR.dim, marginLeft: 12 }, '/10') : null,
    ].filter(Boolean)),

    // Headline
    h('div', {
      display: 'flex', fontFamily: 'Barlow Condensed', fontWeight: 800, fontSize: 44,
      color: COLOR.white, textTransform: 'uppercase', marginTop: 24, lineHeight: 1.15,
      maxHeight: 112, overflow: 'hidden',
    }, displayHeadline),

    // Macro stats row
    h('div', {
      display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
      marginTop: 48, paddingTop: 32, paddingBottom: 32,
      borderTop: `1px solid ${COLOR.border}`, borderBottom: `1px solid ${COLOR.border}`,
    }, [
      ['CAL', Math.round(calories)],
      ['PROTEIN', `${Math.round(protein)}g`],
      ['CARBS', `${Math.round(carbs)}g`],
      ['FAT', `${Math.round(fat)}g`],
    ].map(([label, value], i, arr) => h('div', {
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingLeft: 20, paddingRight: 20,
      borderLeft: i > 0 ? `1px solid ${COLOR.border}` : 'none',
    }, [
      h('span', { fontFamily: 'Barlow Condensed', fontWeight: 800, fontSize: 40, color: COLOR.white }, String(value)),
      h('span', { fontFamily: 'Poppins', fontWeight: 600, fontSize: 16, color: COLOR.dim, letterSpacing: 2, marginTop: 6 }, label),
    ]))),

    // Ingredient list
    h('div', { display: 'flex', flexDirection: 'column', marginTop: 40, gap: 16 }, [
      ...ingredientLines.map(line => h('div', { display: 'flex', flexDirection: 'row', alignItems: 'center' }, [
        h('div', { width: 10, height: 10, backgroundColor: COLOR.teal, marginRight: 16, flexShrink: 0 }, null),
        h('span', { fontFamily: 'Poppins', fontWeight: 400, fontSize: 28, color: COLOR.white }, line),
      ])),
      more > 0 ? h('span', { fontFamily: 'Poppins', fontWeight: 400, fontSize: 24, color: COLOR.dim, marginLeft: 26 }, `+${more} more`) : null,
    ].filter(Boolean)),

    // Footer
    h('div', {
      display: 'flex', fontFamily: 'Poppins', fontWeight: 400, fontSize: 20,
      color: COLOR.dim, marginTop: 'auto', paddingTop: 24, borderTop: `1px solid ${COLOR.border}`,
    }, 'Logged with JP Training'),
  ])

  return new ImageResponse(tree, {
    width: 1080,
    height: 1080,
    fonts: [
      { name: 'Barlow Condensed', data: barlowBold, weight: 700, style: 'normal' },
      { name: 'Barlow Condensed', data: barlowBlack, weight: 900, style: 'normal' },
      { name: 'Poppins', data: poppinsRegular, weight: 400, style: 'normal' },
      { name: 'Poppins', data: poppinsSemiBold, weight: 600, style: 'normal' },
    ],
  })
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}
