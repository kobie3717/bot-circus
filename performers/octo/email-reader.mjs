#!/usr/bin/env node
/**
 * Email Reader - IMAP listener for multiple email accounts
 *
 * Features:
 * - Connects to 2 IMAP accounts (iCloud + Pop.co.za)
 * - Uses IDLE for real-time message notifications
 * - Auto-reconnect with exponential backoff
 * - Priority classification (urgent/normal/low)
 * - HTML to text conversion
 * - Health endpoint on localhost:7701
 */

import { ImapFlow } from 'imapflow';
import { convert } from 'html-to-text';
import { addMessage } from '../../lib/inbox.mjs';
import http from 'http';
import dotenv from 'dotenv';

dotenv.config();

// Account configurations
const ACCOUNTS = [
  {
    name: 'iCloud',
    source: 'email-icloud',
    host: process.env.IMAP_ICLOUD_HOST,
    port: parseInt(process.env.IMAP_ICLOUD_PORT),
    user: process.env.IMAP_ICLOUD_USER,
    pass: process.env.IMAP_ICLOUD_PASS
  },
  {
    name: 'Pop',
    source: 'email-pop',
    host: process.env.IMAP_POP_HOST,
    port: parseInt(process.env.IMAP_POP_PORT),
    user: process.env.IMAP_POP_USER,
    pass: process.env.IMAP_POP_PASS
  }
];

// Connection status tracking
const status = {};
ACCOUNTS.forEach(acc => {
  status[acc.name] = {
    connected: false,
    lastConnect: null,
    lastError: null,
    reconnectDelay: 5000,
    reconnectTimer: null
  };
});

/**
 * Classify message priority based on headers and content
 * @param {Object} envelope - IMAP envelope object
 * @param {Buffer} source - Raw email source
 * @returns {string} - 'urgent', 'normal', or 'low'
 */
function classifyPriority(envelope, source) {
  const subject = (envelope.subject || '').toLowerCase();
  const from = (envelope.from?.[0]?.address || '').toLowerCase();
  const sourceStr = source.toString('utf-8', 0, Math.min(5000, source.length)).toLowerCase();

  // Check for List-Unsubscribe header (mailing lists)
  if (sourceStr.includes('list-unsubscribe:')) {
    return 'low';
  }

  // Urgent keywords
  const urgentKeywords = [
    'urgent', 'asap', 'emergency', 'critical', 'nood', 'dringend',
    'invoice', 'payment', 'deadline', 'overdue', 'final notice'
  ];

  for (const keyword of urgentKeywords) {
    if (subject.includes(keyword) || from.includes(keyword)) {
      return 'urgent';
    }
  }

  // Low priority keywords
  const lowKeywords = ['newsletter', 'promo', 'marketing', 'unsubscribe'];
  for (const keyword of lowKeywords) {
    if (subject.includes(keyword) || sourceStr.includes(keyword)) {
      return 'low';
    }
  }

  return 'normal';
}

/**
 * Extract text from email (HTML or plain text)
 * @param {Buffer} source - Raw email source
 * @returns {string} - Extracted text content
 */
function extractText(source) {
  const sourceStr = source.toString('utf-8');

  // Simple MIME parsing to find text/html or text/plain parts
  const htmlMatch = sourceStr.match(/Content-Type:\s*text\/html[^]*?(?=\r?\n\r?\n)(.*?)(?=--|\r?\n\r?\nContent-Type:|$)/is);
  const plainMatch = sourceStr.match(/Content-Type:\s*text\/plain[^]*?(?=\r?\n\r?\n)(.*?)(?=--|\r?\n\r?\nContent-Type:|$)/is);

  let text = '';

  if (htmlMatch && htmlMatch[1]) {
    // Extract HTML body and convert to text
    const htmlBody = htmlMatch[1].trim();
    text = convert(htmlBody, {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' }
      ]
    });
  } else if (plainMatch && plainMatch[1]) {
    text = plainMatch[1].trim();
  } else {
    // Fallback: try to find any text after headers
    const bodyMatch = sourceStr.match(/\r?\n\r?\n([\s\S]+)$/);
    if (bodyMatch) {
      text = bodyMatch[1].trim();
    }
  }

  // Truncate to 5000 chars
  return text.slice(0, 5000);
}

/**
 * Process a new message and add to inbox
 * @param {Object} account - Account configuration
 * @param {Object} msg - IMAP message object with envelope and source
 */
async function processMessage(account, msg) {
  try {
    const envelope = msg.envelope;
    const priority = classifyPriority(envelope, msg.source);
    const body = extractText(msg.source);

    const message = {
      source: account.source,
      direction: 'in',
      from_name: envelope.from?.[0]?.name || envelope.from?.[0]?.address || 'Unknown',
      from_address: envelope.from?.[0]?.address || null,
      to_address: envelope.to?.[0]?.address || account.user,
      subject: envelope.subject || '(no subject)',
      body: body,
      timestamp: envelope.date ? Math.floor(new Date(envelope.date).getTime() / 1000) : Math.floor(Date.now() / 1000),
      is_read: false,
      priority: priority
    };

    const id = addMessage(message);
    console.log(`[${account.name}] New message #${id}: ${envelope.subject} (${priority})`);
  } catch (error) {
    console.error(`[${account.name}] Error processing message:`, error.message);
  }
}

