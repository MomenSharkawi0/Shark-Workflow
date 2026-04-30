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
function startFileWatcher() {
  setInterval(() => {
    try {
      if (!fs.existsSync(STATUS_FILE)) return;
      const raw = fs.readFileSync(STATUS_FILE, 'utf-8');
      const hash = Buffer.from(raw).toString('base64').slice(0, 32);
      if (hash !== lastStatusHash) {
        lastStatusHash = hash;
        const data = JSON.parse(raw);
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
          autopilot: data.autopilot
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

function readStatus() {
  const defaultStatus = {
    currentState: 'INIT', previousState: '', phase: '', cycleStart: '',
    lastTransition: '', transitionCount: 0, retryCount: 0, nextAction: '',
    nextMode: '', status: 'IN_PROGRESS', blockedReason: '', autopilot: false
  };
  if (!fs.existsSync(STATUS_FILE)) return defaultStatus;

  let retries = 3;
  while (retries > 0) {
    try {
      const raw = fs.readFileSync(STATUS_FILE, 'utf-8');
      if (raw.trim()) return JSON.parse(raw);
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
    const metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));
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
        const metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));
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
      const bridgeRes = await fetch('http://127.0.0.1:3001/bridge/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
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

app.post('/api/send-message', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Missing message' });
    
    // Forward to WorkflowBridge running inside VS Code extension
    const bridgeRes = await fetch('http://127.0.0.1:3001/bridge/send', {
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
