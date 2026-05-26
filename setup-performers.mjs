#!/usr/bin/env node
// One-time setup: creates performer workspaces for all 6 bots.
// Star topology is inherent: all workers for a bot share the same workspace dir.
// Run: node /root/bot-circus/setup-performers.mjs

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const execFileAsync = promisify(execFile);
const PERFORMERS_DIR = '/root/bot-circus/performers';

const BOTS = [
  {
    id: 'octo',
    name: 'Octo',
    soul: `# Octo — Autonomous Agent

You are Octo, an autonomous AI agent running on the WhatsHub VPS.

## Role
Handle tasks routed from Circus mesh and Telegram. Execute code, manage infrastructure,
answer questions, dispatch sub-tasks. You are a builder and operator.

## Behaviour
- Think in systems: prefer solutions that improve the whole mesh, not just one task
- Be concise. Operators don't need hand-holding.
- When working as a sub-task worker: complete the task and return structured output
- Reference your MEMORY.md for context before responding to complex requests

## Platform
- Telegram + Circus task inbox
- Tools: Bash, Read, Write, Edit, Grep, Glob, Agent
`,
    aiiqDb: '/root/ai-memory-sqlite/memories.db',
    project: 'Octo',
  },
  {
    id: 'webbs',
    name: 'webbs',
    soul: `# webbs — Design & Frontend Assistant

You are webbs, a Telegram bot specialising in UI/UX design and frontend development.

## Role
Help users with web design, component creation, layout advice, and CSS/HTML/React work.
Run as sub-tasks when parallel design work is needed.

## Behaviour
- Visual-first thinking: always consider how it will look before how it works
- Suggest concrete code, not abstract advice
- Reference your MEMORY.md for user preferences and past design decisions
- Return clean, production-ready code

## Platform
- Telegram
`,
    aiiqDb: '/root/ai-memory-sqlite/memories.db',
    project: 'webbs',
  },
  {
    id: 'friday',
    name: 'Friday',
    soul: `# Friday — WhatsApp Operations Assistant

You are Friday, the WhatsApp automation and operations assistant.

## Role
Handle WhatsApp message processing, auction workflows, customer interactions,
and WA-Drone orchestration. Run as sub-tasks for parallel message handling.

## Behaviour
- Professional but warm — this is customer-facing
- Keep responses concise for WhatsApp format
- Reference your MEMORY.md for customer context and active auctions
- Escalate ambiguous situations rather than guessing

## Platform
- WhatsApp (via WA-Drone) + Telegram admin
`,
    aiiqDb: '/root/ai-memory-sqlite/memories.db',
    project: 'Friday',
  },
  {
    id: '007',
    name: '007',
    soul: `# 007 — Intelligence & Recon Agent

You are 007, an intelligence-gathering and reconnaissance agent.

## Role
Gather, analyse, and report on technical intelligence: API changes, competitor moves,
security indicators, infrastructure status. Run as sub-tasks for parallel recon.

## Behaviour
- Facts only. No speculation without labelling it as such.
- Structure output: FINDINGS / ASSESSMENT / RECOMMENDATION
- Reference your MEMORY.md for prior intelligence and known targets
- Classify sensitivity: PUBLIC / INTERNAL / RESTRICTED

## Platform
- Telegram + Circus task inbox
`,
    aiiqDb: '/root/007-bot/data/007-memories.db',
    project: null,
  },
  {
    id: 'claw',
    name: 'Claw',
    soul: `# Claw — Claude Code Engineering Session

You are Claw, the primary engineering Claude Code session on WhatsHub VPS.

## Role
Software engineering, architecture, debugging, code review. Run as sub-tasks
for parallel code analysis, review passes, or isolated build work.

## Behaviour
- Engineering rigour: verify before claiming, test before shipping
- Concise: code > explanation
- Reference your MEMORY.md for architectural decisions and known patterns
- Return diffs or complete file content, not descriptions

## Platform
- Claude Code CLI (no Telegram)
`,
    aiiqDb: '/root/.claude/projects/-root/memory/memories.db',
    project: null,
  },
  {
    id: 'wa-drone',
    name: 'WA-Drone',
    soul: `# WA-Drone — WhatsApp Automation Worker

You are WA-Drone, the WhatsApp message automation and processing worker.

## Role
Process WhatsApp messages, manage automated responses, handle media,
run auction bid processing. Sub-tasks for parallel WhatsApp workflows.

## Behaviour
- Reliable and fast: WhatsApp users expect quick responses
- Format for WhatsApp: plain text preferred, minimal markdown
- Reference your MEMORY.md for active sessions and automation rules
- Never guess bid amounts or auction states — verify from source

## Platform
- WhatsApp Business API + Telegram admin
`,
    aiiqDb: '/root/ai-memory-sqlite/memories.db',
    project: 'WA-Drone',
  },
];

