// Deterministic Hormone Lab scoring engine.
//
// Replaces the old approach (hand raw answers to an LLM with a prose
// "formula" and let it invent nmol/L values + confidence percentages) with
// real, testable arithmetic. A symptom questionnaire can never measure a
// hormone level, so this does not try to — it classifies the LIKELIHOOD of
// distinct hormonal-imbalance PATTERNS from weighted, evidence-linked
// symptom clustering, adapted from validated/quasi-validated screening
// frameworks (ADAM/qADAM-style androgen screening, HPA-axis staging,
// thyroid symptom clustering, metabolic/insulin-resistance flagging).
//
// Consumed two ways from this single source of truth:
//   - app.html imports it as a browser ES module for live scoring
//   - api/hormone-lab.js imports it in the edge function for authoritative
//     scoring (the LLM is only used afterwards, to narrate these numbers —
//     it never gets to invent them)

export const ENGINE_VERSION = 'v1';

const TIERS = { LIKELY: 'likely', POSSIBLE: 'possible', UNLIKELY: 'unlikely', NOT_APPLICABLE: 'not_applicable' };

function tierFromScore(score, likelyAt, possibleAt) {
  if (score >= likelyAt) return TIERS.LIKELY;
  if (score >= possibleAt) return TIERS.POSSIBLE;
  return TIERS.UNLIKELY;
}

function sortByWeight(evidence) {
  return evidence.slice().sort((a, b) => b.weight - a.weight);
}

/**
 * Androgen axis (testosterone) — ADAM/qADAM-adapted weighted checklist.
 * Cardinal items (morning erections, libido) carry the most weight, as in
 * the original ADAM instrument; supporting items add smaller increments.
 * Gates on TRT status — scoring "natural" androgen status for someone on
 * exogenous testosterone is meaningless.
 */
export function scoreAndrogenPattern({ answers = {}, profile = {} } = {}) {
  if (profile.onTRT) {
    return {
      pattern: 'androgen_axis',
      tier: TIERS.NOT_APPLICABLE,
      score: null,
      evidence: [],
      note: 'On exogenous testosterone — natural androgen axis likelihood is not meaningful here. Focus shifts to TRT management markers (oestradiol, haematocrit, PSA) rather than a deficiency likelihood.',
    };
  }

  const evidence = [];
  let score = 0;
  const add = (q, weight, note) => { if (weight > 0) { evidence.push({ q, weight, note }); score += weight; } };

  const erectionWeights = {
    'Daily / almost daily': 0, '4–6 days/week': 5, '2–3 days/week': 15,
    'Rarely — 0–1/week': 28, 'Never': 35,
  };
  if (answers.morning_erections in erectionWeights) {
    add('morning_erections', erectionWeights[answers.morning_erections], `Morning erections: ${answers.morning_erections}`);
  }

  if (typeof answers.libido_score === 'number') {
    const w = Math.max(0, 6 - answers.libido_score) * 4;
    add('libido_score', w, `Libido rated ${answers.libido_score}/10`);
  }

  if (typeof answers.morning_energy === 'number' && answers.morning_energy <= 4) {
    add('morning_energy', 6, `Low morning energy (${answers.morning_energy}/10)`);
  }
  if (typeof answers.drive_motivation === 'number' && answers.drive_motivation <= 4) {
    add('drive_motivation', 6, `Low drive/motivation (${answers.drive_motivation}/10)`);
  }
  if (answers.strength_trend === 'Declining — getting weaker') {
    add('strength_trend', 8, 'Strength declining over the last 3 months');
  }
  if (typeof answers.recovery_between === 'number' && answers.recovery_between <= 4) {
    add('recovery_between', 5, `Poor recovery between sessions (${answers.recovery_between}/10)`);
  }
  if (answers.mood === 'Flat / emotionally blunted') {
    add('mood', 6, 'Mood flat / emotionally blunted');
  }
  if (typeof answers.body_fat === 'number' && answers.body_fat > 25) {
    add('body_fat', 5, `Body fat ${answers.body_fat}% — adiposity increases aromatisation of testosterone to oestradiol`);
  }
  if (answers.alcohol === 'Heavily — 8+ units/week') {
    add('alcohol', 4, 'Heavy weekly alcohol intake — directly suppresses Leydig cell testosterone output');
  }
  if (typeof answers.stress_level === 'number' && answers.stress_level >= 8) {
    add('stress_level', 4, `High stress (${answers.stress_level}/10) — cortisol antagonises testosterone via several mechanisms`);
  }
  if (typeof answers.sleep_hrs === 'number' && answers.sleep_hrs < 6) {
    add('sleep_hrs', 4, `Averaging ${answers.sleep_hrs}hrs sleep — insufficient sleep measurably lowers testosterone`);
  }

  score = Math.min(100, score);
  return { pattern: 'androgen_axis', tier: tierFromScore(score, 55, 28), score, evidence: sortByWeight(evidence) };
}

