'use strict';
// E4 Delayed relay (A4) vs attacker delay D, with the before/after split.
// Run at the selected policies of E3 to show that the "before" floor does not
// depend on W or T.

const { summarize } = require('../stats');
const { prefix, tLabel, scenarioList } = require('./e2');

const id = 'E4';
const title = 'E4 Delayed relay vs attacker delay D';

function jobs(cfg) {
  const list = [];
  for (const sc of scenarioList(cfg)) {
    const delays = sc.spec.e4DelaySecondsList ?? cfg.experiments.E4.delaySecondsList;
    for (const policy of cfg.experiments.E3.policies) {
      for (const D of delays) {
        list.push({
          kind: 'A4', label: `E4/${sc.labelPrefix}W=${policy.W}/T=${tLabel(policy.T)}/D=${D}`,
          policy, owner: sc.owner, delaySeconds: D, meta: { scenario: sc.name, W: policy.W, T: policy.T, D },
        });
      }
    }
  }
  return list;
}

function build(cfg, jobList, results) {
  const rows = jobList.map((job, i) => {
    const r = results[i];
    return {
      scenario: job.meta.scenario, W: job.meta.W, T: tLabel(job.meta.T), D: job.meta.D,
      shareBefore: r.attempts ? r.before.attempts / r.attempts : null,
      ...prefix('a4_', summarize(r.accepted, r.attempts)),
      ...prefix('before_', summarize(r.before.accepted, r.before.attempts)),
      ...prefix('after_', summarize(r.after.accepted, r.after.attempts)),
      rejectedWindow: r.byRule.window,
      rejectedTime: r.byRule.time,
      rejectedRateLimit: r.byRule.rate_limit,
    };
  });
  return {
    id, title, rows,
    notes: [
      '"floor" = acceptance contributed by relays that arrive before the owner\'s next accepted upload: shareBefore x before_rate. No counter rule can stop them, because their counter is the newest the server has seen.',
      'Time rule T (a condition, not a recommendation): T only helps when honest upload delays are much shorter than attacker delays.',
    ],
  };
}

module.exports = { id, title, jobs, build };
