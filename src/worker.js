'use strict';
// One worker thread: receives { cfg, job }, runs it, sends back the counts.
const { parentPort } = require('node:worker_threads');
const { runJob } = require('./jobs');

parentPort.on('message', ({ cfg, job }) => {
  try {
    parentPort.postMessage({ result: runJob(cfg, job) });
  } catch (err) {
    parentPort.postMessage({ error: err.stack || String(err) });
  }
});
