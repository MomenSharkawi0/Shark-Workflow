/**
 * Workflow Command Center — Express Server v3.2.0
 * ============================================================================
 * Backend for the orchestration dashboard. Provides:
 *   - REST API for orchestrator commands
 *   - SSE (Server-Sent Events) for real-time dashboard updates
 *   - Activity log with persistent history
 *   - Metrics aggregation endpoint
 *   - Atomic file writes for status updates
 *   - Localhost-only CORS, lock-coordinated autopilot, path-validated injection
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { interpret: interpretPrd } = require('./lib/prdInterpreter');
const { reconcileToPlan, reconcileToFeatureRequest } = require('./lib/planReconciler');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Restrict CORS to localhost only — the dashboard triggers privileged orchestrator
// commands (Reset, Next, Undo) and writes files; allowing arbitrary origins lets
// any visited webpage drive-by your workspace.
const allowedOrigins = new Set([
  `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`,
  // Common alt ports a developer might run the dashboard on:
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:3001', 'http://127.0.0.1:3001'
]);
function originAllowed(origin) {
  if (!origin) return true;          // same-origin requests
  if (allowedOrigins.has(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
  } catch {}
  return false;
}
app.use(cors({
  origin: (origin, cb) => originAllowed(origin) ? cb(null, true) : cb(null, false)
}));
// Belt-and-braces: explicitly 403 cross-origin POSTs whose origin we don't trust.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.headers.origin && !originAllowed(req.headers.origin)) {
    return res.status(403).json({ error: `Origin not allowed: ${req.headers.origin}` });
  }
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// PATHS
// ============================================================================

const WORKFLOW_DIR = path.join(__dirname, '..', 'WORKFLOW');
const STATUS_FILE = path.join(WORKFLOW_DIR, 'ORCHESTRATION_STATUS.json');
const METRICS_FILE = path.join(WORKFLOW_DIR, 'METRICS.json');
const DASHBOARD_FILE = path.join(WORKFLOW_DIR, 'QUALITY_DASHBOARD.md');
const LOG_FILE = path.join(WORKFLOW_DIR, 'orchestrator.log');
const ACTIVE_DIR = path.join(WORKFLOW_DIR, 'ACTIVE');
const LOCK_FILE = path.join(WORKFLOW_DIR, '.lock');
const ORCHESTRATOR_SCRIPT = path.join(__dirname, '..', 'orchestrator.ps1');

// ============================================================================
// SSE (Server-Sent Events) Infrastructure
// ============================================================================

/** @type {import('http').ServerResponse[]} */
const sseClients = [];

/** @type {Array<{timestamp: string, type: string, message: string, level: string}>} */
const activityLog = [];
const MAX_ACTIVITY_LOG = 200;

/** @type {Array<{id: string, role: string, content: string, timestamp: string, status: string}>} */
const chatHistory = [];
const MAX_CHAT_HISTORY = 100;
let chatIdCounter = 0;

/**
 * Broadcast an event to all connected SSE clients.
 */
function broadcastSSE(eventType, data) {
  const payload = JSON.stringify({ type: eventType, ...data, timestamp: new Date().toISOString() });
  sseClients.forEach(client => {
    try { client.write(`data: ${payload}\n\n`); } catch {}
  });
}

/**
 * Add an entry to the activity log and broadcast via SSE.
 */
function logActivity(type, message, level = 'info') {
  const entry = { timestamp: new Date().toISOString(), type, message, level };
  activityLog.unshift(entry);
  if (activityLog.length > MAX_ACTIVITY_LOG) activityLog.length = MAX_ACTIVITY_LOG;
  broadcastSSE('activity', entry);
}

// ============================================================================
// FILE WATCHERS — Push updates via SSE when files change
// ============================================================================

let lastStatusHash = '';
let lastLogSize = 0;

/**
 * Watch ORCHESTRATION_STATUS.json for changes and push via SSE.
 * Uses content hashing to avoid duplicate broadcasts.
 */
function readDeliverables() {
  // Lightweight existence-check for the deliverable each step is supposed to
  // produce. Used by the dashboard to render checkmarks and a "Click Next"
  // CTA when the current step's deliverable already exists.
  const files = {
    phasePlan:        'PHASE_PLAN.md',
    detailedPlan:     'DETAILED_PLAN.md',
    planReview:       'PLAN_REVIEW.md',
    planApproved:     'PLAN_APPROVED.md',
    executionReport:  'EXECUTION_REPORT.md',
    executionReview:  'EXECUTION_REVIEW.md',
    currentInstruction: 'CURRENT_INSTRUCTION.md',
  };
  const out = {};
  for (const [key, name] of Object.entries(files)) {
    out[key] = fs.existsSync(path.join(ACTIVE_DIR, name));
  }
  return out;
}

function readCurrentMode() {
  // Sidecar written by the VS Code extension's WorkflowWatcher every time the
  // Roo mode changes. Kept separate from ORCHESTRATION_STATUS.json to avoid
  // concurrent-write races with the orchestrator.
  const sidecar = path.join(WORKFLOW_DIR, 'CURRENT_MODE.json');
  if (!fs.existsSync(sidecar)) return null;
  try {
    const stat = fs.statSync(sidecar);
    // Treat anything older than 30s as stale (extension probably crashed).
    if (Date.now() - stat.mtimeMs > 30_000) return null;
    const raw = fs.readFileSync(sidecar, 'utf-8');
    const data = JSON.parse(raw);
    return typeof data.mode === 'string' ? data.mode : null;
  } catch { return null; }
}

