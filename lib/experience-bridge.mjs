/**
 * experience-bridge.mjs
 * Query Circus agent experiences and format for injection into bot system prompts.
 */

const CIRCUS_URL = process.env.CIRCUS_URL || 'http://127.0.0.1:6200';

/**
 * Detect task type from message text.
 * Returns one of: debug, code-review, deployment, research, scheduling, general
 */
export function detectTaskType(message) {
  const m = message.toLowerCase();
  if (/debug|error|crash|fix|broken|fail|traceback|exception/.test(m)) return 'debug';
  if (/review|pr|pull request|code|refactor/.test(m)) return 'code-review';
  if (/deploy|ship|release|push|prod/.test(m)) return 'deployment';
  if (/research|find|search|look up|investigate|market|compare/.test(m)) return 'research';
  if (/schedule|remind|cron|daily|weekly|alert|monitor/.test(m)) return 'scheduling';
  return 'general';
}

/**
 * Detect environment from message text.
 * Returns env name or null if can't determine.
 */
export function detectEnvironment(message) {
  const m = message.toLowerCase();
  if (/hydra.note|hydranote/.test(m)) return 'hydra-note';
  if (/whatsauction|auction/.test(m)) return 'whatsauction-backend';
  if (/circus/.test(m)) return 'circus';
  if (/relay/.test(m)) return 'relay';
  if (/flashvault|vpn/.test(m)) return 'flashvault';
  if (/whatshub/.test(m)) return 'whatshub';
  return null;
}

/**
 * Query experiences from Circus API.
 * Returns formatted string for injection, or empty string if nothing relevant.
 */
export async function buildExperienceContext(message, agentId = null) {
  try {
    const taskType = detectTaskType(message);
    const environment = detectEnvironment(message);

    if (!environment && taskType === 'general') return ''; // nothing specific enough

    const params = new URLSearchParams({ min_confidence: '0.6' });
    if (environment) params.set('environment', environment);
    if (taskType !== 'general') params.set('task_type', taskType);

    const res = await fetch(`${CIRCUS_URL}/api/v1/experiences/query?${params}`, {
      signal: AbortSignal.timeout(3000)
    });

    if (!res.ok) return '';

    const data = await res.json();
    const experiences = data.experiences || [];

    if (experiences.length === 0) return '';

    // Filter out this agent's own experiences (they already know what worked for them)
    const peerExperiences = agentId
      ? experiences.filter(e => e.agent_id !== agentId)
      : experiences;

    if (peerExperiences.length === 0) return '';

    // Format top 3 most confident experiences
    const top = peerExperiences.slice(0, 3);
    const lines = top.map(e => {
      const who = e.agent_name || e.agent_id.split('-')[0]; // Use full name if available
      const obs = e.observations > 1 ? ` (${e.observations} observations)` : '';
      const score = typeof e.outcome === 'number' ? ` [score: ${(e.outcome * 100).toFixed(0)}%]` : '';
      const worked = e.what_worked ? `✓ ${e.what_worked}` : '';
      const failed = e.what_failed ? `✗ ${e.what_failed}` : '';
      const details = [worked, failed].filter(Boolean).join(' | ');
      return `- **${who}** on ${e.task_type} in ${e.environment}${score}${obs} — confidence ${(e.confidence * 100).toFixed(0)}%\n  ${details || 'no details'}`;
    });

    return `\n<peer-experiences>\nWhat worked for other agents on similar tasks:\n${lines.join('\n')}\n</peer-experiences>`;
  } catch (err) {
    // Non-fatal — never block bot on experience lookup
    console.warn('[experience-bridge] Query failed (non-fatal):', err.message);
    return '';
  }
}

// Ring token for authenticated API calls
let _circusToken = null;

/**
 * Set the ring token for authenticated Circus API calls.
 * Call this after circusRegister() succeeds in your bot.
 */
export function setCircusToken(token) {
  _circusToken = token;
}

// Experience queue for async publishing (DeLM Phase 4)
const _experienceQueue = [];
let _flushTimer = null;

function _scheduleFlush() {
  if (_flushTimer) return; // Already scheduled
  _flushTimer = setTimeout(async () => {
    _flushTimer = null;
    await _flushExperienceQueue();
  }, 30000); // Flush after 30s idle
}

async function _flushExperienceQueue() {
  if (_experienceQueue.length === 0) return;

  // Take up to 10
  const batch = _experienceQueue.splice(0, 10);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (_circusToken) headers['Authorization'] = `Bearer ${_circusToken}`;

    const res = await fetch(`${CIRCUS_URL}/api/v1/experiences/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ experiences: batch.map(e => e.payload) }),
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[experience-bridge] Batch flushed: ${data.accepted} accepted, ${data.rejected} rejected`);
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn('[experience-bridge] Batch flush failed (non-fatal):', err.message);
    // Re-queue with retry count (max 3 retries)
    const toRequeue = batch.filter(e => (e._retries || 0) < 3);
    toRequeue.forEach(e => { e._retries = (e._retries || 0) + 1; });
    _experienceQueue.unshift(...toRequeue); // Put back at front
  }

  // If more items remain, flush again
  if (_experienceQueue.length > 0) {
    await _flushExperienceQueue();
  }
}

/**
 * Log an experience to Circus after task completion.
 * Call this when you know an outcome.
 * (DeLM Phase 4: Fire-and-forget async queue with batch flush)
 */
export async function logExperience({ agentId, environment, taskType, outcome, confidence = 0.7, reason = '' }) {
  // Map to LogExperienceRequest schema
  const payload = {
    environment,
    task_type: taskType,
    what_worked: outcome === 'success' || outcome >= 0.7 ? reason : null,
    what_failed: outcome === 'failure' || outcome < 0.5 ? reason : null,
    outcome: typeof outcome === 'number' ? outcome : (outcome === 'success' ? 0.8 : 0.3),
    confidence
  };

  _experienceQueue.push({ payload, _retries: 0 });
  console.log(`[experience-bridge] Queued: ${environment}/${taskType} (queue size: ${_experienceQueue.length})`);

  // Flush immediately if queue is large enough
  if (_experienceQueue.length >= 5) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
    // Don't await — fire and forget
    _flushExperienceQueue().catch(err => console.warn('[experience-bridge] Immediate flush error:', err.message));
  } else {
    _scheduleFlush();
  }
  // Return immediately — no waiting
}

/**
 * Flush pending experiences (for graceful shutdown).
 */
export async function flushExperiences() {
  clearTimeout(_flushTimer);
  _flushTimer = null;
  await _flushExperienceQueue();
}

/**
 * Unfold a memory to get more detail (DeLM Phase 1).
 * @param {string} memoryId - The memory ID to unfold
 * @param {string} level - 'summary' or 'raw'
 * @param {string} ringToken - Ring token for auth (optional, uses global if not provided)
 * @returns {Promise<object|null>} Unfolded memory or null on error
 */
export async function unfoldMemory(memoryId, level = 'summary', ringToken = null) {
  const token = ringToken || _circusToken;
  try {
    const res = await fetch(
      `${CIRCUS_URL}/api/v1/memory-commons/unfold?memory_id=${encodeURIComponent(memoryId)}&level=${level}`,
      {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(5000)
      }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
