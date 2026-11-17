'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { wilson, summarize, guessSuccessProbability } = require('../src/stats');

test('Wilson interval: textbook example 8 of 10', () => {
  const w = wilson(8, 10);
  assert.ok(Math.abs(w.low - 0.4902) < 1e-3);
  assert.ok(Math.abs(w.high - 0.9433) < 1e-3);
});

test('Wilson interval at 0 starts at exactly 0; summary adds 3/N', () => {
  const s = summarize(0, 1000);
  assert.equal(s.wilsonLow, 0);
  assert.equal(s.upper3N, 0.003);
});

test('guessing formula matches the simple form for small b', () => {
  assert.ok(Math.abs(guessSuccessProbability(8, 100) - (1 - Math.pow(1 - 1 / 256, 100))) < 1e-12);
});

test('guessing formula stays accurate for b = 64', () => {
  // For tiny p, 1 - (1-p)^n is about n*p.
  const p = guessSuccessProbability(64, 1e6);
  assert.ok(Math.abs(p / (1e6 * Math.pow(2, -64)) - 1) < 1e-6);
});

const { floorProbability, expectedExcessUniform } = require('../src/floor');

test('floor formula: E[(t - U)+] for a uniform matches hand calculation', () => {
  assert.equal(expectedExcessUniform(1, 2, 4), 0);
  assert.equal(expectedExcessUniform(3, 2, 4), 0.25);   // (3-2)^2 / (2*2)
  assert.equal(expectedExcessUniform(10, 2, 4), 7);     // 10 - 3
});

test('floor formula: no delay, no loss gives the Poisson "no tap in D" probability', () => {
  const cfg = { owner: { meanTapGapSeconds: 60 }, channel: { pLoss: 0, pReorder: 0, baseDelaySeconds: [0, 1e-9], reorderExtraDelaySeconds: [1, 2] } };
  assert.ok(Math.abs(floorProbability(60, cfg) - Math.exp(-1)) < 1e-6);
});
