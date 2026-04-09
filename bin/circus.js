#!/usr/bin/env node

import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';
import { Orchestrator } from '../lib/orchestrator.js';
import { MemoryManager } from '../lib/memory-manager.js';
import pino from 'pino';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const SOCKET_PATH = '/tmp/circus.sock';

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }
  }
});

/**
 * Send command to running orchestrator via socket
 */
async function sendCommand(command, args = {}) {
  return new Promise((resolve, reject) => {
    const client = net.connect(SOCKET_PATH, () => {
      client.write(JSON.stringify({ command, args }));
    });

    let response = '';
    client.on('data', (data) => {
      response += data.toString();
    });

    client.on('end', () => {
      try {
        resolve(JSON.parse(response));
      } catch (error) {
        resolve({ error: 'Invalid response' });
      }
    });

    client.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('Orchestrator not running. Use: circus serve'));
      } else {
        reject(error);
      }
    });
  });
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Print table of bots
 */
function printBotTable(bots) {
  if (bots.length === 0) {
    console.log('No bots running');
    return;
  }

  const idWidth = Math.max(10, ...bots.map(b => b.id.length));
  const nameWidth = Math.max(15, ...bots.map(b => b.name.length));
  const troupeWidth = Math.max(15, ...bots.map(b => b.troupe.length));

  // Header
  console.log(
    'ID'.padEnd(idWidth),
    'NAME'.padEnd(nameWidth),
    'TROUPE'.padEnd(troupeWidth),
    'STATUS'.padEnd(10),
    'QUEUE'.padEnd(8),
    'MESSAGES'.padEnd(10),
    'UPTIME'
  );

  console.log('-'.repeat(idWidth + nameWidth + troupeWidth + 50));

  // Rows
  for (const bot of bots) {
    console.log(
      bot.id.padEnd(idWidth),
      bot.name.padEnd(nameWidth),
      bot.troupe.padEnd(troupeWidth),
      bot.status.padEnd(10),
      bot.queue.toString().padEnd(8),
      bot.messagesProcessed.toString().padEnd(10),
      formatUptime(bot.uptimeMs)
    );
  }
}

// Main program
program
  .name('circus')
  .description('Bot-Circus: Multi-bot Telegram orchestrator powered by Claude Code CLI')
  .version('1.0.0');

// Serve command (start orchestrator)
program
  .command('serve')
  .description('Start the bot-circus orchestrator')
  .action(async () => {
    console.log('Starting bot-circus orchestrator...');

    const orchestrator = new Orchestrator();

    // Create IPC socket server
    if (fs.existsSync(SOCKET_PATH)) {
      fs.unlinkSync(SOCKET_PATH);
    }

    const server = net.createServer((socket) => {
      let data = '';

      socket.on('data', async (chunk) => {
        data += chunk.toString();
      });

      socket.on('end', async () => {
        try {
          const { command, args } = JSON.parse(data);
          let response;

          switch (command) {
            case 'status':
              response = orchestrator.getStatus();
              break;
            case 'pause':
              orchestrator.pause(args.botId);
              response = { success: true };
              break;
            case 'resume':
              orchestrator.resume(args.botId);
              response = { success: true };
              break;
            case 'restart':
              await orchestrator.restart(args.botId);
              response = { success: true };
              break;
            case 'stop':
              await orchestrator.stop(args.botId);
              response = { success: true };
              break;
            case 'start':
              await orchestrator.start(args.botId);
              response = { success: true };
              break;
            default:
              response = { error: 'Unknown command' };
          }

          socket.write(JSON.stringify(response));
          socket.end();
        } catch (error) {
          socket.write(JSON.stringify({ error: error.message }));
          socket.end();
        }
      });
    });

    server.listen(SOCKET_PATH);
    console.log(`IPC socket listening on ${SOCKET_PATH}`);

    await orchestrator.start();

    // Keep process alive
    process.on('SIGTERM', async () => {
      await orchestrator.stop();
      server.close();
      fs.unlinkSync(SOCKET_PATH);
      process.exit(0);
    });
  });

