// overnight.mjs — Commit-per-iteration task orchestrator for Octo
// Inspired by gnhf (github.com/kunchenguid/gnhf)
//
// Each iteration:
//   1. Run Claude CLI with the task prompt
//   2. Check if Claude made any git changes
//   3. If changes + success → commit them
//   4. If changes + failure → git reset --hard (rollback)
//   5. Report iteration result to Kobus via Telegram
//   6. Loop with exponential backoff on errors

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const execFileAsync = promisify(execFile);

// Active run state (one run at a time)
let _activeRun = null;

export function getActiveRun() { return _activeRun; }

/**
 * Check if there are uncommitted git changes in a repo
 */
async function hasChanges(cwd) {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 10000 });
    return stdout.trim().length > 0;
  } catch (_) { return false; }
}

/**
 * Commit all changes with a message
 */
async function commitAll(cwd, message) {
  await execFileAsync('git', ['add', '-A'], { cwd, timeout: 10000 });
  await execFileAsync('git', ['commit', '-m', message, '--no-verify'], { cwd, timeout: 15000 });
}

/**
 * Hard reset to HEAD (discard all changes)
 */
async function rollback(cwd) {
  await execFileAsync('git', ['reset', '--hard', 'HEAD'], { cwd, timeout: 10000 });
  await execFileAsync('git', ['clean', '-fd'], { cwd, timeout: 10000 });
}

/**
 * Get the current HEAD commit hash
 */
async function getHeadCommit(cwd) {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd, timeout: 5000 });
  return stdout.trim();
}

/**
 * Run one Claude CLI iteration
 * Returns: { success, output, exitCode }
 */
async function runClaudeIteration(prompt, cwd, claudeBin, timeoutMs = 300000) {
  return new Promise((resolve) => {
    const proc = spawn(claudeBin, [
      '--print',
      '--output-format', 'text',
      '--dangerously-skip-permissions',
      prompt
    ], {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env, CLAUDE_WORKING_DIR: cwd }
    });

    let output = '';
    let error = '';
    proc.stdout.on('data', d => output += d);
    proc.stderr.on('data', d => error += d);

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        output: output.trim() || error.trim(),
        exitCode: code
      });
    });

    proc.on('error', (err) => {
      resolve({ success: false, output: err.message, exitCode: -1 });
    });
  });
}

/**
 * Build an iteration prompt.
 * Includes the original objective + what happened in previous iterations.
 */
function buildIterationPrompt(objective, iterationHistory, iterationNumber) {
  const historyText = iterationHistory.length > 0
    ? '\n\nPrevious iterations:\n' + iterationHistory.slice(-3).map((h, i) =>
        `Iteration ${iterationHistory.length - Math.min(3, iterationHistory.length) + i + 1}: ${h.committed ? '✅ committed' : '❌ rolled back'} — ${h.summary}`
      ).join('\n')
    : '';

  return `You are working on an ongoing task. Make ONE small, focused improvement then stop.

OBJECTIVE: ${objective}${historyText}

ITERATION: ${iterationNumber}

Instructions:
- Make ONE specific improvement towards the objective
- Keep changes minimal and focused
- After making changes, output a one-line summary of what you did
- If the objective is complete, output: DONE: <summary>
- If you cannot make progress, output: STUCK: <reason>
- Do NOT run tests or do large refactors unless specifically asked

Work in: ${process.env.CLAUDE_WORKING_DIR || process.cwd()}`;
}

/**
 * Main overnight run function
 * @param {object} opts
 * @param {string} opts.objective - What to work on
 * @param {string} opts.cwd - Git repo to work in
 * @param {number} opts.maxIterations - Max iterations (default 20)
 * @param {number} opts.maxTokens - Token budget (optional)
 * @param {string} opts.claudeBin - Path to claude CLI
 * @param {function} opts.onProgress - Callback: (iteration, result) => void
 * @param {function} opts.onComplete - Callback: (summary) => void
 */
