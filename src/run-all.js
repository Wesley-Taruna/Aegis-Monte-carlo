'use strict';
// Command line: run the experiments and write results/*.csv and *.json.
//   node src/run-all.js                 all experiments, N from config (10,000)
//   node src/run-all.js --trials 1000   quicker run with N = 1000
//   node src/run-all.js --only E2,E4    just some experiments

const { ORDER, runExperiment, loadConfig, withOverrides } = require('./experiments');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--trials') args.trialsPerConfig = Number(argv[++i]);
    else if (argv[i] === '--seed') args.seed = Number(argv[++i]);
    else if (argv[i] === '--only') args.only = argv[++i].split(',');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = withOverrides(loadConfig(), args);
  const ids = args.only ?? ORDER;
  console.log(`Seed ${cfg.seed}, N = ${cfg.trialsPerConfig} trials per configuration`);

  // E0 must pass before anything else is reported.
  const e0 = await runExperiment('E0', cfg);
  console.log(`E0 correctness: ${e0.allPass ? 'ALL PASS' : 'FAILED'}`);
  if (!e0.allPass) {
    console.table(e0.rows);
    console.error('Stopping: E0 must pass before other experiments are reported.');
    process.exit(1);
  }

  for (const id of ids) {
    if (id === 'E0') continue;
    const t0 = Date.now();
    await runExperiment(id, cfg, {
      onProgress: (d, n) => process.stdout.write(`\r${id}: ${d}/${n} configurations`),
    });
    process.stdout.write(`\r${id}: done (${((Date.now() - t0) / 1000).toFixed(1)} s) -> results/${id}.csv, results/${id}.json\n`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
