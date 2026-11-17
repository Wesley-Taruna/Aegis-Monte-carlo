'use strict';
// Local web view for the simulator.   node server.js   ->  http://localhost:3000
// Uses only Node's built-in http module. The page shows saved results from
// results/, can re-run experiments, and can trace a single trial step by step.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { ORDER, runExperiment, loadConfig, withOverrides, loadSavedResults } = require('./src/experiments');
const { runDemo } = require('./src/demo');
const { rngFor } = require('./src/rng');
const { runTrial } = require('./src/simulate');
const { replayAttacker, delayedRelayAttacker, cloneAttacker } = require('./src/attackers');

const PORT = Number(process.env.PORT) || 3000;
const WEB_DIR = path.join(__dirname, 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

// Only one experiment run at a time; the page polls /api/status for progress.
let status = { running: false, id: null, done: 0, total: 0, error: null, queue: [] };

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function startRuns(ids, overrides) {
  const cfg = withOverrides(loadConfig(), overrides);
  status = { running: true, id: null, done: 0, total: 0, error: null, queue: [...ids] };
  try {
    const e0 = await runExperiment('E0', cfg);
    if (!e0.allPass) throw new Error('E0 correctness failed - other experiments are not run.');
    for (const id of ids) {
      if (id === 'E0') continue;
      status.id = id;
      status.done = 0;
      await runExperiment(id, cfg, { onProgress: (d, n) => { status.done = d; status.total = n; } });
      status.queue = status.queue.filter((q) => q !== id);
    }
  } catch (err) {
    status.error = err.message;
  } finally {
    status.running = false;
    status.id = null;
  }
}

// One trial, with every message and verdict, for the trace explorer.
function trace(q) {
  const base = loadConfig();
  const num = (k, d) => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : d);
  const T = q.get('T') === 'off' ? null : num('T', base.verifier.T);
  const scenario = base.scenarios?.[q.get('scenario')] ? q.get('scenario') : 'steady';
  const cfg = {
    ...base,
    owner: {
      ...base.owner,
      tapsPerTrial: Math.min(200, num('taps', base.owner.tapsPerTrial)),
      ...(base.scenarios?.[scenario]?.owner ?? {}),
    },
    channel: { ...base.channel, pLoss: num('pLoss', base.channel.pLoss), pReorder: num('pReorder', base.channel.pReorder) },
  };
  const policy = { W: num('W', base.verifier.W), T, rateLimit: base.verifier.rateLimit, macBits: base.tag.macBits };
  const attack = q.get('attack') || 'none';
  const attacker = attack === 'A2' ? replayAttacker(cfg)
    : attack === 'A4' ? delayedRelayAttacker({ delaySeconds: num('D', base.attackers.A4.defaultDelaySeconds) })
    : attack === 'A1' ? cloneAttacker()
    : null;
  const rng = rngFor(base.seed, `trace/${num('trial', 1)}`);

  const { log, taps, ownerTaps, ownerLost } = runTrial(rng, cfg, policy, attacker);
  return { scenario, policy: { W: policy.W, T: policy.T }, channel: cfg.channel, attack, ownerTaps, ownerLost, taps, log };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/config') return sendJson(res, 200, loadConfig());
    if (url.pathname === '/api/results') return sendJson(res, 200, loadSavedResults());
    if (url.pathname === '/api/status') return sendJson(res, 200, status);
    if (url.pathname === '/api/demo') return sendJson(res, 200, runDemo(loadConfig()));
    if (url.pathname === '/api/trace') return sendJson(res, 200, trace(url.searchParams));
    if (url.pathname === '/api/run' && req.method === 'POST') {
      if (status.running) return sendJson(res, 409, { error: 'A run is already in progress' });
      const body = await readBody(req);
      const ids = (body.ids || ORDER).filter((id) => ORDER.includes(id));
      const trials = Math.max(10, Math.min(1e6, Number(body.trialsPerConfig) || 0)) || undefined;
      startRuns(ids, { trialsPerConfig: trials, seed: Number.isInteger(body.seed) ? body.seed : undefined });
      return sendJson(res, 202, { started: ids });
    }

    // Static files from web/.
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(WEB_DIR, path.normalize(rel));
    if (!file.startsWith(WEB_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`Aegis SDM simulator web view: http://localhost:${PORT}`));
