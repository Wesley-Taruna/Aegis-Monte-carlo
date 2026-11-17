'use strict';
// A "job" = N trials of one kind under one configuration, reduced to counts.
// Experiments are lists of jobs; jobs can run in parallel (see parallel.js)
// because each job builds its own random stream from (seed, job label).

const { rngFor } = require('./rng');
const { runTrial } = require('./simulate');
const {
  cloneAttacker, replayAttacker, guessingAttacker, delayedRelayAttacker, tamperForgeryAttacker,
} = require('./attackers');
const { isGenuineVerdict } = require('./verifier');

const RULES = ['rate_limit', 'mac', 'duplicate', 'window', 'time', 'unknown_uid'];
const emptyRules = () => Object.fromEntries(RULES.map((r) => [r, 0]));

// Build the effective config for a job: the base config with overrides applied.
function jobConfig(base, job) {
  return {
    ...base,
    owner: { ...base.owner, ...(job.owner || {}) },
    channel: { ...base.channel, ...(job.channel || {}) },
  };
}

function jobPolicy(base, job) {
  return {
    W: job.policy?.W ?? base.verifier.W,
    T: job.policy && 'T' in job.policy ? job.policy.T : base.verifier.T,
    rateLimit: base.verifier.rateLimit,
    macBits: job.macBits ?? base.tag.macBits,
  };
}

// Honest owner only: how many delivered genuine messages get rejected, and why.
function honestJob(cfg, policy, trials, rng) {
  const out = { delivered: 0, rejected: 0, byRule: emptyRules(), ownerTaps: 0, lost: 0, reorderedDelivered: 0, reorderedRejected: 0 };
  for (let i = 0; i < trials; i++) {
    const { log, ownerTaps, ownerLost } = runTrial(rng, cfg, policy);
    out.ownerTaps += ownerTaps;
    out.lost += ownerLost;
    for (const e of log) {
      out.delivered++;
      if (e.reordered) out.reorderedDelivered++;
      if (!isGenuineVerdict(e.result)) {
        out.rejected++;
        out.byRule[e.result.rule]++;
        if (e.reordered) out.reorderedRejected++;
      }
    }
  }
  return out;
}

// One attack message per trial (A1, A2, A4, A5). Also records the honest
// false rejects that happened in the same trials.
function attackJob(cfg, policy, trials, rng, makeAttacker) {
  const out = {
    attempts: 0, accepted: 0, byRule: emptyRules(),
    before: { attempts: 0, accepted: 0 }, after: { attempts: 0, accepted: 0 },
    honestDelivered: 0, honestRejected: 0, trialsWithoutAttack: 0,
  };
  for (let i = 0; i < trials; i++) {
    const { log } = runTrial(rng, cfg, policy, makeAttacker());
    let sawAttack = false;
    for (const e of log) {
      if (!e.isAttack) {
        out.honestDelivered++;
        if (!isGenuineVerdict(e.result)) out.honestRejected++;
        continue;
      }
      sawAttack = true;
      out.attempts++;
      const ok = isGenuineVerdict(e.result);
      if (ok) out.accepted++; else out.byRule[e.result.rule]++;
      const phase = e.ownerAheadAtArrival ? out.after : out.before;
      phase.attempts++;
      if (ok) phase.accepted++;
    }
    if (!sawAttack) out.trialsWithoutAttack++;
  }
  return out;
}

// A3: per trial, up to n guesses; success if any guess is accepted.
function guessingJob(cfg, policy, trials, rng, attempts) {
  const out = { trials: 0, successes: 0, guessesSent: 0, byRule: emptyRules() };
  const quietCfg = { ...cfg, owner: { ...cfg.owner, tapsPerTrial: 0 } };
  for (let i = 0; i < trials; i++) {
    const attacker = guessingAttacker({ attempts });
    const { log } = runTrial(rng, quietCfg, policy, attacker);
    out.trials++;
    out.guessesSent += attacker.sent;
    if (attacker.success) out.successes++;
    for (const e of log) if (!isGenuineVerdict(e.result)) out.byRule[e.result.rule]++;
  }
  return out;
}

/**
 * Run one job description:
 *   { kind: 'honest'|'A1'|'A2'|'A3'|'A4'|'A5', label, trials, policy?, channel?, owner?,
 *     macBits?, attempts?, delaySeconds?, variant? }
 */
function runJob(baseCfg, job) {
  const cfg = jobConfig(baseCfg, job);
  const policy = jobPolicy(baseCfg, job);
  const rng = rngFor(baseCfg.seed, job.label);
  const trials = job.trials ?? baseCfg.trialsPerConfig;
  switch (job.kind) {
    case 'honest': return honestJob(cfg, policy, trials, rng);
    case 'A1': return attackJob(cfg, policy, trials, rng, () => cloneAttacker());
    case 'A2': return attackJob(cfg, policy, trials, rng, () => replayAttacker(cfg));
    case 'A3': return guessingJob(cfg, policy, trials, rng, job.attempts);
    case 'A4': return attackJob(cfg, policy, trials, rng, () => delayedRelayAttacker({ delaySeconds: job.delaySeconds }));
    case 'A5': return attackJob(cfg, policy, trials, rng, () => tamperForgeryAttacker({ variant: job.variant }));
    default: throw new Error(`Unknown job kind ${job.kind}`);
  }
}

module.exports = { runJob, RULES };