// Add performer
program
  .command('add-performer')
  .description('Add a new bot performer')
  .requiredOption('--name <name>', 'Bot display name')
  .requiredOption('--token <token>', 'Telegram bot token')
  .option('--troupe <name>', 'Join troupe (shared memory group)')
  .option('--persona <file>', 'Persona template file path')
  .action(async (options) => {
    try {
      const memoryManager = new MemoryManager(logger);

      // Generate bot ID from name
      const botId = options.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      // Check for persona file
      let personaFile = null;
      if (options.persona) {
        personaFile = path.resolve(options.persona);
        if (!fs.existsSync(personaFile)) {
          throw new Error(`Persona file not found: ${options.persona}`);
        }
      }

      // Create troupe if specified and doesn't exist
      if (options.troupe) {
        const troupePath = path.join(ROOT_DIR, 'troupes', options.troupe);
        if (!fs.existsSync(troupePath)) {
          await memoryManager.createTroupe(options.troupe);
          console.log(`Created troupe: ${options.troupe}`);
        }
      }

      // Initialize workspace
      await memoryManager.initBotWorkspace(botId, {
        name: options.name,
        token: options.token,
        troupe: options.troupe,
        personaFile
      });

      console.log(`✓ Added performer: ${options.name} (${botId})`);
      console.log(`  Workspace: performers/${botId}/`);
      if (options.troupe) {
        console.log(`  Troupe: ${options.troupe}`);
      }
      console.log('\nNext steps:');
      console.log('  1. Review and edit performers/' + botId + '/SOUL.md');
      console.log('  2. circus serve   (to start orchestrator)');
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// List performers
program
  .command('list')
  .description('List all bot performers')
  .action(async () => {
    try {
      const response = await sendCommand('status');

      if (response.error) {
        console.error('Error:', response.error);
        process.exit(1);
      }

      printBotTable(response.bots);
      console.log(`\nWorker Pool: ${response.workerPool.activeWorkers}/${response.workerPool.maxWorkers} active, ${response.workerPool.queuedTasks} queued`);

      if (response.globalStats) {
        console.log(`Total Requests: ${response.globalStats.totalRequests}, Errors: ${response.globalStats.totalErrors}`);
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Start bot(s)
program
  .command('start [bot-id]')
  .description('Start specific bot or all bots')
  .action(async (botId) => {
    try {
      const response = await sendCommand('start', { botId });
      if (response.error) {
        console.error('Error:', response.error);
        process.exit(1);
      }
      console.log(botId ? `Started bot: ${botId}` : 'Started all bots');
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Stop bot(s)
program
  .command('stop [bot-id]')
  .description('Stop specific bot or all bots')
  .action(async (botId) => {
    try {
      const response = await sendCommand('stop', { botId });
      if (response.error) {
        console.error('Error:', response.error);
        process.exit(1);
      }
      console.log(botId ? `Stopped bot: ${botId}` : 'Stopped all bots');
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Restart bot
program
  .command('restart <bot-id>')
  .description('Restart a bot')
  .action(async (botId) => {
    try {
      const response = await sendCommand('restart', { botId });
      if (response.error) {
        console.error('Error:', response.error);
        process.exit(1);
      }
      console.log(`Restarted bot: ${botId}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Pause bot
program
  .command('pause <bot-id>')
  .description('Pause bot queue processing')
  .action(async (botId) => {
    try {
      const response = await sendCommand('pause', { botId });
      if (response.error) {
        console.error('Error:', response.error);
        process.exit(1);
      }
      console.log(`Paused bot: ${botId}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Resume bot
program
  .command('resume <bot-id>')
  .description('Resume bot queue processing')
  .action(async (botId) => {
    try {
      const response = await sendCommand('resume', { botId });
      if (response.error) {
        console.error('Error:', response.error);
        process.exit(1);
      }
      console.log(`Resumed bot: ${botId}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// View logs
program
  .command('logs <bot-id>')
  .description('View bot logs')
  .option('-f, --follow', 'Follow log output')
  .option('--orchestrator', 'View orchestrator logs instead')
  .action((botId, options) => {
    const logFile = options.orchestrator
      ? path.join(ROOT_DIR, 'logs', 'orchestrator.log')
      : path.join(ROOT_DIR, 'logs', `${botId}.log`);

    if (!fs.existsSync(logFile)) {
      console.error(`Log file not found: ${logFile}`);
      process.exit(1);
    }

    const { spawn } = require('child_process');
    const args = options.follow ? ['-f', logFile] : [logFile];
    const tail = spawn('tail', args, { stdio: 'inherit' });

    tail.on('error', (error) => {
      console.error('Error:', error.message);
      process.exit(1);
    });
  });

// Add troupe
program
  .command('add-troupe <name>')
  .description('Create a new troupe (shared memory group)')
  .action(async (name) => {
    try {
      const memoryManager = new MemoryManager(logger);
      await memoryManager.createTroupe(name);
      console.log(`✓ Created troupe: ${name}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// List troupes
program
  .command('list-troupes')
  .description('List all troupes')
  .action(() => {
    const memoryManager = new MemoryManager(logger);
    const troupes = memoryManager.listTroupes();

    if (troupes.length === 0) {
      console.log('No troupes found');
      return;
    }

    console.log('NAME'.padEnd(20), 'MEMBERS'.padEnd(10), 'MEMBER IDs');
    console.log('-'.repeat(60));

    for (const troupe of troupes) {
      console.log(
        troupe.name.padEnd(20),
        troupe.memberCount.toString().padEnd(10),
        troupe.members.join(', ')
      );
    }
  });

// Join troupe
program
  .command('join-troupe <bot-id> <troupe-name>')
  .description('Add bot to a troupe')
  .action(async (botId, troupeName) => {
    try {
      const memoryManager = new MemoryManager(logger);
      await memoryManager.joinTroupe(botId, troupeName);
      console.log(`✓ ${botId} joined troupe: ${troupeName}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Leave troupe
program
  .command('leave-troupe <bot-id>')
  .description('Remove bot from its troupe')
  .action(async (botId) => {
    try {
      const memoryManager = new MemoryManager(logger);
      await memoryManager.leaveTroupe(botId);
      console.log(`✓ ${botId} left troupe`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Troupe members
program
  .command('troupe-members <troupe-name>')
  .description('List members of a troupe')
  .action((troupeName) => {
    try {
      const memoryManager = new MemoryManager(logger);
      const members = memoryManager.getTroupeMembers(troupeName);

      console.log(`Members of ${troupeName}:`);
      for (const member of members) {
        console.log(`  - ${member}`);
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Remove performer
program
  .command('rm-performer <bot-id>')
  .description('Remove a bot performer')
  .option('--keep-workspace', 'Keep workspace files')
  .action(async (botId, options) => {
    try {
      const memoryManager = new MemoryManager(logger);
      await memoryManager.deleteBot(botId, options.keepWorkspace);
      console.log(`✓ Removed performer: ${botId}`);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Stats
program
  .command('stats')
  .description('Show orchestrator statistics')
  .action(async () => {
    try {
      const response = await sendCommand('status');

      if (response.error) {
        console.error('Error:', response.error);
        process.exit(1);
      }

      console.log('=== Worker Pool ===');
      console.log(`Active Workers: ${response.workerPool.activeWorkers}/${response.workerPool.maxWorkers}`);
      console.log(`Queued Tasks: ${response.workerPool.queuedTasks}`);

      if (response.globalStats) {
        console.log('\n=== Global Stats ===');
        console.log(`Total Requests: ${response.globalStats.totalRequests}`);
        console.log(`Total Errors: ${response.globalStats.totalErrors}`);
        console.log(`Total Queue Depth: ${response.globalStats.totalQueueDepth}`);
        console.log(`Bot Count: ${response.globalStats.botCount}`);
        console.log(`Uptime: ${formatUptime(response.globalStats.uptimeSeconds * 1000)}`);
      }

      console.log('\n=== Per-Bot Stats ===');
      printBotTable(response.bots);
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

// Health check
program
  .command('health')
  .description('Check orchestrator health')
  .action(async () => {
    try {
      const response = await sendCommand('status');

      if (response.error) {
        console.error('❌ Unhealthy:', response.error);
        process.exit(1);
      }

      console.log('✓ Orchestrator healthy');
      console.log(`  Running: ${response.running}`);
      console.log(`  Bots: ${response.bots.length}`);
      console.log(`  Workers: ${response.workerPool.activeWorkers}/${response.workerPool.maxWorkers}`);
    } catch (error) {
      console.error('❌ Unhealthy:', error.message);
      process.exit(1);
    }
  });

// Top (real-time dashboard)
program
  .command('top')
  .description('Real-time dashboard (updates every 2s)')
  .action(async () => {
    let running = true;

    const update = async () => {
      try {
        const response = await sendCommand('status');

        if (response.error) {
          console.error('Error:', response.error);
          process.exit(1);
        }

        // Clear screen
        process.stdout.write('\x1Bc');

        console.log('=== Bot-Circus Dashboard ===');
        console.log(`Updated: ${new Date().toLocaleTimeString()}`);
        console.log(`Workers: ${response.workerPool.activeWorkers}/${response.workerPool.maxWorkers} | Queue: ${response.workerPool.queuedTasks}`);
        console.log('');

        printBotTable(response.bots);

        if (response.globalStats) {
          console.log('');
          console.log(`Requests: ${response.globalStats.totalRequests} | Errors: ${response.globalStats.totalErrors} | Uptime: ${formatUptime(response.globalStats.uptimeSeconds * 1000)}`);
        }

        console.log('\nPress Ctrl+C to exit');
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    };

    // Initial update
    await update();

    // Update every 2 seconds
    const interval = setInterval(update, 2000);

    process.on('SIGINT', () => {
      clearInterval(interval);
      process.stdout.write('\x1Bc');
      console.log('Dashboard closed');
      process.exit(0);
    });
  });

program.parse();
