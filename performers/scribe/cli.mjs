#!/usr/bin/env node

// cli.mjs — Scribe CLI entrypoint

import { buildSystemPrompt } from './lib/voice.mjs';
import { draft } from './lib/anthropic-client.mjs';
import { saveDraft, listDrafts, getDraft } from './lib/drafts.mjs';

const COMMANDS = {
  linkedin: 'Draft LinkedIn post (1500-2000 chars)',
  blog: 'Draft blog post (800-1500 words, includes hero image + tweet-thread)',
  thread: 'Draft Twitter/X thread (5-10 tweets)',
  recap: 'Draft recap post for event/milestone',
  drafts: 'List saved drafts',
  show: 'Print a saved draft',
  help: 'Show this help',
};

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    return { command: 'help' };
  }

  const command = args[0];
  const topic = args[1];

  const flags = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace('--', '');
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      flags[key] = value;
      if (value !== true) i++; // skip next arg if it was consumed as value
    }
  }

  return { command, topic, flags };
}

/**
 * Show help text
 */
function showHelp() {
  console.log(`
Scribe 📝 — Marketing/content specialist (CLI tool)

Usage:
  scribe <command> <topic> [options]

Commands:
  linkedin <topic>       ${COMMANDS.linkedin}
  blog <topic>           ${COMMANDS.blog}
  thread <topic>         ${COMMANDS.thread}
  recap <event>          ${COMMANDS.recap}
  drafts                 ${COMMANDS.drafts}
  show <draft_id>        ${COMMANDS.show}
  help                   ${COMMANDS.help}

Options:
  --with-recon <company>   Pull Recon report first (stub: TBD)
  --style <type>           founder|technical|playful (default: founder)
  --length <size>          short|medium|long
  --stdin                  Read topic from stdin (for piping)

Examples:
  scribe linkedin "Capitec Pulse AI launch impact on banking UX"
  scribe blog "How we shipped Recon in 7 days"
  scribe thread "WhatsAuction MVP lessons learned"
  scribe recap "BD hackathon May 25-31"
  scribe drafts
  scribe show 2026-05-31_capitec-pulse-ai_linkedin

Drafts saved to: /root/bot-circus/performers/scribe/drafts/
All output is DRAFT markdown — owner publishes manually.
  `.trim());
}

/**
 * Main CLI handler
 */
async function main() {
  const { command, topic, flags = {} } = parseArgs();

  // Help
  if (command === 'help' || !command) {
    showHelp();
    return;
  }

  // List drafts
  if (command === 'drafts') {
    const drafts = listDrafts();
    if (drafts.length === 0) {
      console.log('No drafts yet. Create one with: scribe linkedin <topic>');
      return;
    }
    console.log(`\n${drafts.length} draft(s):\n`);
    drafts.forEach(d => {
      console.log(`  ${d.id}`);
      console.log(`    ${d.format} · ${d.date} · "${d.topic}"`);
    });
    console.log();
    return;
  }

  // Show draft
  if (command === 'show') {
    if (!topic) {
      console.error('Error: draft_id required. Usage: scribe show <draft_id>');
      process.exit(1);
    }
    try {
      const content = getDraft(topic);
      console.log(content);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Content generation commands
  const contentCommands = ['linkedin', 'blog', 'thread', 'recap'];
  if (!contentCommands.includes(command)) {
    console.error(`Error: unknown command "${command}". Run: scribe help`);
    process.exit(1);
  }

  if (!topic) {
    console.error(`Error: topic required. Usage: scribe ${command} <topic>`);
    process.exit(1);
  }

  // Stub: Recon integration
  if (flags['with-recon']) {
    console.log(`[Stub] Recon integration TBD: would fetch report for ${flags['with-recon']}`);
  }

  // Build prompt
  console.log(`Drafting ${command} post: "${topic}"...`);
  const systemPrompt = buildSystemPrompt(command);

  let userMessage = topic;
  if (flags.style) {
    userMessage += `\n\nStyle: ${flags.style}`;
  }
  if (flags.length) {
    userMessage += `\nLength: ${flags.length}`;
  }

  // Call LLM
  try {
    const result = await draft(systemPrompt, userMessage);

    // Save draft
    const filepath = saveDraft({
      format: command,
      topic,
      body: result.text,
      metadata: {
        usage: result.usage,
        cost_estimate: result.cost_estimate,
      },
    });

    // Print summary
    const preview = result.text.split('\n').find(line => line.trim().length > 0) || '';
    const previewText = preview.substring(0, 80) + (preview.length > 80 ? '...' : '');

    console.log(`\n✓ Draft saved: ${filepath}`);
    console.log(`  ${result.usage.input_tokens} in + ${result.usage.output_tokens} out = $${result.cost_estimate}`);
    console.log(`  Preview: ${previewText}\n`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
