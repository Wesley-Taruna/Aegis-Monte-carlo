'use strict';
// A1 (clone) and A5 (tamper-flag forgery) at the default settings: one small table.

const { summarize } = require('../stats');
const { RULES } = require('../jobs');

const id = 'A1A5';
const title = 'A1 clone and A5 tamper-flag forgery (default settings)';

function jobs() {
  return [
    { kind: 'A1', label: 'A1A5/A1', meta: { attacker: 'A1 Clone (same UID, wrong key)' } },
    { kind: 'A5', label: 'A5/unchanged', variant: 'unchanged_mac', meta: { attacker: 'A5 Tamper flip, unchanged MAC' } },
    { kind: 'A5', label: 'A5/guessed', variant: 'guessed_mac', meta: { attacker: 'A5 Tamper flip, guessed MAC' } },
  ];
}

function build(cfg, jobList, results) {
  const rows = jobList.map((job, i) => {
    const r = results[i];
    const row = { attacker: job.meta.attacker, ...summarize(r.accepted, r.attempts) };
    for (const rule of RULES) row[`rejected_${rule}`] = r.byRule[rule];
    return row;
  });
  return {
    id, title, rows,
    notes: [
      `tamperInMac = ${cfg.tag.tamperInMac}: the tag is configured with TTStatusOffset inside the MAC input range (deployment requirement, NT4H2421Tx data sheet Rev. 3.0, Sec. 9.3.4-9.3.5). On a tag configured without it, the "unchanged MAC" forgery would pass the MAC check.`,
      `W = ${cfg.verifier.W}, T = ${cfg.verifier.T === null ? 'off' : cfg.verifier.T + ' s'}, MAC = ${cfg.tag.macBits} bits.`,
    ],
  };
}

module.exports = { id, title, jobs, build };
