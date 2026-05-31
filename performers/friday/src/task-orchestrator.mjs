#!/usr/bin/env node

import { readFileSync } from 'fs';
import {
  createTask,
  updateTaskStatus,
  getTask,
  getQueuedTasks,
  getRunningTasks,
  getSubjectsSummary,
  addSubjectFact,
  getSubjectContext,
  countActiveTasks,
} from './tasks-db.mjs';

// Load SOUL.md once at startup
const SOUL_PATH = '/root/bot-circus/performers/friday/SOUL.md';
let SYSTEM_PROMPT = '';
try {
  SYSTEM_PROMPT = readFileSync(SOUL_PATH, 'utf8');
} catch (err) {
  console.error('[Orchestrator] Failed to load SOUL.md:', err.message);
}

/**
 * Task orchestrator - manages TaskPool + DB persistence + subject context
 */
export class TaskOrchestrator {
  constructor({ pool, bot, getSessionForChat }) {
    this.pool = pool;
    this.bot = bot;
    this.getSessionForChat = getSessionForChat;

    // Map poolTaskId → dbId for tracking
    this._poolToDb = new Map();
    this._dbToPool = new Map();
  }

  /**
   * Enqueue a task
   * @param {object} params
   * @param {number} params.userId
   * @param {number} params.chatId
   * @param {string|null} params.subject
   * @param {string} params.prompt
   * @param {number} params.priority
   * @param {number} params.replyToMessageId
   * @param {number|null} params.parentTaskId
   * @returns {number} DB task ID
   */
  async enqueue({ userId, chatId, subject, prompt, priority = 0, replyToMessageId, parentTaskId = null }) {
    // Rate limiting: max 10 active tasks per user
    const activeCount = countActiveTasks(userId);
    if (activeCount >= 10) {
      throw new Error('Too many queued tasks. Use /cancel to clear some.');
    }

    // Create DB record
    const dbId = createTask({
      userId,
      chatId,
      subject,
      prompt,
      priority,
      replyToMessageId,
      parentTaskId,
    });

    console.log(`[Orchestrator] Enqueued task #${dbId} ${subject ? '[' + subject + ']' : ''} (priority ${priority})`);

    // Try to drain queue immediately
    await this.drain();

    return dbId;
  }

  /**
   * Cancel a task
   * @param {number} taskDbId - DB task ID
   * @returns {boolean} Success
   */
  async cancel(taskDbId) {
    const task = getTask(taskDbId);
    if (!task) return false;

    if (task.status === 'queued') {
      // Just mark as cancelled
      updateTaskStatus(taskDbId, 'cancelled', { finishedAt: Date.now() });
      console.log(`[Orchestrator] Cancelled queued task #${taskDbId}`);
      return true;
    }

    if (task.status === 'running') {
      // Cancel in pool
      const poolTaskId = this._dbToPool.get(taskDbId);
      if (poolTaskId) {
        this.pool.cancel(poolTaskId);
      }
      updateTaskStatus(taskDbId, 'cancelled', { finishedAt: Date.now() });
      console.log(`[Orchestrator] Cancelled running task #${taskDbId}`);
      return true;
    }

    return false;
  }

  /**
   * Drain queued tasks into pool
   */
  async drain() {
    const capacity = this.pool.maxConcurrent - this.pool.runningCount();
    if (capacity <= 0) return;

    const queued = getQueuedTasks(capacity);

    for (const task of queued) {
      if (this.pool.isFull()) break;

      // Build full prompt with subject context
      const fullPrompt = this._buildPrompt(task);

      // Get session for this chat — gracefully handle null/missing session (new chat, no session yet)
      let sessionId = null;
      try {
        const sess = this.getSessionForChat(task.chat_id);
        sessionId = sess?.sessionId ?? sess?.session_id ?? (typeof sess === 'string' ? sess : null);
      } catch (e) {
        // session lookup failed — proceed without session (fresh conversation)
        sessionId = null;
      }

      // Spawn in pool
      const { taskId: poolTaskId, accepted } = this.pool.spawn({
        prompt: fullPrompt,
        sessionId,
        chatId: task.chat_id,
        // Pool invokes callbacks as (taskId, payload) — capture both, forward payload
        onResult: (_tid, result) => this.onTaskComplete(poolTaskId, result),
        onError: (_tid, error) => this.onTaskError(poolTaskId, error),
      });

      if (accepted) {
        // Track mapping
        this._poolToDb.set(poolTaskId, task.id);
        this._dbToPool.set(task.id, poolTaskId);

        // Mark as running
        updateTaskStatus(task.id, 'running', { startedAt: Date.now() });
        console.log(`[Orchestrator] Spawned task #${task.id} → pool #${poolTaskId}`);
      }
    }
  }

  /**
   * Build full prompt with system prompt + subject context + user prompt
   * @param {object} task - Task record from DB
   * @returns {string}
   */
  _buildPrompt(task) {
    let prompt = SYSTEM_PROMPT + '\n\n';

    // Add subject context if available
    if (task.subject) {
      const facts = getSubjectContext(task.subject, 10);
      if (facts.length > 0) {
        prompt += `<subject-context project="${task.subject}">\n`;
        for (const fact of facts) {
          prompt += `• ${fact}\n`;
        }
        prompt += `</subject-context>\n\n`;
      }
    }

    prompt += task.prompt;

    return prompt;
  }

