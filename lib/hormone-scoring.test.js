import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreAndrogenPattern, scoreHPAPattern, scoreThyroidPattern, scoreMetabolicPattern,
  scoreAllPatterns, ENGINE_VERSION,
} from './hormone-scoring.js';

test('androgen: TRT gates to not_applicable regardless of symptoms', () => {
  const r = scoreAndrogenPattern({ answers: { morning_erections: 'Never', libido_score: 1 }, profile: { onTRT: true } });
  assert.equal(r.tier, 'not_applicable');
  assert.equal(r.score, null);
  assert.equal(r.evidence.length, 0);
});

test('androgen: cardinal item alone (never morning erections) is a positive screen (possible) but needs corroboration for likely', () => {
  const r = scoreAndrogenPattern({ answers: { morning_erections: 'Never' }, profile: {} });
  assert.equal(r.score, 35);
  assert.equal(r.tier, 'possible');
});

test('androgen: cardinal item plus corroborating low libido reaches likely', () => {
  const r = scoreAndrogenPattern({ answers: { morning_erections: 'Never', libido_score: 1 }, profile: {} });
  assert.equal(r.score, 55);
  assert.equal(r.tier, 'likely');
});

test('androgen: no symptoms reported scores unlikely', () => {
  const r = scoreAndrogenPattern({ answers: { morning_erections: 'Daily / almost daily', libido_score: 9 }, profile: {} });
  assert.equal(r.tier, 'unlikely');
  assert.equal(r.score, 0);
});

test('androgen: supporting items alone can reach possible but not likely', () => {
  const r = scoreAndrogenPattern({
    answers: {
      morning_energy: 3, drive_motivation: 3, mood: 'Flat / emotionally blunted',
      recovery_between: 3, body_fat: 28,
    },
    profile: {},
  });
  assert.equal(r.score, 28);
  assert.equal(r.tier, 'possible');
});

test('hpa: stage 1 signals dominate when only stage-1 items present', () => {
  const r = scoreHPAPattern({ answers: { stress_level: 9, sleep_onset: 'Over an hour' } });
  assert.equal(r.stage, 1);
  assert.equal(r.tier, 'possible');
  assert.ok(r.evidence.every(e => e.stage === 1));
});

test('hpa: stage 2 signals (afternoon crash + 3-4am waking + brain fog) dominate and reach likely', () => {
  const r = scoreHPAPattern({
    answers: {
      afternoon_crash: 'Yes — every day without fail',
      caffeine_dep: 'Yes — essential just to feel normal',
      wake_night: 'Often wake between 3–4am specifically',
      cognitive_score: 4,
    },
  });
  assert.equal(r.stage, 2);
  assert.equal(r.score, 40);
  assert.equal(r.tier, 'likely');
});

test('hpa: wake_night_specific branch answer counts toward stage 2 the same as the direct option', () => {
  const direct = scoreHPAPattern({ answers: { wake_night: 'Often wake between 3–4am specifically' } });
  const branched = scoreHPAPattern({ answers: { wake_night: 'Three or more times', wake_night_specific: 'Yes — same time, 2–4am' } });
  assert.equal(direct.score, branched.score);
});

test('hpa: pure stage 3 presentation (only the 3 stage-3 items answered) screens as possible', () => {
  const r = scoreHPAPattern({
    answers: { morning_energy: 2, mood: 'Flat / emotionally blunted', rested: 'No — exhausted straight away' },
  });
  assert.equal(r.stage, 3);
  assert.equal(r.score, 34);
  assert.equal(r.tier, 'possible');
});

test('hpa: stage 3 presentation with corroborating stage-2 overlap reaches likely while stage 3 stays dominant', () => {
  const r = scoreHPAPattern({
    answers: {
      morning_energy: 2, mood: 'Flat / emotionally blunted', rested: 'No — exhausted straight away',
      wake_night: 'Often wake between 3–4am specifically',
    },
  });
  assert.equal(r.stage, 3);
  assert.equal(r.score, 48);
  assert.equal(r.tier, 'likely');
});

test('hpa: no signals returns null stage and unlikely tier', () => {
  const r = scoreHPAPattern({ answers: {} });
  assert.equal(r.stage, null);
  assert.equal(r.tier, 'unlikely');
  assert.equal(r.score, 0);
});

test('thyroid: cold sensitivity + diffuse hair loss + fatigue + brain fog cluster reaches likely', () => {
  const r = scoreThyroidPattern({
    answers: {
      cold_sensitivity: 'Always cold, others are fine',
      morning_energy: 3,
      cognitive_score: 4,
      hair_pattern: 'Diffuse — spread across the whole head',
      weight_trend: 'Stuck — cannot shift it',
      rested: 'No — feel groggy',
      stress_level: 8,
    },
  });
  assert.equal(r.score, 45);
  assert.equal(r.tier, 'likely');
});

test('thyroid: hair loss with a patterned (non-diffuse) presentation does not score', () => {
  const r = scoreThyroidPattern({ answers: { hair_pattern: 'Temples / hairline receding' } });
  assert.equal(r.score, 0);
});

test('metabolic: high body fat + family history + belly fat + weight stuck + not training reaches likely', () => {
  const r = scoreMetabolicPattern({
    answers: {
      body_fat: 32,
      fat_location: 'Belly / lower abdomen',
      family_diabetes: 'Yes — parent or sibling',
      waist_trend: 'Increasing — belt notches out',
      weight_trend: 'Stuck — cannot shift it',
      training_days: '0 — not training currently',
    },
  });
  assert.equal(r.score, 54);
  assert.equal(r.tier, 'likely');
});

test('metabolic: lean with no risk factors scores unlikely', () => {
  const r = scoreMetabolicPattern({ answers: { body_fat: 12, training_days: '5–6 days' } });
  assert.equal(r.tier, 'unlikely');
  assert.equal(r.score, 0);
});

test('scoreAllPatterns returns all four patterns with engine version and timestamp', () => {
  const result = scoreAllPatterns({ answers: {}, profile: {} });
  assert.equal(result.engineVersion, ENGINE_VERSION);
  assert.ok(result.scoredAt);
  assert.equal(result.patterns.length, 4);
  const names = result.patterns.map(p => p.pattern).sort();
  assert.deepEqual(names, ['androgen_axis', 'hpa_dysregulation', 'metabolic', 'thyroid']);
});

test('tier boundaries are stable for a known score just under and at the androgen "likely" threshold', () => {
  // libido_score=1 -> (6-1)*4=20; morning_erections 'Rarely — 0–1/week' -> 28; total 48 -> possible (< 55)
  const under = scoreAndrogenPattern({ answers: { libido_score: 1, morning_erections: 'Rarely — 0–1/week' }, profile: {} });
  assert.equal(under.score, 48);
  assert.equal(under.tier, 'possible');
  // add body_fat>25 (+5), stress_level>=8 (+4), sleep_hrs<6 (+4) -> 61 -> likely
  const over = scoreAndrogenPattern({
    answers: { libido_score: 1, morning_erections: 'Rarely — 0–1/week', body_fat: 28, stress_level: 9, sleep_hrs: 5 },
    profile: {},
  });
  assert.equal(over.score, 61);
  assert.equal(over.tier, 'likely');
});
