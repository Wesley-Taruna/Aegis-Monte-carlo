'use strict';
// Runs many jobs at once on several CPU cores (Node's built-in worker_threads).
// Results do not depend on how many cores are used: each job seeds its own
// random stream from (seed, job.label).

const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_FILE = path.join(__dirname, 'worker.js');

function runJobsParallel(cfg, jobs, { onProgress, threads } = {}) {
  const n = Math.max(1, Math.min(threads ?? Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1), jobs.length));
  const results = new Array(jobs.length);
  let next = 0, done = 0;

  return new Promise((resolve, reject) => {
    if (jobs.length === 0) return resolve(results);
    const workers = [];
    const finish = (err) => {
      for (const w of workers) w.terminate();
      if (err) reject(err); else resolve(results);
    };
    const feed = (w) => {
      if (next >= jobs.length) return;
      const idx = next++;
      w.currentIndex = idx;
      w.postMessage({ cfg, job: jobs[idx] });
    };
    for (let i = 0; i < n; i++) {
      const w = new Worker(WORKER_FILE);
      workers.push(w);
      w.on('message', (msg) => {
        if (msg.error) return finish(new Error(msg.error));
        results[w.currentIndex] = msg.result;
        done++;
        if (onProgress) onProgress(done, jobs.length);
        if (done === jobs.length) finish();
        else feed(w);
      });
      w.on('error', finish);
      feed(w);
    }
  });
}

module.exports = { runJobsParallel };