/**
 * Fetch unseen messages from the last 24 hours
 * @param {ImapFlow} client - Connected IMAP client
 * @param {Object} account - Account configuration
 */
async function fetchUnseen(client, account) {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const messages = client.fetch(
      { seen: false, since: yesterday },
      { envelope: true, source: true }
    );

    let count = 0;
    for await (const msg of messages) {
      await processMessage(account, msg);
      count++;
    }

    if (count > 0) {
      console.log(`[${account.name}] Fetched ${count} unseen messages from last 24h`);
    }
  } catch (error) {
    console.error(`[${account.name}] Error fetching unseen:`, error.message);
  }
}

/**
 * Connect to an IMAP account and set up IDLE listener
 * @param {Object} account - Account configuration
 */
async function connectAccount(account) {
  const stat = status[account.name];

  try {
    console.log(`[${account.name}] Connecting to ${account.host}:${account.port}...`);

    const client = new ImapFlow({
      host: account.host,
      port: account.port,
      secure: true,
      auth: {
        user: account.user,
        pass: account.pass
      },
      logger: false
    });

    // Connection opened
    await client.connect();
    console.log(`[${account.name}] Connected`);

    // Open INBOX
    await client.mailboxOpen('INBOX');
    console.log(`[${account.name}] INBOX opened`);

    // Update status
    stat.connected = true;
    stat.lastConnect = new Date();
    stat.lastError = null;
    stat.reconnectDelay = 5000; // Reset delay on successful connect

    // Fetch unseen messages from last 24h
    await fetchUnseen(client, account);

    // Set up IDLE for new messages
    client.on('exists', async () => {
      try {
        // Fetch the latest unseen message
        const messages = client.fetch({ seen: false }, { envelope: true, source: true });
        for await (const msg of messages) {
          await processMessage(account, msg);
        }
      } catch (error) {
        console.error(`[${account.name}] Error fetching new message:`, error.message);
      }
    });

    // Handle connection close
    client.on('close', () => {
      console.log(`[${account.name}] Connection closed`);
      stat.connected = false;
      scheduleReconnect(account);
    });

    // Handle connection error
    client.on('error', (error) => {
      console.error(`[${account.name}] Connection error:`, error.message);
      stat.connected = false;
      stat.lastError = error.message;
      scheduleReconnect(account);
    });

    // Start IDLE
    console.log(`[${account.name}] Starting IDLE...`);
    await client.idle();

  } catch (error) {
    console.error(`[${account.name}] Failed to connect:`, error.message);
    stat.connected = false;
    stat.lastError = error.message;
    scheduleReconnect(account);
  }
}

/**
 * Schedule reconnection with exponential backoff
 * @param {Object} account - Account configuration
 */
function scheduleReconnect(account) {
  const stat = status[account.name];

  // Clear any existing timer
  if (stat.reconnectTimer) {
    clearTimeout(stat.reconnectTimer);
  }

  console.log(`[${account.name}] Reconnecting in ${stat.reconnectDelay / 1000}s...`);

  stat.reconnectTimer = setTimeout(() => {
    connectAccount(account);
  }, stat.reconnectDelay);

  // Exponential backoff: 5s -> 10s -> 20s -> 40s -> ... -> max 5min
  stat.reconnectDelay = Math.min(stat.reconnectDelay * 2, 300000);
}

/**
 * Health check HTTP server
 */
const CLAW_API_KEY = process.env.CLAW_API_KEY;

const server = http.createServer((req, res) => {
  // Auth check
  if (CLAW_API_KEY && req.headers['x-api-key'] !== CLAW_API_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    const statusReport = {};
    ACCOUNTS.forEach(acc => {
      const stat = status[acc.name];
      statusReport[acc.name] = {
        connected: stat.connected,
        lastConnect: stat.lastConnect,
        lastError: stat.lastError
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statusReport, null, 2));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(7701, '127.0.0.1', () => {
  console.log('[email-reader] Health endpoint: http://localhost:7701/status');
});

/**
 * Graceful shutdown
 */
function shutdown() {
  console.log('\n[email-reader] Shutting down...');

  // Clear all reconnect timers
  ACCOUNTS.forEach(acc => {
    const stat = status[acc.name];
    if (stat.reconnectTimer) {
      clearTimeout(stat.reconnectTimer);
    }
  });

  server.close(() => {
    console.log('[email-reader] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 5s
  setTimeout(() => {
    console.log('[email-reader] Force exit');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/**
 * Initialize all accounts
 */
console.log('[email-reader] Starting email reader...');
console.log(`[email-reader] Monitoring ${ACCOUNTS.length} accounts`);

ACCOUNTS.forEach(account => {
  console.log(`[email-reader] - ${account.name}: ${account.user}`);
  connectAccount(account);
});