function startFileWatcher() {
  setInterval(() => {
    try {
      if (!fs.existsSync(STATUS_FILE)) return;
      const raw = fs.readFileSync(STATUS_FILE, 'utf-8');
      const deliverables = readDeliverables();
      const editorMode = readCurrentMode();
      const fingerprint = Buffer.from(raw).toString('base64').slice(0, 32) + '|' + JSON.stringify(deliverables) + '|' + (editorMode || '');
      if (fingerprint !== lastStatusHash) {
        lastStatusHash = fingerprint;
        const cleaned = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
        const data = JSON.parse(cleaned);
        broadcastSSE('status_change', {
          currentState: data.currentState,
          previousState: data.previousState,
          phase: data.phase,
          cycleStart: data.cycleStart,
          lastTransition: data.lastTransition,
          transitionCount: data.transitionCount,
          retryCount: data.retryCount,
          nextAction: data.nextAction,
          nextMode: data.nextMode,
          status: data.status,
          blockedReason: data.blockedReason,
          autopilot: data.autopilot,
          phaseIndex: data.phaseIndex || 0,
          phaseTotal: data.phaseTotal || 0,
          deliverables,
          editorMode,
        });
      }
    } catch {}
  }, 800);

  // Watch orchestrator.log for new lines
  setInterval(() => {
    try {
      if (!fs.existsSync(LOG_FILE)) return;
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > lastLogSize) {
        const fd = fs.openSync(LOG_FILE, 'r');
        const buf = Buffer.alloc(stat.size - lastLogSize);
        fs.readSync(fd, buf, 0, buf.length, lastLogSize);
        fs.closeSync(fd);
        const newLines = buf.toString('utf-8').split('\n').filter(l => l.trim());
        newLines.forEach(line => {
          const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (.+)$/);
          if (match) {
            logActivity('log', match[3], match[2].toLowerCase());
          }
        });
        lastLogSize = stat.size;
      }
    } catch {}
  }, 1000);
}

// ============================================================================
// HELPERS
// ============================================================================

