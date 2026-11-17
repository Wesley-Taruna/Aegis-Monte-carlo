'use strict';
// End-to-end checks of the simulation engine and attackers.
const test = require('node:test');
const assert = require('node:assert/strict');
const cfg = require('../config/default.json');
const { runJob } = require('../src/jobs');

test('same seed and label give identical results (reproducibility)', () => {
  const job = { kind: 'honest', label: 'repro', trials: 200 };
  assert.deepEqual(runJob(cfg, job), runJob(cfg, job));
});

test('perfect channel: no honest false rejects at all', () => {
  const r = runJob(cfg, { kind: 'honest', label: 'perfect', trials: 300, channel: { pLoss: 0, pReorder: 0 } });
  assert.equal(r.rejected, 0);
});

test('A1 clones are rejected by the MAC rule only', () => {
  const r = runJob(cfg, { kind: 'A1', label: 'a1', trials: 200 });
  assert.equal(r.accepted, 0);
  assert.equal(r.byRule.mac, r.attempts);
});

test('A2 replays are never accepted', () => {
  const r = runJob(cfg, { kind: 'A2', label: 'a2', trials: 300 });
  assert.equal(r.accepted, 0);
});

test('A4 relays that arrive before the owner\'s next upload are accepted for any W', () => {
  for (const W of [0, 32]) {
    const r = runJob(cfg, { kind: 'A4', label: `a4/${W}`, trials: 300, policy: { W, T: null }, delaySeconds: 600 });
    assert.equal(r.before.accepted, r.before.attempts);
  }
});

test('A5 tamper flip with unchanged MAC fails when tamper status is in the MAC', () => {
  const r = runJob(cfg, { kind: 'A5', label: 'a5', trials: 200, variant: 'unchanged_mac' });
  assert.equal(r.accepted, 0);
});

test('A5 tamper flip passes if the tamper status is NOT in the MAC (shows why the assumption matters)', () => {
  const loose = { ...cfg, tag: { ...cfg.tag, tamperInMac: false } };
  const r = runJob(loose, { kind: 'A5', label: 'a5loose', trials: 200, variant: 'unchanged_mac' });
  assert.ok(r.accepted > 0);
});

const { ownerSchedule, DAY } = require('../src/channel');
const { rngFor } = require('../src/rng');

test('gold scenario: taps come in sales separated by quiet periods of days', () => {
  const owner = { ...cfg.owner, ...cfg.scenarios.gold.owner };
  const { times, windows } = ownerSchedule(rngFor(5, 'gold-test'), owner);
  assert.equal(windows.length, owner.salesPerTrial);
  for (let i = 1; i < windows.length; i++) {
    assert.ok(windows[i][0] - windows[i - 1][1] > 0.9 * DAY); // quiet gap >= ~1 day
  }
  assert.ok(times.length >= owner.salesPerTrial * owner.tapsPerSale[0]);
  assert.ok(times.length <= owner.salesPerTrial * owner.tapsPerSale[1]);
});
