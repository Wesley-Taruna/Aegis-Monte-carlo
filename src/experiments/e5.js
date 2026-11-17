'use strict';
// E5 Floor formula check (steady scenario).
// Simulated share of delayed relays (A4) that arrive before the owner's next
// accepted upload, compared with the formula F(D) = exp(-lambda * q * E[(D - X)+])
// from src/floor.js. Run at the normal trial length and at a long one, because
// the formula assumes the owner never stops tapping.

const { summarize } = require('../stats');
const { floorProbability } = require('../floor');

const id = 'E5';
const title = 'E5 Delayed-relay floor: formula vs simulation';

function jobs(cfg) {
  const list = [];
  for (const K of cfg.experiments.E5.tapsPerTrialList) {
    for (const D of cfg.experiments.E4.delaySecondsList) {
      list.push({
        kind: 'A4', label: `E5/K=${K}/D=${D}`,
        owner: { ...(cfg.scenarios?.steady?.owner ?? {}), tapsPerTrial: K }, delaySeconds: D,
        meta: { K, D },
      });
    }
  }
  return list;
}

function build(cfg, jobList, results) {
  const steady = { owner: { ...cfg.owner, ...(cfg.scenarios?.steady?.owner ?? {}) }, channel: cfg.channel };
  const rows = jobList.map((job, i) => {
    const r = results[i];
    const s = summarize(r.before.attempts, r.attempts); // share of relays that were "before"
    const formula = floorProbability(job.meta.D, steady);
    return {
      tapsPerTrial: job.meta.K,
      D: job.meta.D,
      ...s,
      formula,
      formulaInsideWilson: formula >= s.wilsonLow && formula <= s.wilsonHigh,
      endEffectPLossOverK: cfg.channel.pLoss / job.meta.K,
      beforeAccepted: r.before.accepted,
    };
  });
  return {
    id, title, rows,
    notes: [
      'Formula: F(D) = exp(-lambda q E[(D - X)+]), lambda = 1 / meanTapGapSeconds, q = 1 - pLoss, X = upload delay (base + reordering extra). Derivation in src/floor.js and README.',
      'The formula is exact when the owner keeps tapping indefinitely. A finite trial differs in two ways. (1) Mid-range D: the capture moment always lies before the owner\'s last tap, which slightly shortens the wait for the next tap, so with 20 taps the simulated floor sits 1-2 points below the formula; with 200 taps this disappears. (2) Long D: with probability about 1/K the capture falls in the last gap of the trial, and if that final upload is lost (pLoss) nothing newer ever arrives. This leaves a residual floor of about pLoss/K (0.25% for K = 20, 0.025% for K = 200) that the infinite-horizon formula does not have.',
      'beforeAccepted shows that every "before" relay was in fact accepted (the rate limit never interfered).',
      'Gold scenario: no closed form is given. Taps come in bursts, so the Poisson assumption behind the formula does not hold; E4 reports the simulated floor only.',
    ],
  };
}

module.exports = { id, title, jobs, build };