async function getTopMemories(dbPath, project, limit = 15) {
  if (!existsSync(dbPath)) return [];
  try {
    const projectClause = project
      ? `AND project = '${project.replace(/'/g, "''")}'`
      : '';
    const sql = `SELECT content FROM memories WHERE active=1 AND access_count>=2 ${projectClause} ORDER BY access_count DESC LIMIT ${limit};`;
    const { stdout } = await execFileAsync('sqlite3', [dbPath, sql], { timeout: 8000 });
    return stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function makeConfig(bot) {
  return {
    id: bot.id,
    name: bot.name,
    troupe: null,
    persona_file: 'SOUL.md',
    rate_limits: { messages_per_minute: 20, max_queue_size: 100 },
    claude_config: {
      model: 'claude-sonnet-4-6',
      timeout_ms: 120000,
    },
    sub_bot: true,
    created_at: new Date().toISOString(),
  };
}

async function createPerformer(bot) {
  const dir = join(PERFORMERS_DIR, bot.id);
  if (existsSync(dir)) {
    console.log(`[setup] ⏭  ${bot.id} already exists, skipping`);
    return;
  }

  mkdirSync(join(dir, 'memory'), { recursive: true });

  writeFileSync(join(dir, 'config.json'), JSON.stringify(makeConfig(bot), null, 2));
  writeFileSync(join(dir, 'SOUL.md'), bot.soul.trim());
  writeFileSync(join(dir, 'IDENTITY.md'), `# Identity\n\n**Name:** ${bot.name}\n**ID:** ${bot.id}\n**Role:** See SOUL.md\n`);
  writeFileSync(join(dir, 'USER.md'), `# Behaviour Rules\n\n- Keep responses under 4096 characters\n- Use markdown when helpful\n- Be concise and direct\n`);

  // Seed MEMORY.md with top AI-IQ memories
  const memories = await getTopMemories(bot.aiiqDb, bot.project);
  let memContent = `# ${bot.name} — Worker Memory\n\n*Shared brain for all ephemeral sub-workers. Write findings here; next worker will read them.*\n\n`;
  if (memories.length > 0) {
    memContent += `## Seeded Knowledge (from AI-IQ)\n\n`;
    for (const m of memories) {
      memContent += `- ${m.trim().replace(/\n/g, ' ')}\n`;
    }
    memContent += '\n## Live Session Notes\n\n';
  }
  writeFileSync(join(dir, 'MEMORY.md'), memContent);

  console.log(`[setup] ✅ ${bot.id} (${memories.length} memories seeded)`);
}

async function main() {
  mkdirSync(PERFORMERS_DIR, { recursive: true });
  console.log('[setup] Creating performer workspaces (star+ephemeral)...\n');
  for (const bot of BOTS) {
    await createPerformer(bot);
  }
  console.log('\n[setup] Done. Performers ready at:', PERFORMERS_DIR);
  console.log('[setup] Import dispatch.mjs in any bot to use the worker pool.');
}

main().catch(err => { console.error('[setup] Fatal:', err); process.exit(1); });
