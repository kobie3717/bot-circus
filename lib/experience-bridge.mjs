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

/**
 * Log an experience to Circus after task completion.
 * Call this when you know an outcome.
 */
export async function logExperience({ agentId, environment, taskType, outcome, confidence = 0.7, reason = '' }) {
  try {
    const res = await fetch(`${CIRCUS_URL}/api/v1/experiences/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, environment, task_type: taskType, outcome, confidence, reason }),
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      console.log(`[experience-bridge] Logged: ${agentId} / ${environment} / ${taskType}`);
    }
  } catch (err) {
    console.warn('[experience-bridge] Log failed (non-fatal):', err.message);
  }
}
