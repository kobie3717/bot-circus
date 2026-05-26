import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Ephemeral worker dispatcher for bot-circus
 * Spawns Claude CLI workers that share the performer's MEMORY.md (star pattern)
 */

/**
 * Dispatch a task to a bot performer via ephemeral Claude CLI worker
 * @param {string} botId - Bot identifier
 * @param {string} task - Task message/prompt
 * @param {Object} options - Configuration options
 * @param {string} options.performersDir - Path to performers directory (default: ../performers)
 * @param {Function} options.onStream - Callback for streaming output (line) => void
 * @param {Object} options.logger - Optional pino logger
 * @returns {Promise<{output: string, summary: string}>}
 */
export async function dispatch(botId, task, options = {}) {
  const {
    performersDir = path.resolve(process.cwd(), 'performers'),
    onStream = null,
    logger = null
  } = options;

  const performerPath = path.join(performersDir, botId);

  // Validate performer exists
  if (!fs.existsSync(performerPath)) {
    throw new Error(`Performer not found: ${botId} (${performerPath})`);
  }

  const configPath = path.join(performerPath, 'config.json');
  const soulPath = path.join(performerPath, 'SOUL.md');
  const memoryPath = path.join(performerPath, 'MEMORY.md');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }

  // Load config
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Read context files
  const soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8') : '';
  const memory = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf-8') : '';

  // Build system context
  const systemContext = [
    '# Context',
    '',
    '## Your Identity (SOUL.md)',
    soul,
    '',
    '## Shared Memory (MEMORY.md)',
    memory,
    '',
    '---',
    '',
    '# Task',
    task
  ].join('\n');

  // Determine model (default to haiku for sub-tasks, override from config if set)
  const model = config.claude_config?.model || 'claude-haiku-4-5-20251001';
  const timeoutMs = config.claude_config?.timeout_ms || 120000;

  if (logger) {
    logger.debug({ botId, model, timeoutMs }, 'Dispatching ephemeral worker');
  }

  // Spawn Claude CLI worker (use 'dontAsk' instead of bypassPermissions for root)
  // Use text output format for simplicity - stream-json is complex with --verbose
  const claudeArgs = [
    '--print',
    '--model', model,
    '--permission-mode', 'dontAsk'
  ];

  const proc = spawn('/root/.local/bin/claude', claudeArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: performerPath
  });

  let stdout = '';
  let stderr = '';

  // Set timeout
  const timeoutHandle = setTimeout(() => {
    proc.kill('SIGTERM');
  }, timeoutMs);

  // Write message to stdin immediately
  proc.stdin.write(systemContext + '\n');
  proc.stdin.end();

  // Handle stdout - plain text format
  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdout += text;

    if (onStream) {
      onStream(text);
    }
  });

  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  // Wait for completion
  const result = await new Promise((resolve, reject) => {
    proc.on('error', (error) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Failed to spawn Claude CLI: ${error.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutHandle);

      if (code === 0) {
        resolve({ output: stdout.trim(), stderr });
      } else {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
      }
    });
  });

  // Generate one-line summary (first line or truncated)
  const summary = result.output.split('\n')[0].slice(0, 100) || 'Task completed';

  // Append result to MEMORY.md
  const timestamp = new Date().toISOString();
  const memoryEntry = `\n## [${timestamp}] Worker Result\n${summary}\n`;

  fs.appendFileSync(memoryPath, memoryEntry, 'utf-8');

  if (logger) {
    logger.debug({ botId, outputLength: result.output.length, summary }, 'Worker completed');
  }

  return {
    output: result.output,
    summary
  };
}
