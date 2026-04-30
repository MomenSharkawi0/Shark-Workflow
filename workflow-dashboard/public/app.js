/**
 * Workflow Command Center — Frontend Application v5.0
 * ============================================================================
 * Real-time dashboard with SSE-powered live updates.
 * Features: Pipeline stepper, metrics, activity feed, quality gates, controls,
 *           progress estimation (6d), chat interface (3c), bridge status.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const STATES = ['INIT','PHASE_PLANNING','DETAILED_PLANNING','PLAN_REVIEW','EXECUTION','EXECUTION_REVIEW','ARCHIVE','COMPLETE'];
const STATE_LABELS = ['Init','Phase Plan','Detail Plan','Review','Execute','Exec Review','Archive','Complete'];

const PROMPTS = {
  'INIT': 'Please provide a feature request to the Director. Describe the feature you want built, including scope and success criteria.',
  'PHASE_PLANNING': 'Switch to Director mode. Read the feature request, WORKFLOW/LESSONS_LEARNED.md, and WORKFLOW/PHASE_DNA.md. Then generate WORKFLOW/ACTIVE/PHASE_PLAN.md with a high-level phase plan (max 10 lines per phase). When done, tell the user to run orchestrator.ps1 -Next.',
  'DETAILED_PLANNING': 'Switch to Planner mode. Read WORKFLOW/ACTIVE/PHASE_PLAN.md, WORKFLOW/LESSONS_LEARNED.md, and all relevant project files. Generate WORKFLOW/ACTIVE/DETAILED_PLAN.md with full implementation steps, file list, risk assessments, and test plan. When done, tell the user to run orchestrator.ps1 -Next.',
  'PLAN_REVIEW': 'Switch to Director mode. Read WORKFLOW/ACTIVE/DETAILED_PLAN.md and evaluate it. Write WORKFLOW/ACTIVE/PLAN_REVIEW.md with STATUS: APPROVED or NEEDS_REVISION. If approved, copy DETAILED_PLAN.md to PLAN_APPROVED.md. When done, tell the user to run orchestrator.ps1 -Next.',
  'EXECUTION': 'Switch to Executor mode. Read WORKFLOW/ACTIVE/PLAN_APPROVED.md and implement EXACTLY what is planned. Run tests after every change. Write WORKFLOW/ACTIVE/EXECUTION_REPORT.md with results. When done, tell the user to run orchestrator.ps1 -Next.',
  'EXECUTION_REVIEW': 'Switch to Director mode. Read WORKFLOW/ACTIVE/EXECUTION_REPORT.md and WORKFLOW/ACTIVE/EXECUTION_DIFF.diff. FIRST update LESSONS_LEARNED.md and PHASE_DNA.md with learnings. THEN write WORKFLOW/ACTIVE/EXECUTION_REVIEW.md with STATUS: APPROVED or NEEDS_REVISION. When done, tell the user to run orchestrator.ps1 -Next.',
  'ARCHIVE': 'Switch to Director mode. Read all WORKFLOW/ACTIVE/*.md files. Verify LESSONS_LEARNED.md and PHASE_DNA.md are up to date. Do NOT move files. Then tell the user to run orchestrator.ps1 -Next.',
  'COMPLETE': '✅ Workflow complete! All files have been archived. Use "Reset Workflow" to start a new feature cycle.'
};

// ============================================================================
// STATE
// ============================================================================

let currentState = 'INIT';
let eventSource = null;
let reconnectAttempts = 0;
let avgDurationMin = 0;
const MAX_RECONNECT = 10;

// ============================================================================
// SSE CONNECTION
// ============================================================================

function connectSSE() {
  if (eventSource) { eventSource.close(); }

  eventSource = new EventSource('/api/events');

  eventSource.onopen = () => {
    reconnectAttempts = 0;
    setConnectionStatus(true);
    logToFeed('Connected to server via SSE', 'ok');
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case 'connected':
          setConnectionStatus(true);
          break;
        case 'status_change':
          handleStatusUpdate(data);
          break;
        case 'activity':
          addActivityEntry(data);
          break;
        case 'chat_message':
          addChatBubble(data);
          break;
        case 'chat_cleared':
          clearChatUI();
          break;
      }
    } catch {}
  };

  eventSource.onerror = () => {
    setConnectionStatus(false);
    eventSource.close();
    reconnectAttempts++;
    if (reconnectAttempts <= MAX_RECONNECT) {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 15000);
      logToFeed(`Connection lost. Retrying in ${Math.round(delay / 1000)}s... (${reconnectAttempts}/${MAX_RECONNECT})`, 'warn');
      setTimeout(connectSSE, delay);
    } else {
      logToFeed('Max reconnection attempts reached. Refresh the page.', 'fail');
    }
  };
}

function setConnectionStatus(connected) {
  const dot = document.getElementById('connectionDot');
  const label = document.getElementById('connectionLabel');
  if (connected) {
    dot.className = 'connection-dot connected';
    label.textContent = 'Live';
    label.style.color = 'var(--accent-emerald)';
  } else {
    dot.className = 'connection-dot disconnected';
    label.textContent = 'Offline';
    label.style.color = 'var(--accent-red)';
  }
}

// ============================================================================
// STATUS UPDATE HANDLER (from SSE)
// ============================================================================

function handleStatusUpdate(data) {
  const state = data.currentState || 'INIT';
  currentState = state;

  buildStepper(state);

  document.getElementById('metricState').textContent = state.replace(/_/g, ' ');

  const status = data.status || 'IN_PROGRESS';
  const badge = document.getElementById('statusBadge');
  badge.textContent = status;
  badge.className = getStatusBadgeClass(status);

  const cycleStartEl = document.getElementById('metricCycleStart');
  cycleStartEl.textContent = formatDate(data.cycleStart);
  cycleStartEl.dataset.iso = data.cycleStart;
  document.getElementById('metricElapsed').textContent = getElapsed(data.cycleStart);
  document.getElementById('metricTransitions').textContent = data.transitionCount || '0';
  document.getElementById('metricRetries').textContent = data.retryCount || '0';
  document.getElementById('promptArea').textContent = PROMPTS[state] || 'No prompt available for this state.';

  // Blocked alert
  const blockedAlert = document.getElementById('blockedAlert');
  if (status === 'BLOCKED') {
    blockedAlert.classList.remove('hidden');
    document.getElementById('blockedReason').textContent = data.blockedReason || 'No reason specified.';
  } else {
    blockedAlert.classList.add('hidden');
  }

  // Autopilot sync
  const toggle = document.getElementById('autopilotToggle');
  const track = document.getElementById('autopilotTrack');
  if (toggle.dataset.updating !== 'true') {
    toggle.checked = !!data.autopilot;
    if (data.autopilot) { track.classList.add('on'); } else { track.classList.remove('on'); }
  }

  // Refresh progress estimation on state change
  loadProgress();
}

// ============================================================================
// STEPPER
// ============================================================================

function buildStepper(activeState) {
  const container = document.getElementById('stepper');
  container.innerHTML = '';
  const idx = STATES.indexOf(activeState);

  STATES.forEach((s, i) => {
    const status = i < idx ? 'done' : i === idx ? 'active' : 'pending';

    const wrapper = document.createElement('div');
    wrapper.className = 'step-wrapper';

    const dot = document.createElement('div');
    dot.className = 'step-dot ' + status;
    dot.innerHTML = `<span>${i < idx ? '✓' : (i + 1)}</span>`;
    dot.title = s;

    const label = document.createElement('span');
    label.className = 'step-label ' + status;
    label.textContent = STATE_LABELS[i];

    wrapper.appendChild(dot);
    wrapper.appendChild(label);
    container.appendChild(wrapper);

    if (i < STATES.length - 1) {
      const conn = document.createElement('div');
      conn.className = 'step-connector ' + (i < idx ? 'done' : i === idx ? 'active' : 'pending');
      container.appendChild(conn);
    }
  });
}

// ============================================================================
// ACTIVITY FEED
// ============================================================================

function addActivityEntry(entry) {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;

  // Remove "no activity" placeholder
  const placeholder = feed.querySelector('.feed-placeholder');
  if (placeholder) placeholder.remove();

  const row = document.createElement('div');
  row.className = 'activity-row card-enter';

  const levelColors = {
    ok: 'var(--accent-emerald)', info: 'var(--text-dim)', warn: 'var(--accent-amber)',
    fail: 'var(--accent-red)', gate: 'var(--accent-indigo)'
  };
  const levelIcons = {
    ok: '✓', info: 'ℹ', warn: '⚠', fail: '✗', gate: '🛡', command: '⌘', log: '›'
  };

  const color = levelColors[entry.level] || 'var(--text-dim)';
  const icon = levelIcons[entry.type] || levelIcons[entry.level] || '›';
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';

  row.innerHTML = `
    <span class="feed-icon" style="color:${color}">${icon}</span>
    <span class="feed-time">${time}</span>
    <span class="feed-msg" style="color:${color === 'var(--text-dim)' ? 'var(--text-secondary)' : color}">${escapeHtml(entry.message)}</span>
  `;

  feed.insertBefore(row, feed.firstChild);

  // Cap at 100 entries
  while (feed.children.length > 100) feed.removeChild(feed.lastChild);
}

function logToFeed(message, level = 'info') {
  addActivityEntry({ timestamp: new Date().toISOString(), type: 'system', message, level });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================================
// PROGRESS ESTIMATION (Phase 6d)
// ============================================================================

async function loadProgress() {
  try {
    const res = await fetch('/api/progress');
    const data = await res.json();
    updateProgressRing(data);
  } catch {}
}

function updateProgressRing(data) {
  const arc = document.getElementById('progressArc');
  const percentEl = document.getElementById('progressPercent');
  const etaEl = document.getElementById('progressEta');
  const confEl = document.getElementById('progressConfidence');

  if (!arc || !percentEl) return;

  const circumference = 2 * Math.PI * 34; // r=34
  const percent = data.percentComplete || 0;
  const offset = circumference - (percent / 100) * circumference;

  arc.style.strokeDasharray = circumference;
  arc.style.strokeDashoffset = offset;

  // Use inline gradient since SVG gradient is defined in JS
  if (percent >= 100) {
    arc.style.stroke = '#10b981';
  } else if (percent >= 50) {
    arc.style.stroke = '#6366f1';
  } else {
    arc.style.stroke = '#8b5cf6';
  }

  percentEl.textContent = `${percent}%`;

  // ETA
  if (data.estimatedRemainingMin > 0) {
    const hrs = Math.floor(data.estimatedRemainingMin / 60);
    const mins = data.estimatedRemainingMin % 60;
    etaEl.textContent = hrs > 0 ? `~${hrs}h ${mins}m left` : `~${mins}m left`;
  } else if (data.currentState === 'COMPLETE') {
    etaEl.textContent = 'Done!';
  } else if (data.elapsedMin > 0) {
    const hrs = Math.floor(data.elapsedMin / 60);
    const mins = data.elapsedMin % 60;
    etaEl.textContent = hrs > 0 ? `${hrs}h ${mins}m elapsed` : `${mins}m elapsed`;
  } else {
    etaEl.textContent = '—';
  }

  // Confidence
  if (data.completedCycles > 0) {
    const confEmoji = { high: '🟢', medium: '🟡', low: '🔴' };
    confEl.textContent = `${confEmoji[data.confidence] || '⚪'} ${data.confidence} conf. (${data.completedCycles} cycles)`;
  } else {
    confEl.textContent = 'No historical data';
  }
}

// ============================================================================
// METRICS
// ============================================================================

async function loadMetrics() {
  try {
    const res = await fetch('/api/metrics');
    const data = await res.json();
    avgDurationMin = data.summary?.avgDurationMin || 0;
    renderMetricsSummary(data.summary || {});
  } catch {}
}

function renderMetricsSummary(summary) {
  const el = document.getElementById('metricsSummary');
  if (!el) return;

  el.innerHTML = `
    <div class="metric-mini">
      <span class="label-sm">Cycles</span>
      <span class="metric-mini-value">${summary.totalCycles || 0}</span>
    </div>
    <div class="metric-mini">
      <span class="label-sm">Avg Duration</span>
      <span class="metric-mini-value">${summary.avgDurationMin || 0}m</span>
    </div>
    <div class="metric-mini">
      <span class="label-sm">Total Transitions</span>
      <span class="metric-mini-value">${summary.totalTransitions || 0}</span>
    </div>
    <div class="metric-mini">
      <span class="label-sm">Escalations</span>
      <span class="metric-mini-value ${(summary.escalationCount || 0) > 0 ? 'text-warn' : ''}">${summary.escalationCount || 0}</span>
    </div>
  `;
}

// ============================================================================
// CHAT INTERFACE (Phase 3c)
// ============================================================================

async function loadChatHistory() {
  try {
    const res = await fetch('/api/chat/history?limit=50');
    const data = await res.json();
    if (data.messages && data.messages.length > 0) {
      const container = document.getElementById('chatMessages');
      container.innerHTML = '';
      data.messages.forEach(msg => addChatBubble(msg, false));
      scrollChatToBottom();
    }
  } catch {}
}

function addChatBubble(msg, scroll = true) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  // Remove empty state
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();

  const isUser = msg.role === 'user';
  const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';

  const row = document.createElement('div');
  row.className = `chat-row ${isUser ? 'chat-row-user' : 'chat-row-agent'}`;

  const statusClass = msg.status || 'sent';
  const statusIcon = { delivered: '✓✓', failed: '✗', sent: '✓' };

  row.innerHTML = `
    <div class="chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-agent'}">
      ${escapeHtml(msg.content)}
    </div>
    <div class="chat-bubble-meta">
      <span>${time}</span>
      ${!isUser ? `<span class="chat-bubble-status ${statusClass}">${statusIcon[statusClass] || '•'}</span>` : ''}
    </div>
  `;

  container.appendChild(row);

  // Cap at 100 messages
  while (container.children.length > 100) container.removeChild(container.firstChild);

  if (scroll) scrollChatToBottom();
}

function scrollChatToBottom() {
  const container = document.getElementById('chatMessages');
  if (container) container.scrollTop = container.scrollHeight;
}

function clearChatUI() {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  container.innerHTML = `
    <div class="chat-empty">
      <svg class="icon-lg" style="color:var(--text-dim);margin-bottom:0.5rem" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
      <p>No messages yet. Send a prompt or type a message below.</p>
    </div>
  `;
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  const btn = document.getElementById('sendChatBtn');
  btn.style.opacity = '0.5';
  btn.style.pointerEvents = 'none';
  input.value = '';

  setFeedback('Sending to agent...');

  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    if (data.success) {
      setFeedback('Message sent ✓');
    } else {
      setFeedback('Send failed ✗');
    }
  } catch (err) {
    setFeedback('Network error');
    appendConsole('Network error: ' + err.message, true);
  }

  btn.style.opacity = '1';
  btn.style.pointerEvents = 'auto';
}

async function clearChatHistory() {
  try {
    await fetch('/api/chat/clear', { method: 'DELETE' });
    clearChatUI();
    setFeedback('Chat cleared');
  } catch {}
}

// ============================================================================
// BRIDGE STATUS
// ============================================================================

async function checkBridgeStatus() {
  const indicator = document.getElementById('bridgeStatus');
  if (!indicator) return;

  try {
    const res = await fetch('http://127.0.0.1:3001/bridge/ping', { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    if (data.ok) {
      indicator.className = 'bridge-indicator connected';
    } else {
      indicator.className = 'bridge-indicator disconnected';
    }
  } catch {
    indicator.className = 'bridge-indicator disconnected';
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function getStatusBadgeClass(status) {
  if (status === 'BLOCKED') return 'status-badge status-badge-blocked';
  if (status === 'COMPLETE') return 'status-badge status-badge-complete';
  return 'status-badge status-badge-progress';
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function getElapsed(iso) {
  if (!iso) return '';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    
    let text = hrs > 0 ? `${hrs}h ${mins % 60}m elapsed` : `${mins}m elapsed`;
    
    if (currentState !== 'COMPLETE' && currentState !== 'INIT' && avgDurationMin > 0) {
      const remaining = Math.max(0, avgDurationMin - mins);
      text += ` (Est: ${remaining}m left)`;
    }
    
    return text;
  } catch { return ''; }
}

function appendConsole(text, isError) {
  const el = document.getElementById('console');
  const line = document.createElement('div');
  line.style.color = isError ? '#f87171' : '#34d399';
  line.textContent = text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function clearConsole() {
  document.getElementById('console').innerHTML = '<div style="color:#475569">$ Console cleared.</div>';
}

function setFeedback(msg) {
  document.getElementById('actionFeedback').textContent = msg;
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

async function runAction(btnId, label, endpoint) {
  const btn = document.getElementById(btnId);
  const originalLabel = btn.querySelector('span').textContent;
  btn.classList.add('btn-loading');
  btn.querySelector('span').textContent = 'Running...';
  setFeedback(`Executing orchestrator ${label}...`);
  appendConsole(`$ powershell.exe orchestrator.ps1 ${label}`, false);

  try {
    const res = await fetch(endpoint, { method: 'POST' });
    const data = await res.json();
    if (data.stdout) appendConsole(data.stdout, false);
    if (data.stderr) appendConsole(data.stderr, true);
    if (data.error) appendConsole('ERROR: ' + data.error, true);
    setFeedback(data.success ? `${label} complete ✓` : `${label} failed ✗`);
  } catch (e) {
    appendConsole('Network error: ' + e.message, true);
    setFeedback('Network error');
  }

  btn.classList.remove('btn-loading');
  btn.querySelector('span').textContent = originalLabel;
}

function triggerNext() { runAction('btnNext', '-Next', '/api/next'); }
function triggerReset() {
  if (!confirm('Reset workflow to INIT? This will clean ACTIVE/ files.')) return;
  runAction('btnReset', '-Reset', '/api/reset');
}
function triggerUndo() { runAction('btnUndo', '-Undo', '/api/undo'); }
function triggerResume() { runAction('btnResume', '-Resume', '/api/resume'); }

async function toggleAutopilot() {
  const toggle = document.getElementById('autopilotToggle');
  const track = document.getElementById('autopilotTrack');
  const newState = toggle.checked ? 'ON' : 'OFF';
  toggle.dataset.updating = 'true';

  try {
    const res = await fetch('/api/autopilot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: newState })
    });
    if (!res.ok) throw new Error('Failed');
    if (newState === 'ON') { track.classList.add('on'); } else { track.classList.remove('on'); }
    setFeedback(`Autopilot turned ${newState}`);
  } catch {
    toggle.checked = !toggle.checked;
    setFeedback('Error toggling autopilot');
  } finally {
    setTimeout(() => { toggle.dataset.updating = 'false'; }, 500);
  }
}

function copyPrompt() {
  const text = document.getElementById('promptArea').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.classList.add('copied');
    btn.querySelector('span').textContent = 'Copied!';
    setTimeout(() => { btn.classList.remove('copied'); btn.querySelector('span').textContent = 'Copy'; }, 2000);
  });
}

async function sendPromptToAgent() {
  const text = document.getElementById('promptArea').textContent;
  const btn = document.getElementById('sendPromptBtn');
  if (btn) {
    btn.classList.add('btn-loading');
    btn.querySelector('span').textContent = 'Sending...';
  }

  // Use the chat/send endpoint to get proper chat history tracking
  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    setFeedback(data.success ? 'Prompt sent to agent ✓' : 'Failed to send ✗');
  } catch {
    setFeedback('Network error');
  }

  if (btn) {
    btn.classList.remove('btn-loading');
    btn.querySelector('span').textContent = 'Sent!';
    setTimeout(() => { btn.querySelector('span').textContent = 'Send to Agent'; }, 2000);
  }
}

// ============================================================================
// NEW: Start Workflow + Mode Switcher
// ============================================================================

function setStartFeedback(msg, kind) {
  const el = document.getElementById('startCycleFeedback');
  if (!el) return;
  el.textContent = msg;
  el.style.color = kind === 'ok' ? 'var(--accent-emerald, #10b981)' :
                   kind === 'fail' ? 'var(--accent-red, #ef4444)' :
                   '';
}

async function startNewCycle() {
  const inputEl = document.getElementById('featureRequestInput');
  const stackEl = document.getElementById('stackHintSelect');
  const autonomyEl = document.getElementById('autonomySelect');
  const btn = document.getElementById('startCycleBtn');

  const featureRequest = (inputEl.value || '').trim();
  if (!featureRequest) { setStartFeedback('Please describe the feature first.', 'fail'); inputEl.focus(); return; }
  if (featureRequest.length < 15) { setStartFeedback('Please be more specific (at least 15 characters).', 'fail'); inputEl.focus(); return; }

  const payload = {
    featureRequest,
    autonomy: autonomyEl ? autonomyEl.value : 'semi-auto',
  };
  if (stackEl && stackEl.value) payload.stack = stackEl.value;

  btn.classList.add('btn-loading');
  btn.querySelector('span').textContent = 'Starting...';
  setStartFeedback('Sending to engine...', '');

  try {
    const res = await fetch('/api/cycle/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.success) {
      setStartFeedback('🚀 Cycle started. Switching to Director and beginning PHASE_PLANNING.', 'ok');
      inputEl.value = '';
      // Refresh current mode display shortly after
      setTimeout(refreshCurrentMode, 800);
    } else {
      setStartFeedback(`❌ ${data.error || 'Failed to start cycle (is the Roo Code extension running?)'}`, 'fail');
    }
  } catch (err) {
    setStartFeedback('❌ Bridge unreachable. Open VS Code with the Roo Code extension.', 'fail');
  } finally {
    btn.classList.remove('btn-loading');
    btn.querySelector('span').textContent = 'Start Workflow';
  }
}

async function abortCurrentCycle() {
  if (!confirm('Abort the current cycle? Files written so far stay; the engine returns to INIT.')) return;
  const btn = document.getElementById('abortCycleBtn');
  btn.classList.add('btn-loading');
  try {
    const res = await fetch('/api/cycle/abort', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    setStartFeedback(res.ok ? 'Cycle aborted.' : `❌ ${data.error || 'Abort failed'}`, res.ok ? 'ok' : 'fail');
  } catch {
    setStartFeedback('❌ Bridge unreachable.', 'fail');
  } finally {
    btn.classList.remove('btn-loading');
  }
}

const MODE_LABELS = {
  'director': '🎯 Director',
  'planner': '📋 Planner',
  'executor': '⚙️ Executor',
  'workflow-master': '🚀 Workflow Master',
  'code': '💻 Code (Roo default)',
  'ask': '❓ Ask (Roo default)',
  'architect': '🏛️ Architect (Roo default)',
  'debug': '🐛 Debug (Roo default)',
};

async function switchMode(mode) {
  const fb = document.getElementById('modeSwitchFeedback');
  fb.textContent = `Switching to ${MODE_LABELS[mode] || mode}...`;
  fb.style.color = '';
  try {
    const res = await fetch('/api/mode/switch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      fb.textContent = `Active mode is now ${MODE_LABELS[mode] || mode}.`;
      fb.style.color = 'var(--accent-emerald, #10b981)';
      updateActiveModeButton(mode);
      const labelEl = document.getElementById('currentModeLabel');
      if (labelEl) labelEl.textContent = MODE_LABELS[mode] || mode;
    } else {
      fb.textContent = `❌ ${data.error || 'Switch failed.'}`;
      fb.style.color = 'var(--accent-red, #ef4444)';
    }
  } catch {
    fb.textContent = '❌ Bridge unreachable. Is Roo Code running?';
    fb.style.color = 'var(--accent-red, #ef4444)';
  }
}

function updateActiveModeButton(mode) {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    if (btn.dataset.mode === mode) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

async function refreshCurrentMode() {
  try {
    const res = await fetch('/api/mode/current');
    if (!res.ok) return;
    const data = await res.json();
    if (data.mode) {
      const labelEl = document.getElementById('currentModeLabel');
      if (labelEl) labelEl.textContent = MODE_LABELS[data.mode] || data.mode;
      updateActiveModeButton(data.mode);
    }
  } catch { /* bridge offline */ }
}

