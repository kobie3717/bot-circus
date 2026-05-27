/**
 * circus-bridge.mjs — Shared Circus integration for Friday, Claw, 007
 *
 * Handles: agent registration, preference reading (from DB), preference publishing (signed).
 * All Circus calls are non-fatal — bots work fine if Circus is down.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const execFileAsync = promisify(execFile);

const CIRCUS_URL = 'http://localhost:6200';
const CIRCUS_DB  = '/root/.circus/circus.db';
const OWNER_ID   = 'kobus';
const OWNER_KEY  = '/root/.circus/kobus.key';
const CIRCUS_IDENTITY_DIR = '/root/.circus';

// Runtime state
let _ringToken = null;
let _agentId   = null;
let _agentName  = null;

// Preference cache (1 hour TTL)
let _prefsCache    = null;
let _prefsCacheAt  = 0;
const PREFS_TTL_MS = 60 * 60 * 1000;

// Shared memory count cache — avoids HTTP call when DB is empty
let _sharedMemoryCount = null;
let _sharedMemoryCountAt = 0;
const SHARED_COUNT_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getSharedMemoryCount() {
  if (_sharedMemoryCount !== null && (Date.now() - _sharedMemoryCountAt) < SHARED_COUNT_TTL_MS) {
    return _sharedMemoryCount;
  }
  try {
    const { stdout } = await execFileAsync('sqlite3', [
      CIRCUS_DB, 'SELECT COUNT(*) FROM shared_memories;'
    ], { timeout: 3000 });
    _sharedMemoryCount = parseInt(stdout.trim(), 10) || 0;
    _sharedMemoryCountAt = Date.now();
    return _sharedMemoryCount;
  } catch {
    return 0; // Fail open — if DB unreadable, skip search
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

function getIdentityPath(name) {
  return join(CIRCUS_IDENTITY_DIR, `${name.toLowerCase()}-identity.json`);
}

function loadIdentity(name) {
  const path = getIdentityPath(name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`[Circus] Failed to load identity from ${path}:`, err.message);
    return null;
  }
}

function saveIdentity(name, agentId, ringToken) {
  try {
    mkdirSync(CIRCUS_IDENTITY_DIR, { recursive: true });
    const path = getIdentityPath(name);
    writeFileSync(path, JSON.stringify({
      agent_id: agentId,
      ring_token: ringToken,
      name,
      registered_at: new Date().toISOString()
    }, null, 2));

    // Verify file was actually written
    const saved = existsSync(path);
    if (saved) {
      console.log(`[Circus] ✅ Identity file saved: ${path}`);
    } else {
      console.error(`[Circus] ⚠️ Identity file MISSING after write: ${path}`);
    }
  } catch (err) {
    console.error('[Circus] Failed to save identity (non-fatal):', err.message);
  }
}

async function verifyIdentity(agentId, ringToken) {
  try {
    const res = await fetch(`${CIRCUS_URL}/api/v1/agents/${agentId}`, {
      headers: { 'Authorization': `Bearer ${ringToken}` },
      signal: AbortSignal.timeout(3000)
    });
    return res.ok;
  } catch (err) {
    console.error('[Circus] Identity verification failed:', err.message);
    return false;
  }
}

/**
 * Register this bot with Circus. Call once on startup.
 * Uses persistent identity files to avoid creating new agents on every restart.
 * @param {string} name  e.g. 'Friday' (stable name, no timestamp suffix)
 * @param {string} role  e.g. 'assistant' | 'builder' | 'intelligence'
 */
