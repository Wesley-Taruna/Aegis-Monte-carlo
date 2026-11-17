'use strict';
// E2 Window sweep - the main result of the paper.
// For each backward window W and time rule T (default channel):
//   * honest false-reject rate (with the rule that caused each rejection)
//   * A2 replay acceptance
//   * A4 delayed-relay acceptance (split before / after the owner's next upload)

const { summarize } = require('../stats');
const { RULES } = require('../jobs');

const id = 'E2';
const title = 'E2 Window sweep: honest false rejects vs replay / delayed relay';

const tLabel = (T) => (T === null ? 'off' : `${T}s`);

// Scenarios to run (see config "scenarios"). The steady scenario keeps the job
// labels it had before scenarios existed, so its numbers are unchanged.
function scenarioList(cfg) {
  return (cfg.experiments.scenarios ?? ['steady']).map((name) => ({
    name,
    owner: cfg.scenarios?.[name]?.owner ?? {},
    labelPrefix: name === 'steady' ? '' : `${name}/`,
    spec: cfg.scenarios?.[name] ?? {},
  }));
}

function jobs(cfg) {
  const e = cfg.experiments.E2;
  const D = cfg.attackers.A4.defaultDelaySeconds;
  const list = [];
  for (const sc of scenarioList(cfg)) {
    for (const T of e.TList) {
      for (const W of e.WList) {
        const policy = { W, T };
        const tag = `W=${W}/T=${tLabel(T)}`;
        const base = { policy, owner: sc.owner };
        list.push({ ...base, kind: 'honest', label: `E2/${sc.labelPrefix}honest/${tag}`, meta: { scenario: sc.name, W, T, part: 'honest' } });
        list.push({ ...base, kind: 'A2', label: `E2/${sc.labelPrefix}A2/${tag}`, meta: { scenario: sc.name, W, T, part: 'A2' } });
        list.push({ ...base, kind: 'A4', label: `E2/${sc.labelPrefix}A4/${tag}`, delaySeconds: D, meta: { scenario: sc.name, W, T, part: 'A4' } });
      }
    }
  }
  return list;
}

function build(cfg, jobList, results) {
  const byKey = new Map();
  jobList.forEach((job, i) => {
    const key = `${job.meta.scenario}|${job.meta.W}|${job.meta.T}`;
    if (!byKey.has(key)) byKey.set(key, { scenario: job.meta.scenario, W: job.meta.W, T: job.meta.T });
    byKey.get(key)[job.meta.part] = results[i];
  });

  const rows = [...byKey.values()].map(({ scenario, W, T, honest, A2, A4 }) => {
    const row = { scenario, W, T: tLabel(T) };
    const frr = summarize(honest.rejected, honest.delivered);
    Object.assign(row, prefix('frr_', frr));
    for (const r of RULES) row[`frr_rule_${r}`] = honest.byRule[r] / honest.delivered;
    Object.assign(row, prefix('a2_', summarize(A2.accepted, A2.attempts)));
    Object.assign(row, prefix('a4_', summarize(A4.accepted, A4.attempts)));
    Object.assign(row, prefix('a4before_', summarize(A4.before.accepted, A4.before.attempts)));
    Object.assign(row, prefix('a4after_', summarize(A4.after.accepted, A4.after.attempts)));
    return row;
  });

  return {
    id, title, rows,
    notes: [
      `A4 uses attacker delay D = ${cfg.attackers.A4.defaultDelaySeconds} s.`,
      '"before" = the relay reached the server before any later owner counter was accepted. Those relays carry a fresh counter and are expected to pass for every W: an irreducible floor of SDM counter checking.',
      'Honest rates are per delivered message; messages within one trial are not independent, so the Wilson interval is somewhat optimistic.',
      'Time rule T (a condition, not a recommendation): T only helps when honest upload delays are much shorter than attacker delays. A late honest upload and a delayed relay both carry an older counter; the server can only tell them apart by how late they arrive.',
    ],
  };
}

function prefix(p, obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [p + k, v]));
}

module.exports = { id, title, jobs, build, prefix, tLabel, scenarioList };