/**
 * HPA-axis / cortisol dysregulation — staged model (Stage 1 hyperactivation
 * / Stage 2 dysregulation / Stage 3 blunting-burnout) matching JP's own
 * cortisol/HPA knowledge base. Reports the dominant stage plus an overall
 * likelihood tier, rather than a single flat score.
 */
export function scoreHPAPattern({ answers = {} } = {}) {
  const evidence = [];
  let s1 = 0, s2 = 0, s3 = 0;
  const add = (stage, q, weight, note) => {
    if (weight <= 0) return;
    evidence.push({ q, stage, weight, note });
    if (stage === 1) s1 += weight; else if (stage === 2) s2 += weight; else s3 += weight;
  };

  // Stage 1 — hyperactivation: wired-and-tired, can't wind down
  if (typeof answers.stress_level === 'number' && answers.stress_level >= 8) {
    add(1, 'stress_level', 10, `Very high stress (${answers.stress_level}/10)`);
  }
  if (answers.sleep_onset === 'Over an hour' || answers.sleep_onset === '30–60 minutes') {
    add(1, 'sleep_onset', 8, `Slow sleep onset (${answers.sleep_onset}) — racing mind at night`);
  }

  // Stage 2 — dysregulation: afternoon crash, caffeine dependence, 2-4am waking
  if (answers.afternoon_crash === 'Yes — every day without fail' || answers.afternoon_crash === 'Yes — often') {
    add(2, 'afternoon_crash', 12, `Reliable afternoon crash (${answers.afternoon_crash})`);
  }
  if (answers.caffeine_dep === 'Yes — essential just to feel normal') {
    add(2, 'caffeine_dep', 8, 'Caffeine essential just to feel normal');
  }
  const specificNightWaking = answers.wake_night === 'Often wake between 3–4am specifically'
    || (answers.wake_night === 'Three or more times' && answers.wake_night_specific === 'Yes — same time, 2–4am');
  if (specificNightWaking) {
    add(2, 'wake_night', 14, 'Classic 2-4am HPA-pattern night waking');
  }
  if (typeof answers.cognitive_score === 'number' && answers.cognitive_score <= 5) {
    add(2, 'cognitive_score', 6, `Brain fog emerging (mental sharpness ${answers.cognitive_score}/10)`);
  }

  // Stage 3 — blunting/burnout: flat, exhausted on waking, emotionally blunted
  if (typeof answers.morning_energy === 'number' && answers.morning_energy <= 3) {
    add(3, 'morning_energy', 12, `Extreme fatigue on waking (${answers.morning_energy}/10)`);
  }
  if (answers.mood === 'Flat / emotionally blunted') {
    add(3, 'mood', 12, 'Emotional blunting');
  }
  if (answers.rested === 'No — exhausted straight away') {
    add(3, 'rested', 10, 'Waking exhausted regardless of sleep duration');
  }

  const total = Math.min(100, s1 + s2 + s3);
  let stage = null;
  if (total > 0) stage = (s3 >= s2 && s3 >= s1) ? 3 : (s2 >= s1) ? 2 : 1;

  return {
    pattern: 'hpa_dysregulation',
    tier: tierFromScore(total, 40, 18),
    score: total,
    stage,
    evidence: sortByWeight(evidence.filter(e => e.stage === stage)),
  };
}

/**
 * Thyroid — symptom clustering matching the rT3-dominance presentation
 * (normal TSH/fT4, low-third fT3): fatigue, brain fog, cold sensitivity,
 * weight gain despite diet, diffuse (not patterned) hair loss.
 */