export async function circusRegister(name, role) {
  // Try to reuse saved identity
  const saved = loadIdentity(name);
  if (saved) {
    const valid = await verifyIdentity(saved.agent_id, saved.ring_token);
    if (valid) {
      _ringToken = saved.ring_token;
      _agentId = saved.agent_id;
      _agentName = name;
      console.log(`[Circus] ✅ Reused identity for ${name} (${saved.agent_id})`);
      return _ringToken;
    }
    console.log(`[Circus] Saved identity invalid, re-registering...`);
  }

  // Register fresh
  try {
    const passport = {
      identity: { name, role },
      capabilities: ['memory', 'preference'],
      predictions: { confirmed: 0, refuted: 0 },
      beliefs: { total: 0, contradictions: 0 },
      memory_stats: { proof_count_avg: 0, graph_connections: 0 },
      score: { total: 5.0 },
      graph_summary: { entities: [] },
      traits: {}
    };

    const res = await fetch(`${CIRCUS_URL}/api/v1/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role, capabilities: ['memory', 'preference'], home: 'http://localhost', passport })
    });

    if (!res.ok) {
      const err = await res.text();
      // Handle 409 conflict (name taken) — shouldn't happen with stable names + identity files
      if (res.status === 409) {
        console.warn(`[Circus] Name ${name} taken, trying with suffix...`);
        const uniqueName = `${name}-${Date.now().toString(36)}`;
        const retryRes = await fetch(`${CIRCUS_URL}/api/v1/agents/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: uniqueName, role, capabilities: ['memory', 'preference'], home: 'http://localhost', passport: { ...passport, identity: { name: uniqueName, role } } })
        });
        if (!retryRes.ok) {
          console.error(`[Circus] Register retry failed ${retryRes.status}: ${await retryRes.text()}`);
          return null;
        }
        const retryData = await retryRes.json();
        _ringToken = retryData.ring_token || retryData.token;
        _agentId = retryData.agent_id || retryData.id || uniqueName;
        _agentName = name;

        if (!_ringToken) {
          console.error('[Circus] Retry response missing token. Got:', JSON.stringify(Object.keys(retryData)));
          return null;
        }

        saveIdentity(name, _agentId, _ringToken);
        console.log(`[Circus] ✅ Registered as ${uniqueName} (${_agentId})`);
        return _ringToken;
      }
      console.error(`[Circus] Register failed ${res.status}: ${err}`);
      return null;
    }

    const data = await res.json();
    // Accept either field name from Circus API (defensive coding)
    _ringToken = data.ring_token || data.token;
    _agentId = data.agent_id || data.id || name;
    _agentName = name;

    if (!_ringToken) {
      console.error('[Circus] Register response missing token. Got:', JSON.stringify(Object.keys(data)));
      return null;
    }

    saveIdentity(name, _agentId, _ringToken);
    console.log(`[Circus] ✅ Registered as ${name} (${_agentId})`);
    return _ringToken;
  } catch (err) {
    console.error('[Circus] Register error (non-fatal):', err.message);
    return null;
  }
}

// ── Auto-Reauth Helper ───────────────────────────────────────────────────────

/**
 * Handle 401/403 responses by clearing identity and re-registering.
 * Returns true if re-auth succeeded, false otherwise.
 */
async function handleAuthFailure() {
  if (!_agentName) {
    console.error('[Circus] Cannot re-auth: _agentName not set');
    return false;
  }

  console.log('[Circus] Auth failed, clearing identity and re-registering...');
  try {
    const identityPath = getIdentityPath(_agentName);
    if (existsSync(identityPath)) {
      // Delete the invalid identity file
      const { unlinkSync } = await import('fs');
      unlinkSync(identityPath);
    }
  } catch (err) {
    console.error('[Circus] Failed to clear identity file:', err.message);
  }

  // Re-register (role is unknown here, use generic 'assistant')
  // The caller should know the correct role, but for auto-reauth we use a safe default
  const newToken = await circusRegister(_agentName, 'assistant');
  return newToken !== null;
}

// ── Preference Reading ────────────────────────────────────────────────────────

/**
 * Get active preferences for kobus from Circus DB directly (fast, local).
 * Returns: { "user.language_preference": "af", ... }
 */
export async function getActivePreferences() {
  if (_prefsCache && (Date.now() - _prefsCacheAt) < PREFS_TTL_MS) return _prefsCache;

  try {
    const { stdout } = await execFileAsync('sqlite3', [
      CIRCUS_DB, '-json',
      `SELECT field_name, value FROM active_preferences WHERE owner_id = '${OWNER_ID}'`
    ], { timeout: 5000 });

    const rows = stdout.trim() ? JSON.parse(stdout) : [];
    const prefs = {};
    for (const r of rows) prefs[r.field_name] = r.value;

    _prefsCache   = prefs;
    _prefsCacheAt = Date.now();
    return prefs;
  } catch (err) {
    console.error('[Circus] getActivePreferences error (non-fatal):', err.message);
    return _prefsCache || {};
  }
}

/**
 * Build a short text block to inject into system prompts.
 * Returns '' if no preferences set.
 */
