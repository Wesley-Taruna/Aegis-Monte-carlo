'use strict';
// E3 Sensitivity grid: honest false-reject rate for pLoss x pReorder,
// at a few selected (W, T) policies.

const { summarize } = require('../stats');
const { RULES } = require('../jobs');
const { prefix, tLabel, scenarioList } = require('./e2');

const id = 'E3';
const title = 'E3 Sensitivity grid: loss x reordering';

function jobs(cfg) {
  const e = cfg.experiments.E3;
  const list = [];
  for (const sc of scenarioList(cfg)) {
    for (const policy of e.policies) {
      for (const pLoss of e.pLossList) {
        for (const pReorder of e.pReorderList) {
          list.push({
            kind: 'honest',
            label: `E3/${sc.labelPrefix}W=${policy.W}/T=${tLabel(policy.T)}/pLoss=${pLoss}/pReorder=${pReorder}`,
            policy, owner: sc.owner, channel: { pLoss, pReorder },
            meta: { scenario: sc.name, W: policy.W, T: policy.T, pLoss, pReorder },
          });
        }
      }
    }
  }
  return list;
}

function build(cfg, jobList, results) {
  const rows = jobList.map((job, i) => {
    const r = results[i];
    const row = { scenario: job.meta.scenario, W: job.meta.W, T: tLabel(job.meta.T), pLoss: job.meta.pLoss, pReorder: job.meta.pReorder };
    Object.assign(row, prefix('frr_', summarize(r.rejected, r.delivered)));
    for (const rule of RULES) row[`frr_rule_${rule}`] = r.delivered ? r.byRule[rule] / r.delivered : null;
    return row;
  });
  return { id, title, rows, notes: ['pLoss and pReorder are assumed rates, not measured ones.'] };
}

module.exports = { id, title, jobs, build };
