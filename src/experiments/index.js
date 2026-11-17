'use strict';
// Registry of experiments + a runner that executes one and saves its results.
// Every saved file includes the exact config and seed used.

const fs = require('node:fs');
const path = require('node:path');
const { runJobsParallel } = require('../parallel');
const e0 = require('./e0');

const EXPERIMENTS = {
  E1: require('./e1'),
  E2: require('./e2'),
  E3: require('./e3'),
  E4: require('./e4'),
  E5: require('./e5'),
  A1A5: require('./a1a5'),
};
const ORDER = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'A1A5'];

const RESULTS_DIR = path.join(__dirname, '..', '..', 'results');

function loadConfig(file = path.join(__dirname, '..', '..', 'config', 'default.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Apply simple overrides such as { trialsPerConfig: 1000, seed: 7 }.
function withOverrides(cfg, overrides = {}) {
  const out = structuredClone(cfg);
  if (overrides.trialsPerConfig) out.trialsPerConfig = overrides.trialsPerConfig;
  if (Number.isInteger(overrides.seed)) out.seed = overrides.seed;
  return out;
}

async function runExperiment(id, cfg, { onProgress, save = true } = {}) {
  const startedAt = new Date().toISOString();
  let payload;
  if (id === 'E0') {
    payload = e0.run();
  } else {
    const exp = EXPERIMENTS[id];
    if (!exp) throw new Error(`Unknown experiment ${id}`);
    const jobs = exp.jobs(cfg);
    const results = await runJobsParallel(cfg, jobs, { onProgress });
    payload = exp.build(cfg, jobs, results);
  }
  const record = {
    ...payload,
    generatedAt: startedAt,
    seed: cfg.seed,
    trialsPerConfig: cfg.trialsPerConfig,
    config: cfg,
  };
  if (save) saveResults(record);
  return record;
}

function saveResults(record) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `${record.id}.json`), JSON.stringify(record, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, `${record.id}.csv`), toCsv(record.rows));
  if (record.extra) {
    for (const [name, rows] of Object.entries(record.extra)) {
      fs.writeFileSync(path.join(RESULTS_DIR, `${record.id}_${name}.csv`), toCsv(rows));
    }
  }
  fs.writeFileSync(path.join(RESULTS_DIR, `${record.id}.config-used.json`),
    JSON.stringify({ seed: record.seed, generatedAt: record.generatedAt, config: record.config }, null, 2));
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

function loadSavedResults() {
  const out = {};
  for (const id of ORDER) {
    const file = path.join(RESULTS_DIR, `${id}.json`);
    if (fs.existsSync(file)) out[id] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return out;
}

module.exports = { EXPERIMENTS, ORDER, runExperiment, loadConfig, withOverrides, loadSavedResults, toCsv, RESULTS_DIR };