  /**
   * Handle task completion
   * @param {number} poolTaskId
   * @param {string} result
   */
  async onTaskComplete(poolTaskId, rawResult) {
    // Normalize: pool may pass {stdout, stderr, code} or a plain string
    const result = typeof rawResult === 'string'
      ? rawResult
      : (rawResult?.stdout || rawResult?.text || JSON.stringify(rawResult ?? ''));
    const dbId = this._poolToDb.get(poolTaskId);
    if (!dbId) {
      console.error('[Orchestrator] Pool task completed but no DB mapping:', poolTaskId);
      return;
    }

    const task = getTask(dbId);
    if (!task) return;

    // Update DB
    updateTaskStatus(dbId, 'done', {
      result,
      finishedAt: Date.now(),
    });

    // Extract and store fact
    if (task.subject) {
      const fact = this._extractFact(result);
      if (fact) {
        addSubjectFact(task.subject, fact, dbId);
        console.log(`[Orchestrator] Stored fact for ${task.subject}: ${fact.slice(0, 50)}...`);
      }
    }

    // Reply to user
    await this._replySuccess(task, result);

    // Cleanup mappings
    this._poolToDb.delete(poolTaskId);
    this._dbToPool.delete(dbId);

    // Drain queue
    await this.drain();
  }

  /**
   * Handle task error
   * @param {number} poolTaskId
   * @param {Error} error
   */
  async onTaskError(poolTaskId, rawError) {
    // Normalize: error may be Error instance, string, or {message,...}
    const error = typeof rawError === 'string'
      ? rawError
      : (rawError?.message || rawError?.stderr || JSON.stringify(rawError ?? 'unknown error'));
    const dbId = this._poolToDb.get(poolTaskId);
    if (!dbId) {
      console.error('[Orchestrator] Pool task failed but no DB mapping:', poolTaskId);
      return;
    }

    const task = getTask(dbId);
    if (!task) return;

    // Update DB
    updateTaskStatus(dbId, 'failed', {
      error: error.message || String(error),
      finishedAt: Date.now(),
    });

    // Reply to user
    await this._replyError(task, error);

    // Cleanup mappings
    this._poolToDb.delete(poolTaskId);
    this._dbToPool.delete(dbId);

    // Drain queue
    await this.drain();
  }

  /**
   * Extract a fact from result (heuristic)
   * @param {string} result
   * @returns {string|null}
   */
  _extractFact(result) {
    const keywords = ['deployed', 'fixed', 'created', 'configured', 'added', 'removed', 'set up', 'updated', 'implemented'];
    const sentences = result.split(/[.!?]\s+/);

    for (const sentence of sentences) {
      for (const kw of keywords) {
        if (sentence.toLowerCase().includes(kw)) {
          const fact = sentence.slice(0, 200).trim();
          if (fact.length > 10) {
            return fact;
          }
        }
      }
    }

    return null;
  }

  /**
   * Reply success to user
   * @param {object} task
   * @param {string} result
   */
  async _replySuccess(task, result) {
    const prefix = `✅ Task #${task.id}${task.subject ? ' [' + task.subject + ']' : ''}`;
    const text = `${prefix}\n\n${result.slice(0, 3500)}`;

    try {
      if (text.length > 4096) {
        // Send in 2 chunks
        await this.bot.api.sendMessage(task.chat_id, text.slice(0, 4096), {
          reply_parameters: { message_id: task.reply_to_message_id },
        });
        await this.bot.api.sendMessage(task.chat_id, text.slice(4096), {
          reply_parameters: { message_id: task.reply_to_message_id },
        });
      } else {
        await this.bot.api.sendMessage(task.chat_id, text, {
          reply_parameters: { message_id: task.reply_to_message_id },
        });
      }
    } catch (err) {
      console.error('[Orchestrator] Reply failed:', err.message);
    }
  }

  /**
   * Reply error to user
   * @param {object} task
   * @param {Error} error
   */
  async _replyError(task, error) {
    const prefix = `❌ Task #${task.id}${task.subject ? ' [' + task.subject + ']' : ''}`;
    const text = `${prefix}: ${(error.message || String(error)).slice(0, 500)}`;

    try {
      await this.bot.api.sendMessage(task.chat_id, text, {
        reply_parameters: { message_id: task.reply_to_message_id },
      });
    } catch (err) {
      console.error('[Orchestrator] Error reply failed:', err.message);
    }
  }

  /**
   * Get running tasks snapshot (for /status)
   * @returns {Array<{dbId, subject, prompt_excerpt, elapsedMs}>}
   */
  getRunningSnapshot() {
    const running = getRunningTasks();
    const now = Date.now();

    return running.map(t => ({
      dbId: t.id,
      subject: t.subject,
      prompt_excerpt: t.prompt.slice(0, 50),
      elapsedMs: now - t.started_at,
    }));
  }

  /**
   * Get subjects snapshot (for /topics)
   * @returns {Array}
   */
  getSubjectsSnapshot() {
    return getSubjectsSummary();
  }
}
