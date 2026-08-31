// Deterministic Bloodwork scoring engine — same philosophy as
// hormone-scoring.js (lib/hormone-scoring.js): never let an LLM invent or
// silently reinterpret a number. A submitted value is either inside a
// reference range or it isn't, and that classification is pure arithmetic,
// computed here, not guessed by a model.
//
// Reference ranges are NOT hardcoded here. Different UK labs (Medichecks,
// NHS, others) report different reference ranges and sometimes different
// units for the same marker — hardcoding "standard" ranges risks silently
// flagging a value wrong against a range the user's actual test never used.
// Instead, the user submits their own lab's stated range alongside every
// value, and classification compares against THAT.
//
// Consumed two ways from this single source of truth:
//   - app.html imports it as a browser ES module for live classification
//     while the entry form is being filled in
//   - api/bloodwork-analysis.js imports it in the edge function for
//     authoritative scoring before any LLM narrative is generated

export const ENGINE_VERSION = 'v1';

export const BLOODWORK_PANELS = [
  { key: 'androgen', label: 'Androgen / Reproductive', markers: [
    { key: 'total_testosterone', name: 'Total Testosterone', unit: 'nmol/L' },
    { key: 'free_testosterone',  name: 'Free Testosterone',  unit: 'pmol/L' },
    { key: 'shbg',               name: 'SHBG',               unit: 'nmol/L' },
    { key: 'lh',                 name: 'LH',                 unit: 'IU/L' },
    { key: 'fsh',                name: 'FSH',                unit: 'IU/L' },
    { key: 'oestradiol',         name: 'Oestradiol (E2)',    unit: 'pmol/L' },
    { key: 'dhea_s',             name: 'DHEA-S',             unit: 'µmol/L' },
    { key: 'prolactin',          name: 'Prolactin',          unit: 'mIU/L' },
  ] },
  { key: 'thyroid', label: 'Thyroid', markers: [
    { key: 'tsh',            name: 'TSH',                        unit: 'mIU/L' },
    { key: 'free_t3',        name: 'Free T3',                    unit: 'pmol/L' },
    { key: 'free_t4',        name: 'Free T4',                    unit: 'pmol/L' },
    { key: 'reverse_t3',     name: 'Reverse T3',                 unit: 'ng/dL' },
    { key: 'tpo_antibodies', name: 'TPO Antibodies',             unit: 'IU/mL' },
    { key: 'tg_antibodies',  name: 'Thyroglobulin Antibodies',   unit: 'IU/mL' },
  ] },
  { key: 'adrenal', label: 'Adrenal / Stress', markers: [
    { key: 'cortisol_am', name: 'Cortisol (AM)', unit: 'nmol/L' },
  ] },
  { key: 'metabolic', label: 'Metabolic', markers: [
    { key: 'fasting_glucose', name: 'Fasting Glucose', unit: 'mmol/L' },
    { key: 'fasting_insulin', name: 'Fasting Insulin', unit: 'mIU/L' },
    { key: 'hba1c',           name: 'HbA1c',           unit: 'mmol/mol' },
  ] },
  { key: 'lipids', label: 'Lipids', markers: [
    { key: 'total_cholesterol',   name: 'Total Cholesterol',   unit: 'mmol/L' },
    { key: 'ldl',                 name: 'LDL Cholesterol',     unit: 'mmol/L' },
    { key: 'hdl',                 name: 'HDL Cholesterol',     unit: 'mmol/L' },
    { key: 'triglycerides',       name: 'Triglycerides',       unit: 'mmol/L' },
    { key: 'non_hdl_cholesterol', name: 'Non-HDL Cholesterol', unit: 'mmol/L' },
  ] },
  { key: 'iron_fbc', label: 'Iron & Full Blood Count', markers: [
    { key: 'ferritin',                name: 'Ferritin',                unit: 'µg/L' },
    { key: 'iron',                    name: 'Iron',                    unit: 'µmol/L' },
    { key: 'tibc',                    name: 'TIBC',                    unit: 'µmol/L' },
    { key: 'transferrin_saturation',  name: 'Transferrin Saturation',  unit: '%' },
    { key: 'haemoglobin',             name: 'Haemoglobin',             unit: 'g/L' },
    { key: 'haematocrit',             name: 'Haematocrit',             unit: 'L/L' },
    { key: 'mcv',                     name: 'MCV',                     unit: 'fL' },
    { key: 'wbc',                     name: 'White Blood Cells',       unit: 'x10^9/L' },
    { key: 'platelets',               name: 'Platelets',               unit: 'x10^9/L' },
  ] },
  { key: 'liver', label: 'Liver Function', markers: [
    { key: 'alt',       name: 'ALT',       unit: 'U/L' },
    { key: 'ast',       name: 'AST',       unit: 'U/L' },
    { key: 'ggt',       name: 'GGT',       unit: 'U/L' },
    { key: 'alp',       name: 'ALP',       unit: 'U/L' },
    { key: 'bilirubin', name: 'Bilirubin', unit: 'µmol/L' },
    { key: 'albumin',   name: 'Albumin',   unit: 'g/L' },
  ] },
  { key: 'kidney', label: 'Kidney Function', markers: [
    { key: 'creatinine', name: 'Creatinine', unit: 'µmol/L' },
    { key: 'egfr',       name: 'eGFR',       unit: 'mL/min/1.73m²' },
    { key: 'urea',       name: 'Urea',       unit: 'mmol/L' },
  ] },
  { key: 'vitamins', label: 'Vitamins & Minerals', markers: [
    { key: 'vitamin_d',   name: 'Vitamin D (25-OH)', unit: 'nmol/L' },
    { key: 'vitamin_b12', name: 'Vitamin B12',       unit: 'pmol/L' },
    { key: 'folate',      name: 'Folate',            unit: 'µg/L' },
    { key: 'zinc',        name: 'Zinc',              unit: 'µmol/L' },
    { key: 'magnesium',   name: 'Magnesium',         unit: 'mmol/L' },
    { key: 'selenium',    name: 'Selenium',          unit: 'µmol/L' },
    { key: 'copper',      name: 'Copper',            unit: 'µmol/L' },
  ] },
  { key: 'inflammatory', label: 'Inflammatory', markers: [
    { key: 'crp',           name: 'CRP (hs-CRP)',  unit: 'mg/L' },
    { key: 'homocysteine',  name: 'Homocysteine',  unit: 'µmol/L' },
  ] },
  { key: 'growth', label: 'Growth & Other', markers: [
    { key: 'igf_1', name: 'IGF-1', unit: 'nmol/L' },
  ] },
];