export function scoreThyroidPattern({ answers = {} } = {}) {
  const evidence = [];
  let score = 0;
  const add = (q, weight, note) => { if (weight > 0) { evidence.push({ q, weight, note }); score += weight; } };

  const coldWeights = { 'Always cold, others are fine': 10, 'Colder than most': 6 };
  if (answers.cold_sensitivity in coldWeights) {
    add('cold_sensitivity', coldWeights[answers.cold_sensitivity], `Cold tolerance: ${answers.cold_sensitivity}`);
  }
  if (typeof answers.morning_energy === 'number' && answers.morning_energy <= 4) {
    add('morning_energy', 6, `Low morning energy (${answers.morning_energy}/10)`);
  }
  if (typeof answers.cognitive_score === 'number' && answers.cognitive_score <= 5) {
    add('cognitive_score', 6, `Brain fog (mental sharpness ${answers.cognitive_score}/10)`);
  }
  if (answers.word_retrieval === 'Often — this is very noticeable') {
    add('word_retrieval', 5, 'Frequent word/name recall difficulty');
  }
  if (answers.weight_trend === 'Gaining despite eating reasonably well' || answers.weight_trend === 'Stuck — cannot shift it') {
    add('weight_trend', 6, `Weight ${answers.weight_trend.toLowerCase()} despite diet effort`);
  }
  if (answers.hair_pattern === 'Diffuse — spread across the whole head') {
    add('hair_pattern', 8, 'Diffuse hair thinning — pattern more typical of thyroid than androgenic (DHT) hair loss');
  }
  if (answers.rested === 'No — feel groggy' || answers.rested === 'No — exhausted straight away') {
    add('rested', 5, `Waking unrefreshed (${answers.rested})`);
  }
  if (typeof answers.stress_level === 'number' && answers.stress_level >= 7) {
    add('stress_level', 4, 'Elevated stress — chronic cortisol is the primary driver of rT3-dominant thyroid presentations');
  }

  score = Math.min(100, score);
  return { pattern: 'thyroid', tier: tierFromScore(score, 45, 22), score, evidence: sortByWeight(evidence) };
}

/**
 * Metabolic / insulin resistance — body composition, family history, and
 * lifestyle flags associated with HOMA-IR elevation.
 */
export function scoreMetabolicPattern({ answers = {} } = {}) {
  const evidence = [];
  let score = 0;
  const add = (q, weight, note) => { if (weight > 0) { evidence.push({ q, weight, note }); score += weight; } };

  if (typeof answers.body_fat === 'number') {
    if (answers.body_fat > 30) add('body_fat', 15, `Body fat ${answers.body_fat}% — significant visceral fat range`);
    else if (answers.body_fat > 25) add('body_fat', 10, `Body fat ${answers.body_fat}%`);
  }
  if (answers.fat_location === 'Belly / lower abdomen' || answers.fat_location === 'Belly plus chest combined') {
    add('fat_location', 8, `Fat accumulation pattern: ${answers.fat_location}`);
  }
  if (answers.weight_trend === 'Gaining despite eating reasonably well' || answers.weight_trend === 'Stuck — cannot shift it') {
    add('weight_trend', 8, `Weight ${answers.weight_trend.toLowerCase()}`);
  }
  const diabetesWeights = { 'Yes — parent or sibling': 10, 'Yes — grandparent only': 5 };
  if (answers.family_diabetes in diabetesWeights) {
    add('family_diabetes', diabetesWeights[answers.family_diabetes], `Family history of type 2 diabetes: ${answers.family_diabetes}`);
  }
  if (answers.waist_trend === 'Increasing — belt notches out') {
    add('waist_trend', 8, 'Waist circumference increasing');
  }
  if (answers.training_days === '0 — not training currently') {
    add('training_days', 5, 'Not currently training — resistance training is the single strongest lifestyle lever on insulin sensitivity');
  }
  if (answers.alcohol === 'Heavily — 8+ units/week') {
    add('alcohol', 4, 'Heavy weekly alcohol intake');
  }
  if (typeof answers.sleep_hrs === 'number' && answers.sleep_hrs < 6) {
    add('sleep_hrs', 5, `Averaging ${answers.sleep_hrs}hrs sleep — even short-term sleep restriction measurably worsens insulin sensitivity`);
  }

  score = Math.min(100, score);
  return { pattern: 'metabolic', tier: tierFromScore(score, 50, 25), score, evidence: sortByWeight(evidence) };
}

/**
 * Single entry point both the browser and the edge function call.
 * Pure function — same input always produces the same output, so it's
 * fully unit-testable and requires no network access.
 */
export function scoreAllPatterns(input) {
  return {
    engineVersion: ENGINE_VERSION,
    scoredAt: new Date().toISOString(),
    patterns: [
      scoreAndrogenPattern(input),
      scoreHPAPattern(input),
      scoreThyroidPattern(input),
      scoreMetabolicPattern(input),
    ],
  };
}