export async function buildPreferenceContext() {
  const prefs = await getActivePreferences();
  if (!Object.keys(prefs).length) return '';

  const lines = [];

  // Existing fields (W4)
  if (prefs['user.language_preference'] === 'af') lines.push('- Kobus prefers Afrikaans responses');
  if (prefs['user.language_preference'] === 'en') lines.push('- Kobus prefers English responses');
  if (prefs['user.response_verbosity']  === 'terse')   lines.push('- Keep responses SHORT — Kobus prefers brevity');
  if (prefs['user.response_verbosity']  === 'verbose')  lines.push('- Kobus prefers detailed responses');
  if (prefs['user.tone_preference'])   lines.push(`- Tone: ${prefs['user.tone_preference']}`);
  if (prefs['user.format_preference']) lines.push(`- Format: ${prefs['user.format_preference']}`);

  // New fields (W8)
  if (prefs['user.code_style']) lines.push(`- Code style: ${prefs['user.code_style']}`);
  if (prefs['user.explanation_depth'] === 'none') lines.push('- Skip explanations — just do it');
  if (prefs['user.explanation_depth'] === 'full') lines.push('- Explain fully before acting');
  if (prefs['user.confirmation_style'] === 'never') lines.push('- Do not ask for confirmation');
  if (prefs['user.confirmation_style'] === 'always') lines.push('- Always ask for confirmation before acting');
  if (prefs['user.timezone']) lines.push(`- User timezone: ${prefs['user.timezone']}`);
  if (prefs['agent.proactive_suggestions'] === 'disabled') lines.push('- Do not offer unsolicited suggestions');
  if (prefs['agent.proactive_suggestions'] === 'on_errors_only') lines.push('- Only suggest fixes on errors');

  return lines.length ? `\n\n## Live Preferences (Circus)\n${lines.join('\n')}` : '';
}

// ── Preference Publishing ─────────────────────────────────────────────────────

/**
 * Sign and publish a preference memory to Circus.
 * @param {string} field      e.g. 'user.language_preference'
 * @param {string} value      e.g. 'af'
 * @param {number} confidence 0.0–1.0
 * @param {string} reasoning  why we think this
 */
export async function publishPreference(field, value, confidence, reasoning) {
  if (!_ringToken) { console.warn('[Circus] Not registered — skipping publish'); return false; }
  if (!existsSync(OWNER_KEY)) { console.warn('[Circus] Owner key missing — skipping publish'); return false; }

  async function attemptPublish() {
    const timestamp = new Date().toISOString();

    // Generate a memory_id (matches Circus's shmem- prefix pattern)
    const { stdout: hexOut } = await execFileAsync('python3', [
      '-c', "import secrets; print('shmem-' + secrets.token_hex(16))"
    ], { timeout: 5000 });
    const memoryId = hexOut.trim();

    // Sign with Ed25519 via Python (Circus's canonicalize_for_signing)
    const signScript = [
      'import sys, base64, json; sys.path.insert(0, "/root/circus")',
      'from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey',
      'from cryptography.hazmat.primitives import serialization',
      'from circus.services.bundle_signing import canonicalize_for_signing',
      `priv = base64.b64decode(open('${OWNER_KEY}').read().strip())`,
      'pk = Ed25519PrivateKey.from_private_bytes(priv)',
      `payload = {"agent_id": "${_agentId}", "memory_id": sys.argv[1], "owner_id": "${OWNER_ID}", "timestamp": sys.argv[2]}`,
      'sig = pk.sign(canonicalize_for_signing(payload))',
      'print(base64.b64encode(sig).decode())'
    ].join('\n');

    const { stdout: sigOut } = await execFileAsync('python3', ['-c', signScript, memoryId, timestamp], { timeout: 10000 });
    const signature = sigOut.trim();

    const body = {
      category: 'user_preference',
      domain: 'preference.user',
      content: `Kobus ${reasoning}`,
      confidence,
      provenance: {
        owner_id: OWNER_ID,
        reasoning,
        owner_binding: { agent_id: _agentId, memory_id: memoryId, timestamp, signature }
      },
      preference: { field, value }
    };

    const res = await fetch(`${CIRCUS_URL}/api/v1/memory-commons/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_ringToken}` },
      body: JSON.stringify(body)
    });

    return res;
  }

  try {
    const res = await attemptPublish();

    // Auto-reauth on auth failure
    if (res.status === 401 || res.status === 403) {
      const reauthed = await handleAuthFailure();
      if (reauthed) {
        console.log('[Circus] Retrying publish after re-auth...');
        const retryRes = await attemptPublish();
        if (!retryRes.ok) {
          console.error(`[Circus] Publish retry failed ${retryRes.status}:`, await retryRes.text());
          return false;
        }
        const data = await retryRes.json();
        _prefsCache = null;
        console.log(`[Circus] Published ${field}=${value} activated=${data.preference_activated}`);
        return data.preference_activated === true;
      }
      return false;
    }

    if (!res.ok) { console.error(`[Circus] Publish failed ${res.status}:`, await res.text()); return false; }

    const data = await res.json();
    _prefsCache = null; // Invalidate cache
    console.log(`[Circus] Published ${field}=${value} activated=${data.preference_activated}`);
    return data.preference_activated === true;
  } catch (err) {
    console.error('[Circus] publishPreference error (non-fatal):', err.message);
    return false;
  }
}