export const MARKER_NAMES = Object.fromEntries(
  BLOODWORK_PANELS.flatMap(p => p.markers.map(m => [m.key, m.name]))
);

/**
 * Classifies a single value against its own submitted reference range.
 * "critical" = more than half the range's width past the relevant edge —
 * an arbitrary but disclosed threshold, not a clinical cutoff, used only
 * to decide which findings get escalated to the clinical-review list
 * below rather than the general lifestyle-guidance list.
 * Returns null for incomplete entries (nothing to classify) rather than
 * guessing — an unscored marker is more honest than a wrongly-scored one.
 */
export function classifyMarker(value, refLow, refHigh) {
  const v = Number(value), lo = Number(refLow), hi = Number(refHigh);
  if (value === '' || value == null || refLow == null || refHigh == null) return null;
  if (!Number.isFinite(v) || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const range = hi - lo;
  if (v < lo) return (lo - v) > range * 0.5 ? 'critical_low' : 'low';
  if (v > hi) return (v - hi) > range * 0.5 ? 'critical_high' : 'high';
  return 'in_range';
}

/**
 * Scores a full submitted panel. `markers` is { [key]: {value, unit, refLow, refHigh} }.
 * Returns:
 *   - flags: per-marker classification, always computed the same deterministic way
 *   - clinicalReview: named patterns (or any single critical marker) that the
 *     established literature treats as a differential-diagnosis trigger rather
 *     than a lifestyle-modifiable finding — these are surfaced separately so
 *     the narrative layer knows explicitly which findings to flag as "outside
 *     what diet/training can fix" instead of folding them into generic advice.
 * This list of named cross-marker patterns is NOT exhaustive — it covers the
 * patterns already well-established in this project's own research (androgen
 * axis LH/FSH interpretation, autoimmune thyroid, iron overload) as a
 * starting point, not a claim to catch every possible clinically-significant
 * combination that exists.
 */
export function scoreBloodwork(markers) {
  const flags = [];
  for (const [key, m] of Object.entries(markers || {})) {
    const status = classifyMarker(m?.value, m?.refLow, m?.refHigh);
    if (!status) continue;
    flags.push({ marker: key, status, value: m.value, unit: m.unit, refLow: m.refLow, refHigh: m.refHigh });
  }

  const byKey = Object.fromEntries(flags.map(f => [f.marker, f]));
  const clinicalReview = [];

  flags.forEach(f => {
    if (f.status === 'critical_low' || f.status === 'critical_high') {
      clinicalReview.push({
        pattern: 'critical_marker',
        markers: [f.marker],
        reason: `${MARKER_NAMES[f.marker] || f.marker} is more than halfway past its reference range (${f.status.replace('_', ' ')}) — outside what a diet or training adjustment can be expected to fix on its own.`,
      });
    }
  });

  const t = byKey.total_testosterone, lh = byKey.lh, fsh = byKey.fsh;
  if (t && (t.status === 'low' || t.status === 'critical_low') && lh && fsh) {
    if ((lh.status === 'low' || lh.status === 'in_range') && (fsh.status === 'low' || fsh.status === 'in_range')) {
      clinicalReview.push({
        pattern: 'possible_secondary_hypogonadism',
        markers: ['total_testosterone', 'lh', 'fsh'],
        reason: 'Low testosterone with LH/FSH not elevated to compensate suggests the signal may be coming from the pituitary/hypothalamus rather than the testes — this needs clinical investigation, not a diet change.',
      });
    } else if (lh.status === 'high' || fsh.status === 'high') {
      clinicalReview.push({
        pattern: 'possible_primary_hypogonadism',
        markers: ['total_testosterone', 'lh', 'fsh'],
        reason: 'Low testosterone with elevated LH/FSH suggests the testes aren\'t responding to the pituitary\'s signal — this needs clinical investigation, not a diet change.',
      });
    }
  }

  const tpo = byKey.tpo_antibodies, tg = byKey.tg_antibodies, tsh = byKey.tsh;
  if (tsh && tsh.status !== 'in_range' && ((tpo && tpo.status !== 'in_range') || (tg && tg.status !== 'in_range'))) {
    clinicalReview.push({
      pattern: 'possible_autoimmune_thyroid',
      markers: ['tsh', 'tpo_antibodies', 'tg_antibodies'].filter(k => byKey[k]),
      reason: 'Abnormal TSH alongside positive thyroid antibodies points toward autoimmune thyroid involvement, which needs clinical management, not a food swap.',
    });
  }

  if (byKey.ferritin && (byKey.ferritin.status === 'high' || byKey.ferritin.status === 'critical_high')) {
    clinicalReview.push({
      pattern: 'elevated_ferritin',
      markers: ['ferritin'],
      reason: 'Elevated ferritin can reflect real iron overload risk or an inflammatory response — either way it needs a doctor\'s interpretation alongside iron/TIBC/transferrin saturation, not just a dietary reduction.',
    });
  }

  return { engineVersion: ENGINE_VERSION, flags, clinicalReview };
}