export async function startOvernightRun(opts) {
  const {
    objective,
    cwd,
    maxIterations = 20,
    claudeBin = process.env.CLAUDE_CLI_PATH || '/root/.local/bin/claude',
    onProgress = () => {},
    onComplete = () => {},
  } = opts;

  if (_activeRun) {
    throw new Error('An overnight run is already active. Stop it first with stopOvernightRun().');
  }

  if (!existsSync(cwd)) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }

  const startCommit = await getHeadCommit(cwd);
  const history = [];
  let consecutiveErrors = 0;
  let stopped = false;

  _activeRun = {
    objective,
    cwd,
    startCommit,
    iteration: 0,
    maxIterations,
    history,
    startedAt: new Date().toISOString(),
    stop: () => { stopped = true; }
  };

  console.log(`[overnight] Starting run: "${objective}" in ${cwd}, max ${maxIterations} iterations`);

  try {
    for (let i = 1; i <= maxIterations && !stopped; i++) {
      _activeRun.iteration = i;

      console.log(`[overnight] Iteration ${i}/${maxIterations}`);

      // Backoff on consecutive errors
      if (consecutiveErrors > 0) {
        const backoffMs = Math.min(60_000 * Math.pow(2, consecutiveErrors - 1), 10 * 60_000);
        console.log(`[overnight] Backing off ${Math.round(backoffMs/1000)}s after ${consecutiveErrors} error(s)`);
        await new Promise(r => setTimeout(r, backoffMs));
        if (stopped) break;
      }

      const prompt = buildIterationPrompt(objective, history, i);
      const iterResult = await runClaudeIteration(prompt, cwd, claudeBin);

      const outputLower = iterResult.output.toLowerCase();
      const isDone = outputLower.includes('done:') || outputLower.includes('objective complete') || outputLower.includes('task complete');
      const isStuck = outputLower.includes('stuck:') || outputLower.includes('cannot make progress');

      const changed = await hasChanges(cwd);
      let committed = false;
      let rollbacked = false;

      if (changed) {
        if (iterResult.success && !isStuck) {
          // Commit the changes
          const commitMsg = `[overnight] iter ${i}: ${iterResult.output.slice(0, 72)}`;
          try {
            await commitAll(cwd, commitMsg);
            committed = true;
            consecutiveErrors = 0;
            console.log(`[overnight] Iteration ${i} committed`);
          } catch (commitErr) {
            console.error(`[overnight] Commit failed: ${commitErr.message}`);
            await rollback(cwd).catch(() => {});
            rollbacked = true;
            consecutiveErrors++;
          }
        } else {
          // Failed or stuck — rollback
          await rollback(cwd).catch(() => {});
          rollbacked = true;
          consecutiveErrors++;
        }
      } else {
        // No changes made
        if (!iterResult.success) consecutiveErrors++;
        else consecutiveErrors = 0;
      }

      const record = {
        iteration: i,
        committed,
        rollbacked,
        noChanges: !changed,
        summary: iterResult.output.slice(0, 200),
        isDone,
        isStuck,
        timestamp: new Date().toISOString(),
      };
      history.push(record);

      // Report progress
      await onProgress(i, record).catch(() => {});

      // Stop conditions
      if (isDone) {
        console.log(`[overnight] Objective complete at iteration ${i}`);
        break;
      }
      if (isStuck) {
        console.log(`[overnight] Agent stuck at iteration ${i}`);
        break;
      }
      if (consecutiveErrors >= 5) {
        console.log(`[overnight] Too many consecutive errors (${consecutiveErrors}), stopping`);
        break;
      }
    }
  } finally {
    const endCommit = await getHeadCommit(cwd).catch(() => 'unknown');
    const committedCount = history.filter(h => h.committed).length;
    const summary = {
      objective,
      cwd,
      startCommit,
      endCommit,
      iterations: history.length,
      committed: committedCount,
      startedAt: _activeRun.startedAt,
      completedAt: new Date().toISOString(),
      stopped,
      history,
    };
    _activeRun = null;
    await onComplete(summary).catch(() => {});
    console.log(`[overnight] Run complete: ${committedCount} commits in ${history.length} iterations`);
  }
}

/**
 * Stop the active overnight run gracefully
 */
export function stopOvernightRun() {
  if (!_activeRun) return false;
  _activeRun.stop();
  return true;
}

/**
 * Get status of active run
 */
export function getOvernightStatus() {
  if (!_activeRun) return null;
  return {
    objective: _activeRun.objective,
    cwd: _activeRun.cwd,
    iteration: _activeRun.iteration,
    maxIterations: _activeRun.maxIterations,
    startedAt: _activeRun.startedAt,
    lastResult: _activeRun.history[_activeRun.history.length - 1] || null,
    committedCount: _activeRun.history.filter(h => h.committed).length,
  };
}