// ── Signal Detection ──────────────────────────────────────────────────────────

/**
 * Detect preference signals in user text.
 * Returns array of {field, value, confidence, reasoning}
 */
export function detectPreferenceSignals(text) {
  const lower = text.toLowerCase();
  const signals = [];

  // ── Language ─────────────────────────────────────────────────────────────
  if (/\b(afrikaans|in afrikaans|praat afrikaans|antwoord afrikaans|afrikaans please|afrikaans asseblief)\b/.test(lower))
    signals.push({ field: 'user.language_preference', value: 'af', confidence: 0.9, reasoning: 'explicitly requested Afrikaans' });
  if (/\b(in english|speak english|reply in english|answer in english|english please|english only)\b/.test(lower))
    signals.push({ field: 'user.language_preference', value: 'en', confidence: 0.9, reasoning: 'explicitly requested English' });

  // ── Verbosity ─────────────────────────────────────────────────────────────
  if (/\b(kort|keep it short|short answer|be brief|just tell me|don'?t explain|no explanation|terse|too long|too much detail|too verbose|simpler answer|just the answer|brief please|cut to the chase|bottom line|tldr|get to the point|skip the fluff)\b/.test(lower))
    signals.push({ field: 'user.response_verbosity', value: 'terse', confidence: 0.85, reasoning: 'requested shorter/briefer responses' });
  if (/\b(more detail|elaborate|explain more|full explanation|tell me more|in depth|comprehensive|walk me through|detailed answer|more context|explain thoroughly|full breakdown|complete answer)\b/.test(lower))
    signals.push({ field: 'user.response_verbosity', value: 'verbose', confidence: 0.75, reasoning: 'requested detailed responses' });
  if (/\b(you (always )?give too much|always so (long|verbose)|responses are too long|please be more concise|way too much text)\b/.test(lower))
    signals.push({ field: 'user.response_verbosity', value: 'terse', confidence: 0.8, reasoning: 'complained about excessive verbosity' });

  // ── Format preference ─────────────────────────────────────────────────────
  if (/\b(no markdown|plain text|without markdown|remove.*markdown|plain output|skip.*formatting|raw text|unformatted)\b/.test(lower))
    signals.push({ field: 'user.format_preference', value: 'plain', confidence: 0.85, reasoning: 'requested plain text without markdown' });
  if (/\b(use bullet|bullet points|bullet list|with bullets|bulletpoint|bulleted list|use lists|list format)\b/.test(lower))
    signals.push({ field: 'user.format_preference', value: 'bullets', confidence: 0.8, reasoning: 'requested bullet point format' });
  if (/\b(use markdown|with markdown|formatted.*output|use.*headers|proper formatting|structure it|format it nicely)\b/.test(lower))
    signals.push({ field: 'user.format_preference', value: 'markdown', confidence: 0.8, reasoning: 'requested markdown formatting' });
  if (/\b(prefer (markdown|bullets|plain)|i like (markdown|bullets|plain)|format.*as (markdown|bullets|plain))\b/.test(lower))
    signals.push({ field: 'user.format_preference', value: lower.match(/\b(markdown|bullets|plain)\b/)[1], confidence: 0.85, reasoning: 'stated format preference' });

  // ── Tone preference ───────────────────────────────────────────────────────
  if (/\b(more casual|informal|relax|chill|loosen up|less formal|be casual|casual tone|friendly tone|laid back|conversational)\b/.test(lower))
    signals.push({ field: 'user.tone_preference', value: 'casual', confidence: 0.75, reasoning: 'requested casual tone' });
  if (/\b(more formal|professional|formal tone|be formal|formal please|business like|professional tone|serious tone)\b/.test(lower))
    signals.push({ field: 'user.tone_preference', value: 'formal', confidence: 0.75, reasoning: 'requested formal tone' });
  if (/\b(direct|straight talk|no fluff|straight forward|to the point|straightforward|just facts|cut the|stop being so)\b/.test(lower))
    signals.push({ field: 'user.tone_preference', value: 'direct', confidence: 0.75, reasoning: 'requested direct tone' });

  // ── Code style (now allowlisted) ──────────────────────────────────────────
  if (/\b(show.*comments|with comments|comment.*code|add.*comments|include.*comments)\b/.test(lower))
    signals.push({ field: 'user.code_style', value: 'with_comments', confidence: 0.8, reasoning: 'requested code with comments' });
  if (/\b(no comments|without comments|clean code|remove.*comments|skip.*comments)\b/.test(lower))
    signals.push({ field: 'user.code_style', value: 'no_comments', confidence: 0.8, reasoning: 'requested code without comments' });

  // ── Explanation depth (now allowlisted) ───────────────────────────────────
  if (/\b(just do it|skip.*explanation|no.*explanation|don.?t explain|without explanation|code only|just.*code)\b/.test(lower))
    signals.push({ field: 'user.explanation_depth', value: 'none', confidence: 0.85, reasoning: 'requested no explanation' });
  if (/\b(explain.*first|walk me through|step by step|show.*reasoning|why.*before)\b/.test(lower))
    signals.push({ field: 'user.explanation_depth', value: 'full', confidence: 0.8, reasoning: 'requested full explanation' });

  // ── Confirmation style (now allowlisted) ──────────────────────────────────
  if (/\b(without asking|don'?t ask|stop asking|no need to (ask|confirm)|do it( now)?|go ahead( and)?)\b/.test(lower))
    signals.push({ field: 'user.confirmation_style', value: 'autonomous', confidence: 0.85, reasoning: 'requested autonomous execution without confirmation' });
  if (/\b(ask me first|confirm before|check with me|ask before|let me (confirm|approve)|wait for my approval)\b/.test(lower))
    signals.push({ field: 'user.confirmation_style', value: 'confirm_first', confidence: 0.85, reasoning: 'requested confirmation before executing' });

  // ── Timezone (now allowlisted) ────────────────────────────────────────────
  const tzMatch = text.match(/\b(SAST|UTC[+-]\d+|Africa\/\w+|Europe\/\w+|America\/\w+|Asia\/\w+)\b/);
  if (tzMatch)
    signals.push({ field: 'user.timezone', value: tzMatch[1], confidence: 0.95, reasoning: `mentioned timezone ${tzMatch[1]}` });
  if (/\b(cape town|johannesburg|pretoria|durban|south africa|i'?m in (za|sa))\b/.test(lower))
    signals.push({ field: 'user.timezone', value: 'Africa/Johannesburg', confidence: 0.8, reasoning: 'mentioned South African location' });

  return signals;
}

export function invalidatePrefsCache() {
  _prefsCache   = null;
  _prefsCacheAt = 0;
}

// ── Cross-Agent Shared Learning (W11) ────────────────────────────────────────

/**
 * Query Circus for shared knowledge relevant to a user message.
 * Returns formatted string for system prompt injection, or '' if nothing found.
 *
 * @param {string} query  User message text (first 500 chars)
 * @param {Object} options  { limit: number (default 3) }
 * @returns {Promise<string>}  Formatted context string or ''
 */
export async function getRelevantSharedKnowledge(query, { limit = 3 } = {}) {
  // Skip HTTP call entirely if no shared memories exist yet
  const count = await getSharedMemoryCount();
  if (count === 0) return '';

  try {
    const url = `${CIRCUS_URL}/api/v1/memory-commons/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return '';

    const data = await res.json();
    if (!data.results?.length) return '';

    const lines = data.results.map(r =>
      `- ${r.content} (source: ${r.source_agent}, confidence: ${r.confidence.toFixed(2)})`
    );

    return `\n\n## Shared Knowledge\n${lines.join('\n')}`;
  } catch (err) {
    // Non-fatal — never block a user turn
    return '';
  }
}

// Call after writeSharedKnowledge succeeds to bust the count cache
export function invalidateSharedMemoryCount() {
  _sharedMemoryCount = null;
}

/**
 * Write a significant learning/fact/decision to Circus shared memory.
 * Non-fatal. Call only for meaningful content (not filler).
 *
 * @param {string} content  The knowledge to share
 * @param {string} category 'fact' | 'decision' | 'learning' | 'error'
 * @param {number} confidence 0.0-1.0
 * @param {string} domain  e.g. 'whatsauction', 'infrastructure', 'general'
 * @param {string} agentName  e.g. 'Friday'
 * @returns {Promise<boolean>}  true if written, false if failed
 */
export async function writeSharedKnowledge(content, category, confidence, domain, agentName) {
  if (!_ringToken) return false;
  if (!content || content.length < 20) return false;  // Skip junk

  async function attemptWrite() {
    const body = {
      content,
      category,
      domain: `knowledge.${domain}`,
      confidence,
      privacy_tier: 'team',
      provenance: {
        original_author: agentName,
        reasoning: `shared by ${agentName}`,
      }
    };

    return await fetch(`${CIRCUS_URL}/api/v1/memory-commons/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_ringToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  }

  try {
    const res = await attemptWrite();

    // Auto-reauth on auth failure
    if (res.status === 401 || res.status === 403) {
      const reauthed = await handleAuthFailure();
      if (reauthed) {
        console.log('[Circus] Retrying writeSharedKnowledge after re-auth...');
        const retryRes = await attemptWrite();
        if (retryRes.ok) invalidateSharedMemoryCount();
        return retryRes.ok;
      }
      return false;
    }

    if (res.ok) invalidateSharedMemoryCount();
    return res.ok;
  } catch (err) {
    console.error('[Circus] writeSharedKnowledge error (non-fatal):', err.message);
    return false;
  }
}

/**
 * Write a structured correction to Circus.
 * Corrections are high-signal (confidence 0.95), explicitly typed.
 *
 * @param {string} correctedContent  The TRUE version of the fact
 * @param {string} reason            Why it was corrected (from user message)
 * @param {string} agentName         Which agent is writing this
 * @param {string|null} supersedesId Optional: memory_id of the stale belief
 * @returns {Promise<boolean>}
 */
export async function writeCorrection(correctedContent, reason, agentName, supersedesId = null) {
  if (!_ringToken) return false;

  async function attemptWrite() {
    const body = {
      content: correctedContent,
      category: 'correction',
      domain: 'knowledge.correction',
      confidence: 0.95,
      privacy_tier: 'team',
      provenance: {
        reasoning: reason,
        ...(supersedesId ? { supersedes_memory_id: supersedesId } : {}),
      }
    };

    return await fetch(`${CIRCUS_URL}/api/v1/memory-commons/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_ringToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  }

  try {
    const res = await attemptWrite();

    // Auto-reauth on auth failure
    if (res.status === 401 || res.status === 403) {
      const reauthed = await handleAuthFailure();
      if (reauthed) {
        console.log('[Circus] Retrying writeCorrection after re-auth...');
        const retryRes = await attemptWrite();
        if (retryRes.ok) invalidateSharedMemoryCount();
        return retryRes.ok;
      }
      return false;
    }

    if (res.ok) invalidateSharedMemoryCount();
    return res.ok;
  } catch (err) {
    console.error('[Circus] writeCorrection error (non-fatal):', err.message);
    return false;
  }
}

/**
 * Detect if a user message is correcting the agent.
 * Returns { isCorrection: true, reason } or { isCorrection: false }
 *
 * @param {string} text  User message text
 * @returns {{ isCorrection: boolean, reason?: string }}
 */
export function detectCorrectionSignal(text) {
  const lower = text.toLowerCase();
  const patterns = [
    /\b(no[,.]?\s+that'?s?\s+wrong)\b/,
    /\b(actually[,.]?\s+.{5,})\b/,
    /\b(you('?re|\s+are)\s+wrong)\b/,
    /\b(that'?s?\s+(not|incorrect|wrong))\b/,
    /\b(correction[:\s])/,
    /\b(let me correct)\b/,
    /\b(not (pm2|nginx|docker|postgres|correct))\b/i,
  ];

  for (const pattern of patterns) {
    if (pattern.test(lower)) {
      return { isCorrection: true, reason: text.slice(0, 200) };
    }
  }
  return { isCorrection: false };
}

/**
 * Heuristic: should this exchange be written to Circus shared memory?
 * Only writes high-signal content — not filler, not casual chat.
 * Returns { shouldShare: bool, category, domain, confidence, content }
 */
export function shouldShareKnowledge(userMessage, response) {
  // Skip if too short to be meaningful
  if (!response || response.length < 30) return { shouldShare: false };

  // Filter out inner monologue and tool narration early
  const NOISE_PATTERNS = [
    /^(let me|i'll|i'm going to|i need to|i will|let's|ok,|okay,|sure,|alright,)/i,  // starts with action narration
    /\|\s*[-:]+\s*\|/,           // markdown tables
    /```[\s\S]{0,20}```/,        // very short code blocks (likely tool output)
    /tool_use|tool use|bash tool|read tool|write tool/i,  // tool references
    /^\s*#+ /m,                  // response that's just headers (no real content)
    /heartbeat_ok/i,             // heartbeat responses
  ];

  if (NOISE_PATTERNS.some(p => p.test(response.trim()))) return { shouldShare: false };

  const userLower = userMessage.toLowerCase();
  const respLower = response.toLowerCase();

  // Confirmation signals from user (they confirmed something worked)
  const confirmPatterns = [
    /\bit works?\b/i, /\bthat'?s?\s+(right|correct|perfect|great)\b/i,
    /\bdankie\b/i, /\blekker\b/i, /\bperfect\b/i, /\bnice one\b/i,
    /\bworking(now)?\b/i
  ];
  const isConfirmed = confirmPatterns.some(p => p.test(userLower));

  // Error resolution: user mentioned error, bot's response addresses it
  const hadError = /\berror|fail(ed)?|crash(ed)?|broken|not work(ing)?|doesn'?t work/i.test(userLower);
  const hasResolution = /\bfix(ed)?|resolv(ed)?|solution|working|done\b/i.test(respLower);
  const isResolution = hadError && hasResolution;

  // Deployment/infrastructure fact (bot stating something was done)
  const isInfraFact = /\b(deployed|restarted|migrated|updated|installed|configured|running)\b/i.test(respLower)
    && response.length < 1000;

  // Architecture/rule decision (bot stating a rule or decision)
  const isDecision = /\b(always use|never use|use .{3,30} for|decided|going with|rule:)\b/i.test(respLower)
    && response.length < 800;

  if (!isConfirmed && !isResolution && !isInfraFact && !isDecision) {
    return { shouldShare: false };
  }

  // Determine category + domain
  let category = 'learning';
  let domain = 'general';
  let confidence = 0.75;

  if (isResolution) { category = 'error'; confidence = 0.85; }
  if (isDecision)   { category = 'decision'; confidence = 0.80; }
  if (isInfraFact)  { category = 'fact'; confidence = 0.80; }
  if (isConfirmed)  { confidence = Math.min(confidence + 0.10, 0.95); }

  // Domain detection
  const combined = (userMessage + ' ' + response).toLowerCase();
  if (/whatsauction|auction|lot|bid|invoice|wa-backend|wa-deploy/i.test(combined)) {
    domain = 'whatsauction';
  } else if (/docker|pm2|nginx|postgres|redis|vps|server|deploy|cert|ssl/i.test(combined)) {
    domain = 'infrastructure';
  } else if (/circus|ai-iq|passport|memory|agent|preference/i.test(combined)) {
    domain = 'infrastructure';
  }

  // Extract most meaningful chunk: skip leading action phrases, take first meaningful paragraph
  const lines = response.split('\n').filter(l => l.trim().length > 20);
  const meaningfulContent = lines.slice(0, 3).join(' ').trim();
  const content = (meaningfulContent || response).slice(0, 300);

  return { shouldShare: true, category, domain, confidence, content };
}

// ── A2A Task Inbox Consumer ───────────────────────────────────────────────────

/** Registry: task_type → async handler(payload, task) → result */
const _taskHandlers = new Map();
let _pollerHandle = null;

/**
 * Register a handler for a specific task type.
 * @param {string} taskType  e.g. 'research', 'build', 'notify'
 * @param {Function} handler async (payload, task) => result
 */
export function registerTaskHandler(taskType, handler) {
  _taskHandlers.set(taskType, handler);
  console.log(`[Circus] Task handler registered: ${taskType}`);
}

/**
 * Update task state on Circus API.
 */
async function updateTaskState(taskId, state, result = null, error = null) {
  if (!_ringToken) return false;
  try {
    const body = { state };
    if (result !== null) body.result = result;
    if (error !== null) body.error = error;

    const res = await fetch(`${CIRCUS_URL}/api/v1/tasks/${taskId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${_ringToken}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error(`[Circus] updateTask ${taskId} → ${state} failed (${res.status}): ${txt}`);
    }
    return res.ok;
  } catch (err) {
    console.error('[Circus] updateTaskState error (non-fatal):', err.message);
    return false;
  }
}

/**
 * Process a single task: mark working → execute handler → mark completed/failed.
 */
async function processTask(task) {
  const { task_id, task_type, payload, from_agent_id } = task;
  console.log(`[Circus] Processing task ${task_id} (type: ${task_type}, from: ${from_agent_id})`);

  const claimed = await updateTaskState(task_id, 'working');
  if (!claimed) {
    console.warn(`[Circus] Could not claim task ${task_id} — skipping`);
    return;
  }

  try {
    const handler = _taskHandlers.get(task_type);
    if (!handler) {
      await updateTaskState(task_id, 'completed', {
        note: `No handler registered for task type '${task_type}' on this agent`,
        acknowledged: true,
        agent: _agentName
      });
      console.log(`[Circus] Task ${task_id} acknowledged (no handler for '${task_type}')`);
      return;
    }

    const result = await handler(payload, task);
    await updateTaskState(task_id, 'completed', result ?? { done: true });
    console.log(`[Circus] Task ${task_id} completed ✓`);
  } catch (err) {
    console.error(`[Circus] Task ${task_id} handler threw:`, err.message);
    await updateTaskState(task_id, 'failed', null, err.message);
  }
}

/**
 * Poll inbox once — fetch submitted tasks and process each.
 */
export async function pollTaskInbox() {
  if (!_ringToken) return;

  try {
    const res = await fetch(`${CIRCUS_URL}/api/v1/tasks/inbox?state=submitted&limit=10`, {
      headers: { 'Authorization': `Bearer ${_ringToken}` },
      signal: AbortSignal.timeout(5000)
    });

    if (res.status === 401 || res.status === 403) {
      await handleAuthFailure();
      return;
    }

    if (!res.ok) {
      console.error('[Circus] Inbox poll failed:', res.status);
      return;
    }

    const tasks = await res.json();
    if (tasks.length > 0) {
      console.log(`[Circus] Inbox: ${tasks.length} task(s) pending`);
      for (const task of tasks) {
        await processTask(task);
      }
    }
  } catch (err) {
    console.error('[Circus] Inbox poll error (non-fatal):', err.message);
  }
}

/**
 * Start the task inbox poller. Call after circusRegister() succeeds.
 * @param {number} intervalMs  Poll interval (default 60s)
 */
export function startTaskInboxPoller(intervalMs = 60_000) {
  if (_pollerHandle) clearInterval(_pollerHandle);
  pollTaskInbox(); // immediate first poll
  _pollerHandle = setInterval(pollTaskInbox, intervalMs);
  console.log(`[Circus] Task inbox poller started (every ${Math.round(intervalMs / 1000)}s)`);
}

/**
 * Submit an A2A task to another agent.
 * @param {string} toAgentId  Target agent ID (from getAgentId() or known ID)
 * @param {string} taskType   e.g. 'research', 'build', 'notify'
 * @param {Object} payload    Task data
 * @param {string|null} deadline  ISO timestamp (optional)
 * @returns {Promise<string|null>}  task_id if submitted, null on failure
 */
export async function submitTask(toAgentId, taskType, payload, deadline = null) {
  if (!_ringToken) { console.warn('[Circus] Not registered — cannot submit task'); return null; }

  try {
    const body = { to_agent_id: toAgentId, task_type: taskType, payload };
    if (deadline) body.deadline = deadline;

    const res = await fetch(`${CIRCUS_URL}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${_ringToken}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      console.error(`[Circus] submitTask failed (${res.status}):`, await res.text().catch(() => ''));
      return null;
    }

    const data = await res.json();
    const taskId = data.task_id || data.id;
    console.log(`[Circus] Task submitted: ${taskId} → ${toAgentId} (${taskType})`);
    return taskId;
  } catch (err) {
    console.error('[Circus] submitTask error (non-fatal):', err.message);
    return null;
  }
}

/** Get this agent's Circus ID (needed to address tasks to this bot). */
export function getAgentId() { return _agentId; }
