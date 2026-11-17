'use strict';
// E1 MAC guessing (attacker A3): simulated success rate vs the formula
//     P(success) = 1 - (1 - 2^-b)^n
// for small MAC sizes b, then the formula alone for the real b = 64 with n
// bounded by the rate limit over a stated attack duration.

const { summarize, guessSuccessProbability } = require('../stats');

const id = 'E1';
const title = 'E1 MAC guessing vs formula';

function jobs(cfg) {
  const e = cfg.experiments.E1;
  const list = [];
  for (const b of e.macBitsList) {
    for (const n of e.attemptsList) {
      list.push({ kind: 'A3', label: `E1/b=${b}/n=${n}`, macBits: b, attempts: n, meta: { b, n } });
    }
  }
  return list;
}

function build(cfg, jobList, results) {
  const rows = jobList.map((job, i) => {
    const r = results[i];
    const s = summarize(r.successes, r.trials);
    const formula = guessSuccessProbability(job.meta.b, job.meta.n);
    return {
      macBits: job.meta.b,
      attempts: job.meta.n,
      ...s,
      formula,
      formulaInsideWilson: formula >= s.wilsonLow && formula <= s.wilsonHigh,
      guessesSent: r.guessesSent,
    };
  });

  // b = 64: formula only. n = the most guesses the rate limit allows.
  const rl = cfg.verifier.rateLimit;
  const b64 = cfg.experiments.E1.b64AttackDurationsDays.map((days) => {
    const n = Math.floor((rl.maxAttempts * days * 86400) / rl.windowSeconds);
    return { macBits: 64, attackDays: days, maxAttempts: n, formula: guessSuccessProbability(64, n) };
  });

  return {
    id, title, rows, extra: { b64 },
    notes: [
      'A3 sends guesses for one fresh counter, spaced just over windowSeconds/maxAttempts apart, so the rate limit never blocks them.',
      `b = 64 rows use the formula only, with n = maxAttempts (${rl.maxAttempts}) per ${rl.windowSeconds} s for the whole attack duration, on one tag.`,
    ],
  };
}

module.exports = { id, title, jobs, build };