// Poll current mode every 3s so the UI stays accurate
setInterval(refreshCurrentMode, 3000);
// Initial fetch on load
window.addEventListener('DOMContentLoaded', () => setTimeout(refreshCurrentMode, 500));

// ============================================================================
// QUALITY GATES (fallback polling — gate data not yet in SSE)
// ============================================================================

async function fetchGates() {
  try {
    const res = await fetch('/api/quality-gates');
    const data = await res.json();
    const container = document.getElementById('gatesLog');
    if (!data.gates || data.gates.length === 0) {
      container.innerHTML = '<p class="text-xs text-dim">No gate results yet.</p>';
      return;
    }
    container.innerHTML = data.gates.slice(-10).reverse().map(g => {
      const isPass = g.result && g.result.includes('PASS');
      const color = isPass ? '#34d399' : '#f87171';
      const icon = isPass ? '✓' : '✗';
      return `<div class="gate-row">
        <span style="color:${color};font-weight:700;width:1rem">${icon}</span>
        <span class="text-dim" style="width:7rem;flex-shrink:0">${g.timestamp || ''}</span>
        <span style="color:var(--text-secondary);flex:1">${g.gate || ''}</span>
        <span class="text-dim">${g.notes || ''}</span>
      </div>`;
    }).join('');
  } catch {}
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  buildStepper('INIT');
  connectSSE();
  loadMetrics();
  loadProgress();
  fetchGates();
  loadChatHistory();
  checkBridgeStatus();

  // Refresh gates, metrics, and progress periodically
  setInterval(() => { fetchGates(); loadMetrics(); loadProgress(); }, 10000);
  // Check bridge status every 15s
  setInterval(checkBridgeStatus, 15000);
  // Update elapsed time counter every 30s
  setInterval(() => {
    const cycleStart = document.getElementById('metricCycleStart').dataset?.iso;
    if (cycleStart) document.getElementById('metricElapsed').textContent = getElapsed(cycleStart);
  }, 30000);
});