// Strip a UTF-8 BOM (0xFEFF) before JSON.parse — PowerShell's
// `Set-Content -Encoding UTF8` writes one on Windows PS 5.1.
function parseJsonSafe(raw) {
  if (typeof raw === 'string' && raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

function readStatus() {
  const defaultStatus = {
    schemaVersion: 1,
    currentState: 'INIT', previousState: '', phase: '', cycleStart: '', cycleId: '',
    lastTransition: '', transitionCount: 0, retryCount: 0, nextAction: '',
    nextMode: '', status: 'IN_PROGRESS', blockedReason: '', autopilot: false,
    parallelTracks: false, phaseIndex: 0, phaseTotal: 0
  };
  if (!fs.existsSync(STATUS_FILE)) return defaultStatus;

  let retries = 3;
  while (retries > 0) {
    try {
      const raw = fs.readFileSync(STATUS_FILE, 'utf-8');
      if (raw.trim()) return parseJsonSafe(raw);
    } catch (e) {
      retries--;
      if (retries === 0) throw e;
      const start = Date.now(); while(Date.now() - start < 50) {}
    }
  }
  return defaultStatus;
}

/**
 * Atomic write: write to .tmp then rename, matching orchestrator.ps1 behavior.
 */
function writeStatusAtomic(data) {
  const tmp = STATUS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, STATUS_FILE);
}

/**
 * Run an orchestrator command and return the result.
 */
function runOrchestrator(flag) {
  return new Promise((resolve) => {
    const cmd = `powershell.exe -ExecutionPolicy Bypass -File "${ORCHESTRATOR_SCRIPT}" ${flag}`;
    logActivity('command', `Executing: orchestrator.ps1 ${flag}`, 'info');
    exec(cmd, { cwd: path.join(__dirname, '..'), timeout: 60000 }, (error, stdout, stderr) => {
      const success = !error;
      logActivity('command', `${flag} → ${success ? 'SUCCESS' : 'FAILED'}`, success ? 'ok' : 'fail');
      resolve({ success, stdout: stdout || '', stderr: stderr || '', error: error ? error.message : null });
    });
  });
}

// ============================================================================
// SSE ENDPOINT
// ============================================================================

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  // Send current status immediately
  try {
    const data = readStatus();
    res.write(`data: ${JSON.stringify({ type: 'status_change', ...data, timestamp: new Date().toISOString() })}\n\n`);
  } catch {}

  sseClients.push(res);
  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// ============================================================================
// REST API — Status & Data
// ============================================================================

app.get('/api/status', (req, res) => {
  try {
    const data = readStatus();
    res.json({
      'Current State': data.currentState,
      'Previous State': data.previousState || '',
      'Phase': data.phase || '',
      'Cycle Start': data.cycleStart || '',
      'Last Transition': data.lastTransition || '',
      'Transition Count': String(data.transitionCount || 0),
      'Retry Count': String(data.retryCount || 0),
      'Next Action': data.nextAction || '',
      'Next Mode': data.nextMode || '',
      'Status': data.status || 'IN_PROGRESS',
      'Blocked Reason': data.blockedReason || '',
      'Autopilot': data.autopilot ? 'ON' : 'OFF',
      'Phase Index': data.phaseIndex || 0,
      'Phase Total': data.phaseTotal || 0,
      deliverables: readDeliverables(),
      editorMode: readCurrentMode(),
      _raw: data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard', (req, res) => {
  try {
    if (!fs.existsSync(DASHBOARD_FILE)) return res.json({ content: '# Quality Dashboard\n\nNo data yet.' });
    res.json({ content: fs.readFileSync(DASHBOARD_FILE, 'utf-8') });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/metrics', (req, res) => {
  try {
    if (!fs.existsSync(METRICS_FILE)) return res.json({ cycles: [], summary: {} });
    const metrics = parseJsonSafe(fs.readFileSync(METRICS_FILE, 'utf-8'));
    // Compute summary statistics
    const cycles = metrics.cycles || [];
    const summary = {
      totalCycles: cycles.length,
      totalDurationMin: cycles.reduce((s, c) => s + (c.durationMinutes || 0), 0),
      avgDurationMin: cycles.length > 0 ? Math.round(cycles.reduce((s, c) => s + (c.durationMinutes || 0), 0) / cycles.length) : 0,
      totalTransitions: cycles.reduce((s, c) => s + (c.transitions || 0), 0),
      escalationCount: cycles.filter(c => c.escalated).length,
      latestPhase: cycles.length > 0 ? cycles[cycles.length - 1].phase : '—'
    };
    res.json({ cycles, summary });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/activity', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ entries: activityLog.slice(0, limit) });
});

// ============================================================================
// REST API — Progress Estimation (Phase 6d)
// ============================================================================

app.get('/api/progress', (req, res) => {
  try {
    const status = readStatus();
    const currentState = status.currentState || 'INIT';
    const cycleStart = status.cycleStart;

    const STATES = ['INIT','PHASE_PLANNING','DETAILED_PLANNING','PLAN_REVIEW','EXECUTION','EXECUTION_REVIEW','ARCHIVE','COMPLETE'];
    const stateIdx = STATES.indexOf(currentState);
    const totalStates = STATES.length - 1; // Exclude COMPLETE
    const percentComplete = stateIdx >= 0 ? Math.round((stateIdx / totalStates) * 100) : 0;

    // Historical analysis from METRICS.json
    let avgCycleDurationMin = 0;
    let avgPhaseDurations = {};
    let estimatedRemainingMin = 0;
    let confidence = 'low';
    let completedCycles = 0;

    if (fs.existsSync(METRICS_FILE)) {
      try {
        const metrics = parseJsonSafe(fs.readFileSync(METRICS_FILE, 'utf-8'));
        const cycles = metrics.cycles || [];
        completedCycles = cycles.length;

        if (cycles.length > 0) {
          avgCycleDurationMin = Math.round(
            cycles.reduce((s, c) => s + (c.durationMinutes || 0), 0) / cycles.length
          );
          confidence = cycles.length >= 5 ? 'high' : cycles.length >= 2 ? 'medium' : 'low';
        }

        // Estimate remaining time based on cycle start and avg duration
        if (cycleStart && avgCycleDurationMin > 0) {
          const elapsedMs = Date.now() - new Date(cycleStart).getTime();
          const elapsedMin = elapsedMs / 60000;
          // Scale estimate by how many phases remain
          const remainingFraction = (totalStates - stateIdx) / totalStates;
          estimatedRemainingMin = Math.max(0, Math.round(avgCycleDurationMin * remainingFraction - elapsedMin * remainingFraction));
        }
      } catch {}
    }

    // Elapsed time
    let elapsedMin = 0;
    if (cycleStart) {
      elapsedMin = Math.round((Date.now() - new Date(cycleStart).getTime()) / 60000);
    }

    res.json({
      currentState,
      stateIndex: stateIdx,
      totalStates,
      percentComplete,
      elapsedMin,
      estimatedRemainingMin,
      estimatedTotalMin: avgCycleDurationMin,
      confidence,
      completedCycles,
      phasesRemaining: totalStates - stateIdx
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// REST API — Chat Interface (Phase 3c)
// ============================================================================

app.get('/api/chat/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ messages: chatHistory.slice(-limit) });
});

app.post('/api/chat/send', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    const userMsg = {
      id: `msg_${++chatIdCounter}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      status: 'sent'
    };
    chatHistory.push(userMsg);
    if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.splice(0, chatHistory.length - MAX_CHAT_HISTORY);
    broadcastSSE('chat_message', userMsg);
    logActivity('chat', `User: ${message.substring(0, 80)}`, 'info');

    // Forward to WorkflowBridge running inside VS Code extension
    let agentResponse = { success: false, error: 'Bridge not reachable' };
    try {
      // WorkflowBridge serves chat at /api/chat/send (not /bridge/send).
      const bridgeRes = await fetch('http://127.0.0.1:3001/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      if (!bridgeRes.ok) {
        agentResponse = { success: false, error: `Bridge ${bridgeRes.status} ${bridgeRes.statusText}` };
        throw new Error(agentResponse.error);
      }
      agentResponse = await bridgeRes.json();
    } catch (err) {
      agentResponse = { success: false, error: 'Bridge connection failed. Is the extension running?' };
    }

    // Record agent response
    const agentMsg = {
      id: `msg_${++chatIdCounter}`,
      role: 'agent',
      content: agentResponse.success
        ? '✅ Message delivered to agent. Check the editor for the response.'
        : `❌ ${agentResponse.error || 'Unknown error'}`,
      timestamp: new Date().toISOString(),
      status: agentResponse.success ? 'delivered' : 'failed'
    };
    chatHistory.push(agentMsg);
    broadcastSSE('chat_message', agentMsg);

    res.json({ success: agentResponse.success, userMsg, agentMsg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/chat/clear', (req, res) => {
  chatHistory.length = 0;
  chatIdCounter = 0;
  broadcastSSE('chat_cleared', {});
  res.json({ success: true });
});

app.get('/api/quality-gates', (req, res) => {
  try {
    if (!fs.existsSync(DASHBOARD_FILE)) return res.json({ gates: [] });
    const content = fs.readFileSync(DASHBOARD_FILE, 'utf-8');
    const lines = content.split(/\r?\n/).filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Timestamp'));
    const gates = lines.map(line => {
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      return { timestamp: cols[0], gate: cols[1], result: cols[2], notes: cols[3] || '' };
    }).filter(g => g.timestamp && g.gate);
    res.json({ gates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================================
// REST API — Commands
// ============================================================================

app.post('/api/next', async (req, res) => { res.json(await runOrchestrator('-Next')); });
app.post('/api/reset', async (req, res) => { res.json(await runOrchestrator('-Reset')); });
app.post('/api/undo', async (req, res) => { res.json(await runOrchestrator('-Undo')); });
app.post('/api/resume', async (req, res) => { res.json(await runOrchestrator('-Resume')); });
app.post('/api/plan', async (req, res) => { res.json(await runOrchestrator('-Plan')); });

// ============================================================================
// REST API — Workflow control proxied to the WorkflowBridge inside VS Code
// (cycle start/abort, mode switch, autonomy level, current mode lookup).
// These are no-ops if the Roo Code extension isn't running.
// ============================================================================

// Bridge URL is overridable via BRIDGE_BASE env var so tests can point at a
// guaranteed-unused port and assert the "bridge offline" code paths.
const BRIDGE_BASE = process.env.BRIDGE_BASE || 'http://127.0.0.1:3001';

async function proxyToBridge(req, res, bridgePath, opts = {}) {
  try {
    const fetchOpts = {
      method: opts.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    if (fetchOpts.method !== 'GET' && req.body && Object.keys(req.body).length) {
      fetchOpts.body = JSON.stringify(req.body);
    }
    const r = await fetch(`${BRIDGE_BASE}${bridgePath}`, fetchOpts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(503).json({
      error: 'Bridge unreachable. Start the Roo Code extension in VS Code.',
      detail: err.message
    });
  }
}

app.post('/api/cycle/start',  (req, res) => proxyToBridge(req, res, '/api/cycle/start'));
app.post('/api/cycle/abort',  (req, res) => proxyToBridge(req, res, '/api/cycle/abort'));
app.post('/api/autonomy',     (req, res) => proxyToBridge(req, res, '/api/autonomy'));
app.post('/api/mode/switch',  (req, res) => proxyToBridge(req, res, '/api/mode/switch'));
app.get('/api/mode/current',  (req, res) => proxyToBridge(req, res, '/api/mode/current', { method: 'GET' }));

// V6 Phase C — model routing (proxies to bridge for live registry; persists locally)
app.get('/api/models/list',      (req, res) => proxyToBridge(req, res, '/api/models/list', { method: 'GET' }));
app.get('/api/models/recommend', (req, res) => proxyToBridge(req, res, '/api/models/recommend', { method: 'GET' }));

// /api/config/models — persisted in WORKFLOW/workflow-config.json (single source of truth)
const WORKFLOW_CONFIG_PATH = path.join(WORKFLOW_DIR, 'workflow-config.json');

app.get('/api/config/models', (req, res) => {
  try {
    if (!fs.existsSync(WORKFLOW_CONFIG_PATH)) {
      return res.json({ perPhaseModels: false, modelByMode: {} });
    }
    const cfg = parseJsonSafe(fs.readFileSync(WORKFLOW_CONFIG_PATH, 'utf-8'));
    res.json({
      perPhaseModels: !!cfg.perPhaseModels,
      modelByMode: cfg.modelByMode || {},
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/models', (req, res) => {
  try {
    const { perPhaseModels, modelByMode } = req.body || {};
    if (typeof perPhaseModels !== 'boolean') {
      return res.status(400).json({ error: 'perPhaseModels must be boolean' });
    }
    if (modelByMode !== undefined && (typeof modelByMode !== 'object' || Array.isArray(modelByMode))) {
      return res.status(400).json({ error: 'modelByMode must be an object map' });
    }
    // Light validation: each mode entry must be {modelId, provider?}
    const modes = ['director', 'planner', 'executor', 'reviewer', 'workflow-master'];
    const sanitized = {};
    for (const m of modes) {
      const e = (modelByMode || {})[m];
      if (!e) continue;
      if (typeof e.modelId !== 'string' || !e.modelId.trim()) {
        return res.status(400).json({ error: `modelByMode.${m}.modelId must be a non-empty string` });
      }
      sanitized[m] = { modelId: e.modelId.trim() };
      if (e.provider && typeof e.provider === 'string') sanitized[m].provider = e.provider.trim();
    }
    // Read existing config (if any), merge, write atomically
    let existing = {};
    if (fs.existsSync(WORKFLOW_CONFIG_PATH)) {
      try { existing = parseJsonSafe(fs.readFileSync(WORKFLOW_CONFIG_PATH, 'utf-8')); } catch {}
    }
    const merged = { ...existing, perPhaseModels, modelByMode: sanitized };
    if (!fs.existsSync(WORKFLOW_DIR)) fs.mkdirSync(WORKFLOW_DIR, { recursive: true });
    const tmp = WORKFLOW_CONFIG_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf-8');
    fs.renameSync(tmp, WORKFLOW_CONFIG_PATH);
    logActivity('config', `Model routing updated (perPhaseModels=${perPhaseModels}, ${Object.keys(sanitized).length} overrides)`, 'ok');
    res.json({ success: true, perPhaseModels, modelByMode: sanitized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A11: coordinate autopilot writes with the orchestrator's lock so we don't clobber
// an in-flight `-Next` transition. Same lock semantics as orchestrator.ps1 (60s stale).
function acquireLockOrFail() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const ageMs = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
      if (ageMs > 60_000) {
        try { fs.unlinkSync(LOCK_FILE); } catch {}
      } else {
        return false;
      }
    } catch { return false; }
  }
  try {
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, source: 'dashboard', ts: new Date().toISOString() }));
    return true;
  } catch { return false; }
}
function releaseLock() {
  try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch {}
}

app.post('/api/autopilot', (req, res) => {
  try {
    const { state } = req.body;
    if (state !== 'ON' && state !== 'OFF') return res.status(400).json({ error: 'State must be ON or OFF' });
    if (!fs.existsSync(STATUS_FILE)) return res.status(404).json({ error: 'Status file not found' });

    if (!acquireLockOrFail()) {
      return res.status(423).json({ error: 'Orchestrator is busy (lock held). Try again in a moment.' });
    }
    try {
      const data = readStatus();
      data.autopilot = (state === 'ON');
      writeStatusAtomic(data);
      logActivity('autopilot', `Autopilot set to ${state}`, state === 'ON' ? 'ok' : 'info');
      res.json({ success: true, state });
    } finally {
      releaseLock();
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Legacy alias — keep so older clients still work; route to /api/chat/send.
app.post('/api/send-message', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });

    // WorkflowBridge serves chat at /api/chat/send (not /bridge/send).
    const bridgeRes = await fetch('http://127.0.0.1:3001/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    const data = await bridgeRes.json();
    logActivity('command', `Sent message to Agent`, bridgeRes.ok ? 'ok' : 'fail');
    res.json(data);
  } catch (err) {
    logActivity('command', `Bridge connection failed. Is the extension running?`, 'warn');
    res.status(500).json({ error: 'Failed to reach WorkflowBridge. Is Roo Code active?' });
  }
});

// C1: Validate fileName to prevent path traversal. Reject anything with separators,
// parent-dir refs, or non-markdown extensions, and confirm the resolved path stays
// inside WORKFLOW/ACTIVE/.
const SAFE_FILENAME = /^[A-Za-z0-9._-]+\.md$/;
const MAX_INJECT_BYTES = 512 * 1024; // 512 KB

app.post('/api/inject-plan', (req, res) => {
  const { fileName, content } = req.body;
  if (!fileName || typeof fileName !== 'string') return res.status(400).json({ error: 'Missing fileName' });
  if (typeof content !== 'string' || !content) return res.status(400).json({ error: 'Missing content' });
  if (Buffer.byteLength(content, 'utf-8') > MAX_INJECT_BYTES) {
    return res.status(413).json({ error: `Content exceeds ${MAX_INJECT_BYTES} bytes` });
  }
  if (!SAFE_FILENAME.test(fileName)) {
    return res.status(400).json({ error: 'fileName must be a basename matching [A-Za-z0-9._-]+\\.md' });
  }
  try {
    if (!fs.existsSync(ACTIVE_DIR)) fs.mkdirSync(ACTIVE_DIR, { recursive: true });
    const target = path.resolve(ACTIVE_DIR, fileName);
    const activeRoot = path.resolve(ACTIVE_DIR) + path.sep;
    if (!target.startsWith(activeRoot)) {
      return res.status(400).json({ error: 'Resolved path escapes ACTIVE directory' });
    }
    fs.writeFileSync(target, content, 'utf-8');
    logActivity('inject', `Injected ${fileName}`, 'ok');
    res.json({ success: true, message: `Injected ${fileName}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================================
// PRD INGESTION (V6 Phase A)
//   POST /api/ingest/prd     — heuristic interpret + optional reconcile
//   GET  /api/ingest/sample  — returns the orphaned HR_Platform_PRD.md
//
// The heuristic interpreter is dependency-free and always runs. The bridge's
// LLM-backed `/api/ingest/interpret` is invoked only when confidence < 0.6
// AND the bridge is reachable, mirroring how the dashboard gracefully
// degrades when the Roo Code extension isn't running.
// ============================================================================

const MAX_INGEST_BYTES = 1024 * 1024; // 1 MB
const HR_PRD_PATH = path.join(__dirname, '..', 'HR_Platform_PRD.md');

app.post('/api/ingest/prd', async (req, res) => {
  try {
    const { markdown, mode } = req.body || {};
    if (typeof markdown !== 'string' || !markdown.trim()) {
      return res.status(400).json({ error: 'markdown is required' });
    }
    if (Buffer.byteLength(markdown, 'utf-8') > MAX_INGEST_BYTES) {
      return res.status(413).json({ error: `markdown exceeds ${MAX_INGEST_BYTES} bytes` });
    }
    const ingestMode = mode === 'reconcile' ? 'reconcile' : 'interpret';

    // 1. Heuristic pass — always free, always runs.
    const local = interpretPrd(markdown);
    let merged = local.fields;
    let aggregateConfidence = local.confidence;

    // 2. LLM uplift — only when heuristics returned weak signal AND the bridge
    //    is reachable. Failure is non-fatal; we always have the heuristic result.
    if (local.confidence < 0.6) {
      try {
        const bridgeRes = await fetch(`${BRIDGE_BASE}/api/ingest/interpret`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown }),
        });
        if (bridgeRes.ok) {
          const llm = await bridgeRes.json().catch(() => null);
          if (llm && llm.fields) {
            // Take whichever field has higher confidence; LLM tends to win on summaries.
            const fields = ['projectName', 'projectType', 'summary', 'dataModel', 'constraints', 'successCriteria'];
            for (const f of fields) {
              const localF = merged[f];
              const llmF = llm.fields[f];
              if (llmF && llmF.value && (!localF || localF.confidence < llmF.confidence)) {
                merged[f] = { value: String(llmF.value), confidence: Number(llmF.confidence) || 0.7 };
              }
            }
            if (llm.fields.stackHints && Array.isArray(llm.fields.stackHints.value)) {
              const combined = new Set([...(merged.stackHints.value || []), ...llm.fields.stackHints.value]);
              merged.stackHints = {
                value: Array.from(combined),
                confidence: Math.max(merged.stackHints.confidence || 0, llm.fields.stackHints.confidence || 0.7),
              };
            }
            aggregateConfidence = Math.max(aggregateConfidence, llm.confidence || 0);
          }
        }
      } catch {
        /* bridge offline — heuristic result stands */
      }
    }

    const payload = {
      kind: local.classification.kind,
      signals: local.classification.signals,
      confidence: aggregateConfidence,
      fields: merged,
    };

    if (ingestMode === 'reconcile') {
      // Surface phases (extracted by prdInterpreter) so the reconciler can
      // emit a phaseQueue when the PRD has multiple top-level Phase headings.
      const reconcilerInput = { ...merged, phases: local.phases || [] };
      payload.reconciled = reconcileToPlan(markdown, reconcilerInput);
      payload.featureRequest = reconcileToFeatureRequest(merged, markdown);
      // Also surface phases at top level for any client that wants to display
      // "N phases detected" without inspecting the reconciled bundle.
      payload.phases = local.phases || [];
    }

    logActivity('ingest', `PRD ingest (${ingestMode}, kind=${payload.kind}, conf=${aggregateConfidence.toFixed(2)})`, 'ok');
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ingest/sample', (req, res) => {
  try {
    if (!fs.existsSync(HR_PRD_PATH)) {
      return res.status(404).json({ error: 'HR_Platform_PRD.md not found at repo root' });
    }
    const markdown = fs.readFileSync(HR_PRD_PATH, 'utf-8');
    res.json({ markdown, source: 'HR_Platform_PRD.md' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// PROJECT SETUP WIZARD
// ============================================================================

const WIZARD_OPTIONS_PATH = path.join(__dirname, 'wizard-options.json');

app.get('/api/wizard/options', (req, res) => {
  try {
    if (!fs.existsSync(WIZARD_OPTIONS_PATH)) {
      return res.status(500).json({ error: 'wizard-options.json missing' });
    }
    res.json(parseJsonSafe(fs.readFileSync(WIZARD_OPTIONS_PATH, 'utf-8')));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** Build the rich FEATURE_REQUEST.md body from the wizard's structured config. */
function buildFeatureRequest(cfg) {
  const lines = [];
  const summary = cfg.summary && cfg.summary.trim() ? cfg.summary.trim() : '(no summary provided)';
  lines.push('# Feature Request — Project Setup');
  lines.push('');
  lines.push('## What to build');
  lines.push('');
  lines.push(summary);
  lines.push('');

  const blocks = [];
  if (cfg.projectName)              blocks.push(['Project name', cfg.projectName]);
  if (cfg.projectType)              blocks.push(['Project type', cfg.projectType]);

  if (cfg.backend && cfg.backend.framework && cfg.backend.framework !== 'none') {
    const b = cfg.backend;
    const parts = [b.framework];
    if (b.frameworkVersion) parts.push(`v${b.frameworkVersion}`);
    if (b.languageVersion)  parts.push(`(${b.language || ''} ${b.languageVersion})`.trim());
    blocks.push(['Backend', parts.join(' ')]);
    if (b.extras && b.extras.length) blocks.push(['Backend extras', b.extras.join(', ')]);
  }

  if (cfg.frontend && cfg.frontend.framework && cfg.frontend.framework !== 'none') {
    const f = cfg.frontend;
    blocks.push(['Frontend', f.framework]);
    if (f.uiLibrary && f.uiLibrary !== 'none')      blocks.push(['UI library', f.uiLibrary]);
    if (f.stateManagement && f.stateManagement !== 'none') blocks.push(['State management', f.stateManagement]);
  }

  if (cfg.mobile && cfg.mobile.framework && cfg.mobile.framework !== 'none') {
    const m = cfg.mobile;
    const parts = [m.framework];
    if (m.frameworkVersion) parts.push(m.frameworkVersion);
    blocks.push(['Mobile', parts.join(' ')]);
    if (m.extras && m.extras.length) blocks.push(['Mobile extras', m.extras.join(', ')]);
  }

  // Game (V6.2) — surface engine + target so the Director writes a
  // game-appropriate PHASE_PLAN instead of inventing a backend stack.
  if (cfg.game && cfg.game.engine) {
    const g = cfg.game;
    const parts = [g.engine];
    if (g.languageVersion) parts.push(`(${g.language || ''} ${g.languageVersion})`.trim());
    blocks.push(['Game engine', parts.join(' ')]);
    if (g.target)  blocks.push(['Target platform', g.target]);
    if (g.extras && g.extras.length) blocks.push(['Engine extras', g.extras.join(', ')]);
  }

  if (cfg.database && cfg.database.primary && cfg.database.primary !== 'none') {
    const d = cfg.database;
    blocks.push(['Primary database', d.primary]);
    if (d.cache && d.cache !== 'none') blocks.push(['Cache layer', d.cache]);
    if (d.orm)                         blocks.push(['ORM / data access', d.orm]);
  }

  if (cfg.auth && cfg.auth !== 'none')                     blocks.push(['Authentication', cfg.auth]);
  if (cfg.infrastructure) {
    const i = cfg.infrastructure;
    if (i.ci && i.ci !== 'none')                           blocks.push(['CI / CD', i.ci]);
    if (i.containerization && i.containerization !== 'none') blocks.push(['Containerization', i.containerization]);
    if (i.hosting)                                          blocks.push(['Hosting target', i.hosting]);
  }
  if (cfg.testing) {
    if (cfg.testing.unit) blocks.push(['Unit testing', cfg.testing.unit]);
    if (cfg.testing.e2e && cfg.testing.e2e !== 'none') blocks.push(['E2E testing', cfg.testing.e2e]);
  }

  if (blocks.length) {
    lines.push('## Stack & decisions (locked-in from setup wizard)');
    lines.push('');
    lines.push('| Item | Choice |');
    lines.push('|------|--------|');
    for (const [k, v] of blocks) lines.push(`| **${k}** | ${v} |`);
    lines.push('');
  }

  if (cfg.dataModel && cfg.dataModel.trim()) {
    lines.push('## Data model / entities');
    lines.push('');
    lines.push(cfg.dataModel.trim());
    lines.push('');
  }

  if (cfg.constraints && cfg.constraints.trim()) {
    lines.push('## Constraints / requirements');
    lines.push('');
    lines.push(cfg.constraints.trim());
    lines.push('');
  }

  lines.push('## Success criteria');
  lines.push('');
  if (cfg.successCriteria && cfg.successCriteria.trim()) {
    lines.push(cfg.successCriteria.trim());
  } else {
    lines.push('- Project scaffolds cleanly with the chosen stack.');
    lines.push('- Core feature described above is functional and demoable.');
    lines.push('- Tests for the chosen unit framework pass on a fresh checkout.');
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('_Generated by the dashboard\'s Project Setup wizard. The Director must respect every locked-in choice above when writing PHASE_PLAN.md._');
  return lines.join('\n');
}

app.post('/api/wizard/start', async (req, res) => {
  const cfg = req.body || {};
  if (!cfg.summary || !cfg.summary.trim()) {
    return res.status(400).json({ error: 'summary is required (one-line description of what to build)' });
  }
  // Always build the feature request first so we can echo it back even if the
  // bridge is unreachable — the dashboard's "Preview" button relies on this.
  const featureRequest = buildFeatureRequest(cfg);
  const stackSummary = [
    cfg.backend && cfg.backend.framework  && cfg.backend.framework  !== 'none' && cfg.backend.framework,
    cfg.frontend && cfg.frontend.framework && cfg.frontend.framework !== 'none' && cfg.frontend.framework,
    cfg.mobile && cfg.mobile.framework   && cfg.mobile.framework   !== 'none' && cfg.mobile.framework,
    cfg.game && cfg.game.engine          && cfg.game.engine,
    cfg.database && cfg.database.primary && cfg.database.primary !== 'none' && cfg.database.primary,
  ].filter(Boolean).join(' + ');

  const proxyBody = {
    featureRequest,
    autonomy: cfg.autonomy || 'semi-auto',
    stack: stackSummary || undefined,
  };

  // V6 Phase A: pass-through PRD-ingest extras when present
  if (typeof cfg.prefilledFeatureRequest === 'string' && cfg.prefilledFeatureRequest.trim()) {
    proxyBody.prefilledFeatureRequest = cfg.prefilledFeatureRequest;
  }
  if (cfg.reconciledPlan && typeof cfg.reconciledPlan === 'object' &&
      typeof cfg.reconciledPlan.phasePlan === 'string' &&
      typeof cfg.reconciledPlan.detailedPlan === 'string' &&
      typeof cfg.reconciledPlan.planReview === 'string') {
    proxyBody.reconciledPlan = cfg.reconciledPlan;
  }

  try {
    const r = await fetch(`${BRIDGE_BASE}/api/cycle/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proxyBody),
    });
    const data = await r.json().catch(() => ({}));
    logActivity('wizard', `Project setup wizard started cycle (${stackSummary || 'no stack hints'})`, r.ok ? 'ok' : 'fail');
    return res.status(r.ok ? 200 : r.status).json({ ...data, generatedFeatureRequest: featureRequest });
  } catch (err) {
    // Bridge unreachable — still echo the FEATURE_REQUEST so the user can copy it.
    return res.status(503).json({
      error: 'Bridge unreachable. Start the Roo Code extension in VS Code.',
      detail: err.message,
      generatedFeatureRequest: featureRequest,
    });
  }
});

// ============================================================================
// DOCTOR — diagnoses current state and returns one-click fix actions
// ============================================================================

function diagnose() {
  const issues = [];
  const status = readStatus();
  const activeDir = path.join(WORKFLOW_DIR, 'ACTIVE');

  // Issue: no workspace at all
  if (!fs.existsSync(WORKFLOW_DIR)) {
    issues.push({
      severity: 'fatal',
      title: 'No WORKFLOW directory',
      message: 'The orchestrator state directory does not exist. The workflow has never been initialized in this folder.',
      fixes: [{ label: 'Run init-workflow.ps1 (terminal)', action: 'shell', command: '.\\init-workflow.ps1' }],
    });
    return { state: status, issues };
  }

  // Issue: BLOCKED
  if (status.status === 'BLOCKED') {
    const escalationPath = path.join(activeDir, 'ESCALATION.md');
    const escalationExists = fs.existsSync(escalationPath);
    const fixes = [
      { label: 'Resume after manual fix', action: 'http', method: 'POST', url: '/api/resume', confirm: 'You should have addressed the underlying issue first. Continue?' },
      { label: 'Undo last transition',    action: 'http', method: 'POST', url: '/api/undo' },
      { label: 'Reset to INIT (loses ACTIVE files)', action: 'http', method: 'POST', url: '/api/reset', confirm: 'This deletes WORKFLOW/ACTIVE/* — sure?' },
    ];
    if (escalationExists) {
      fixes.unshift({ label: 'Open ESCALATION.md', action: 'open', target: escalationPath });
    }
    issues.push({
      severity: 'fatal',
      title: 'Workflow BLOCKED at ' + (status.currentState || 'unknown'),
      message: status.blockedReason || 'No reason recorded. Check ESCALATION.md.',
      fixes,
    });
  }

  // Issue: stuck in a state but no expected output file yet
  const expectedOutputs = {
    PHASE_PLANNING:    'PHASE_PLAN.md',
    DETAILED_PLANNING: 'DETAILED_PLAN.md',
    PLAN_REVIEW:       'PLAN_REVIEW.md',
    EXECUTION:         'EXECUTION_REPORT.md',
    EXECUTION_REVIEW:  'EXECUTION_REVIEW.md',
  };
  const expected = expectedOutputs[status.currentState];
  if (expected && status.status !== 'BLOCKED') {
    const exists = fs.existsSync(path.join(activeDir, expected));
    if (!exists) {
      issues.push({
        severity: 'warn',
        title: `Awaiting ${status.nextMode || 'agent'} to write ${expected}`,
        message: `State is ${status.currentState}. The active mode is ${status.nextMode}. Once that mode produces ${expected}, run -Next to advance.`,
        fixes: [
          { label: `Switch agent to ${status.nextMode || 'director'}`, action: 'http', method: 'POST', url: '/api/mode/switch', body: { mode: (status.nextMode || 'director').toLowerCase() } },
          { label: 'Send the suggested prompt to the agent (chat)', action: 'note', target: 'Open the AGENT CHAT panel and click "Send to Agent" — the suggested prompt is already loaded.' },
          { label: 'Undo this transition',                          action: 'http', method: 'POST', url: '/api/undo' },
        ],
      });
    } else {
      issues.push({
        severity: 'info',
        title: `${expected} present — ready to advance`,
        message: `Run -Next to validate the gate and transition out of ${status.currentState}.`,
        fixes: [{ label: 'Run -Next', action: 'http', method: 'POST', url: '/api/next' }],
      });
    }
  }

  // Issue: schemaVersion drift
  if (status.schemaVersion && status.schemaVersion > 1) {
    issues.push({
      severity: 'warn',
      title: `Status schema is newer (v${status.schemaVersion}) than this orchestrator (v1)`,
      message: 'A newer version of the orchestrator wrote this state file. Some fields may not be recognised.',
      fixes: [{ label: 'Pull latest from GitHub (terminal)', action: 'shell', command: 'git pull' }],
    });
  }

  // Issue: lock file present (might be stale)
  const lockPath = path.join(WORKFLOW_DIR, '.lock');
  if (fs.existsSync(lockPath)) {
    let ageMs = 0;
    try { ageMs = Date.now() - fs.statSync(lockPath).mtimeMs; } catch {}
    if (ageMs > 60_000) {
      issues.push({
        severity: 'warn',
        title: 'Stale orchestrator lock detected',
        message: `WORKFLOW/.lock is ${Math.round(ageMs/1000)}s old. The orchestrator considers >60s stale and will auto-clean it on next run.`,
        fixes: [{ label: 'Delete the lock now', action: 'http', method: 'DELETE', url: '/api/doctor/lock' }],
      });
    }
  }

  // Issue: bridge offline (extension not loaded)
  // We surface this as info — many people will use the orchestrator without VS Code open
  // We don't synchronously check here (would block the diagnose call); the dashboard probes /api/mode/current

  // High retry count
  if ((status.retryCount || 0) >= 3 && status.status !== 'BLOCKED') {
    issues.push({
      severity: 'warn',
      title: `Retry count is high (${status.retryCount}/5)`,
      message: 'Two more failed reviews and the workflow will hard-block. Consider resolving the underlying issue manually.',
      fixes: [
        { label: 'Show current PLAN_REVIEW.md or EXECUTION_REVIEW.md', action: 'note', target: 'Open the file and read the NEEDS_REVISION feedback.' },
        { label: 'Reset retry counter (-Resume)', action: 'http', method: 'POST', url: '/api/resume' },
      ],
    });
  }

  if (issues.length === 0) {
    issues.push({
      severity: 'info',
      title: 'No issues detected',
      message: status.currentState === 'COMPLETE'
        ? 'Cycle complete. Use the New Project wizard or Reset to start the next one.'
        : 'Workflow is healthy. Continue with the next phase.',
      fixes: status.currentState === 'COMPLETE'
        ? [{ label: 'Reset to INIT', action: 'http', method: 'POST', url: '/api/reset' }]
        : [],
    });
  }

  return { state: status, issues };
}

app.get('/api/doctor', (req, res) => {
  try { res.json(diagnose()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/doctor/lock', (req, res) => {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
      logActivity('doctor', 'Stale lock file deleted', 'ok');
      res.json({ success: true });
    } else {
      res.json({ success: true, note: 'no lock file present' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================================
// START
// ============================================================================

startFileWatcher();

app.listen(PORT, HOST, () => {
  console.log(`\n  ==================================================`);
  console.log(`     Workflow Command Center v3.2.0 on ${HOST}:${PORT}`);
  console.log(`     -> http://localhost:${PORT}`);
  console.log(`     -> SSE: /api/events  |  REST: /api/*`);
  console.log(`     -> CORS: localhost only  |  Bind: ${HOST}`);
  console.log(`  ==================================================\n`);
});
