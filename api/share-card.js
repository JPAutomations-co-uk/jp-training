export const config = { runtime: 'edge' }

import { ImageResponse } from '@vercel/og'

// Mirrors app.html's :root CSS custom properties — Satori's isolated render
// tree can't see the page's actual stylesheet, so these are duplicated here
// by hand. If the app's theme colors change, update both places.
const COLOR = {
  black: '#050505',
  white: '#FFF',
  teal: '#2CD4C4',
  tealDim: 'rgba(44,212,196,.35)',
  muted: '#9A9A9A',
  dim: '#565656',
  border: '#232323',
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

// Real bug, found from an actual logged meal: JP's planned-meal strings
// (JP_NUTRITION_PLAN in app.html) use SEMICOLONS as the top-level
// separator between distinct ingredients, with commas only for a
// sub-detail within one ingredient — e.g. "4 whole eggs (~220g), fried
// in 8g beef dripping/tallow; 150g potato in 4g ghee; 1 banana" is 3
// ingredients (egg, potato, banana), not a comma-split mess. Splitting
// on comma alone (the free-text add-food convention) mangled this into
// 2 giant chunks. Fix: prefer semicolon-splitting when any semicolons
// are present, only fall back to comma-splitting for genuine free-text
// logs that never had semicolons at all (e.g. "chicken breast, rice,
// broccoli").
function parseIngredients(foodName) {
  const raw = String(foodName || '').trim()
  const bySemicolon = raw.split(';').map(s => s.trim()).filter(Boolean)
  const parts = bySemicolon.length > 1 ? bySemicolon : raw.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length <= 1) return { lines: [raw], more: 0 }
  return { lines: parts.slice(0, 9), more: Math.max(0, parts.length - 9) }
}

// Fallback for meals logged before the tagline field existed, or logged
// without a successful AI rating. Per JP's explicit direction: no
// mention of "AI" or "the plan" — just a brief, brutal line about the
// food itself, same register a real tagline should hit.
const FALLBACK_TAGLINE = 'Logged. Whether that was a good idea is between you and your macros.'

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors() })

  let body
  try { body = await req.json() } catch { return new Response('Bad request', { status: 400, headers: cors() }) }

  const { score = null, tagline = null, foodName = '', calories = 0, protein = 0, carbs = 0, fat = 0 } = body
  const { lines: ingredientLines, more } = parseIngredients(foodName)
  const badgeColor = scoreColor(score)
  const displayTagline = tagline || FALLBACK_TAGLINE

  const [barlowBold, barlowBlack, poppinsRegular, poppinsSemiBold] = await Promise.all([
    fontBarlowBold, fontBarlowBlack, fontPoppinsRegular, fontPoppinsSemiBold,
  ])

  const tree = h('div', {
    width: 1080, height: 1080, display: 'flex', flexDirection: 'column',
    backgroundImage: `linear-gradient(155deg, #0a0a0a 0%, ${COLOR.black} 55%, #071613 100%)`,
    padding: 70, fontFamily: 'Poppins', position: 'relative',
  }, [
    // Hairline frame — thin inset border for a card/certificate feel
    // rather than content floating loose on a flat background.
    h('div', { position: 'absolute', top: 24, left: 24, right: 24, bottom: 24, border: `1px solid ${COLOR.border}` }, null),

    // Header — small, refined logotype (doubles as the branding
    // watermark) opposite a compact score seal, not a giant numeral
    // dominating the card the way the first version did.
    h('div', { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, [
      h('div', { display: 'flex', flexDirection: 'row', alignItems: 'baseline' }, [
        h('span', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontSize: 26, color: COLOR.white, textTransform: 'uppercase', letterSpacing: 2 }, 'JP '),
        h('span', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontSize: 26, color: COLOR.teal, textTransform: 'uppercase', letterSpacing: 2 }, 'Training'),
      ]),
      h('div', {
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        width: 92, height: 92, borderRadius: 46, border: `2px solid ${badgeColor}`,
      }, score != null ? [
        h('span', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontSize: 38, color: badgeColor, lineHeight: 1 }, String(score)),
        h('span', { fontFamily: 'Poppins', fontWeight: 600, fontSize: 12, color: COLOR.dim, marginTop: 2 }, 'OUT OF 10'),
      ] : [
        h('span', { fontFamily: 'Barlow Condensed', fontWeight: 800, fontSize: 20, color: COLOR.dim }, 'N/A'),
      ]),
    ]),

    // Tagline — the hero of the card. Small tracked kicker above it,
    // then the actual line, large and confident.
    h('div', { display: 'flex', flexDirection: 'column', marginTop: 54 }, [
      h('span', { fontFamily: 'Poppins', fontWeight: 600, fontSize: 13, color: COLOR.teal, textTransform: 'uppercase', letterSpacing: 3 }, 'THE VERDICT'),
      h('div', {
        display: 'flex', fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 47,
        color: COLOR.white, marginTop: 14, lineHeight: 1.22,
        maxHeight: 235, overflow: 'hidden',
      }, displayTagline),
    ]),

    // Macro row
    h('div', {
      display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
      marginTop: 44, paddingTop: 28, paddingBottom: 28,
      borderTop: `1px solid ${COLOR.border}`, borderBottom: `1px solid ${COLOR.border}`,
    }, [
      ['CAL', Math.round(calories)],
      ['PROTEIN', `${Math.round(protein)}g`],
      ['CARBS', `${Math.round(carbs)}g`],
      ['FAT', `${Math.round(fat)}g`],
    ].map(([label, value], i) => h('div', {
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingLeft: 18, paddingRight: 18,
      borderLeft: i > 0 ? `1px solid ${COLOR.border}` : 'none',
    }, [
      h('span', { fontFamily: 'Barlow Condensed', fontWeight: 800, fontSize: 34, color: COLOR.white }, String(value)),
      h('span', { fontFamily: 'Poppins', fontWeight: 600, fontSize: 13, color: COLOR.dim, letterSpacing: 2, marginTop: 6 }, label),
    ]))),

    // Ingredients — listed individually, numbered rather than bulleted,
    // for a more editorial feel than a plain dot list.
    h('div', { display: 'flex', flexDirection: 'column', marginTop: 36 }, [
      h('span', { fontFamily: 'Poppins', fontWeight: 600, fontSize: 13, color: COLOR.teal, textTransform: 'uppercase', letterSpacing: 3, marginBottom: 16 }, 'INGREDIENTS'),
      ...ingredientLines.map((line, i) => h('div', {
        display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 13,
      }, [
        h('span', { fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 20, color: COLOR.tealDim, width: 34, flexShrink: 0 }, String(i + 1).padStart(2, '0')),
        h('span', { fontFamily: 'Poppins', fontWeight: 400, fontSize: 24, color: COLOR.muted }, line),
      ])),
      more > 0 ? h('span', { fontFamily: 'Poppins', fontWeight: 400, fontSize: 20, color: COLOR.dim, marginLeft: 34 }, `+${more} more`) : null,
    ].filter(Boolean)),

    // Footer
    h('div', {
      display: 'flex', flexDirection: 'row', justifyContent: 'space-between',
      fontFamily: 'Poppins', fontWeight: 400, fontSize: 16,
      color: COLOR.dim, marginTop: 'auto', paddingTop: 20, borderTop: `1px solid ${COLOR.border}`,
    }, [
      h('span', { fontFamily: 'Poppins' }, 'jptraining.fit'),
      h('span', { fontFamily: 'Poppins' }, 'Logged with JP Training'),
    ]),
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
