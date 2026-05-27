#!/usr/bin/env node
/**
 * WhatsApp Personal Connector via Baileys
 *
 * Standalone PM2 process with HTTP API for sending messages.
 * All incoming messages are written to the unified inbox.
 *
 * HTTP API on localhost:7700:
 * - GET /status - Connection status and QR availability
 * - GET /qr - QR code PNG image
 * - POST /send - Send message: { to, message }
 */

import dotenv from 'dotenv';
dotenv.config();

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import { createServer } from 'http';
import { addMessage } from './inbox.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const AUTH_DIR = process.env.WA_PERSONAL_AUTH_DIR || './data/whatsapp-auth';
const QR_PATH = './data/whatsapp-personal-qr.png';
const MEDIA_DIR = './data/media';
const HTTP_PORT = 7700;

// Ensure directories exist
mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
mkdirSync(MEDIA_DIR, { recursive: true });

// Connection state
let sock;
let connectionStatus = 'disconnected';
let qrCodeAvailable = false;

// Create silent logger for Baileys
const logger = pino({ level: 'silent' });

/**
 * Extract message body from various message types
 */
function extractMessageBody(message) {
  if (!message) return null;

  // Text messages
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;

  // Media messages
  if (message.imageMessage) {
    return message.imageMessage.caption || '[Image]';
  }
  if (message.videoMessage) {
    return message.videoMessage.caption || '[Video]';
  }
  if (message.documentMessage) {
    return message.documentMessage.fileName || '[Document]';
  }
  if (message.audioMessage) {
    return '[Voice Note]';
  }
  if (message.stickerMessage) {
    return '[Sticker]';
  }

  // Skip reactions
  if (message.reactionMessage) {
    return null;
  }

  return null;
}

/**
 * Check if message contains media that should be downloaded
 */
function hasDownloadableMedia(message) {
  return !!(message.imageMessage || message.documentMessage);
}

/**
 * Classify message priority based on content
 */
function classifyPriority(body, isGroup) {
  if (!body) return 'normal';

  const lowerBody = body.toLowerCase();
  const urgentKeywords = ['urgent', 'asap', 'emergency', 'nood', 'dringend', 'help', 'please call'];

  if (urgentKeywords.some(kw => lowerBody.includes(kw))) {
    return 'urgent';
  }

  if (isGroup) {
    return 'low';
  }

  return 'normal';
}

/**
 * Connect to WhatsApp
 */
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: true,
    markOnlineOnConnect: false
  });

  // Handle credentials update
  sock.ev.on('creds.update', saveCreds);

  // Handle connection updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR code generated
    if (qr) {
      console.log('[whatsapp] QR code generated, saving to', QR_PATH);
      try {
        await qrcode.toFile(QR_PATH, qr);
        qrCodeAvailable = true;
        connectionStatus = 'waiting-for-qr';
        console.log('[whatsapp] QR code saved. Scan with WhatsApp mobile app.');
      } catch (err) {
        console.error('[whatsapp] Failed to save QR code:', err);
      }
    }

    // Connection opened
    if (connection === 'open') {
      console.log('[whatsapp] Connected to WhatsApp');
      connectionStatus = 'connected';
      qrCodeAvailable = false;
    }

    // Connection closed
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log('[whatsapp] Connection closed. Reason:', lastDisconnect?.error?.message);
      console.log('[whatsapp] Should reconnect:', shouldReconnect);

      if (shouldReconnect) {
        connectionStatus = 'reconnecting';
        console.log('[whatsapp] Reconnecting in 5 seconds...');
        setTimeout(connectToWhatsApp, 5000);
      } else {
        connectionStatus = 'logged-out';
        console.log('[whatsapp] Logged out. Please restart and scan QR code again.');
      }
    }
  });

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      try {
        // Skip own messages and status broadcasts
        if (msg.key.fromMe) continue;
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const chatId = msg.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');
        const senderJid = isGroup ? msg.key.participant : chatId;
        const senderNumber = senderJid.split('@')[0];
        const pushName = msg.pushName || senderNumber;

        // Get group name if applicable
        let chatName = null;
        if (isGroup) {
          try {
            const groupMetadata = await sock.groupMetadata(chatId);
            chatName = groupMetadata.subject;
          } catch (err) {
            console.error('[whatsapp] Failed to get group metadata:', err.message);
            chatName = chatId;
          }
        }

        // Extract message body
        const body = extractMessageBody(msg.message);
        if (!body) continue; // Skip messages we can't extract text from

        // Download media if present
        let mediaPath = null;
        let mediaType = null;
        if (hasDownloadableMedia(msg.message)) {
          try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            const timestamp = Math.floor(Date.now() / 1000);
            const ext = msg.message.imageMessage ? 'jpg' :
                       msg.message.documentMessage?.fileName?.split('.').pop() || 'bin';
            const filename = `wa-${senderNumber}-${timestamp}.${ext}`;
            mediaPath = join(MEDIA_DIR, filename);

            writeFileSync(mediaPath, buffer);

            if (msg.message.imageMessage) {
              mediaType = msg.message.imageMessage.mimetype || 'image/jpeg';
            } else if (msg.message.documentMessage) {
              mediaType = msg.message.documentMessage.mimetype || 'application/octet-stream';
            }

            console.log('[whatsapp] Downloaded media:', filename);
          } catch (err) {
            console.error('[whatsapp] Failed to download media:', err.message);
          }
        }

        // Classify priority
        const priority = classifyPriority(body, isGroup);

        // Add to inbox
        const messageId = addMessage({
          source: 'whatsapp',
          direction: 'in',
          from_name: pushName,
          from_address: senderNumber,
          chat_name: chatName,
          chat_id: chatId,
          body,
          media_path: mediaPath,
          media_type: mediaType,
          timestamp: msg.messageTimestamp,
          is_group: isGroup,
          priority
        });

        console.log(`[whatsapp] Message #${messageId} from ${pushName} (${senderNumber})${isGroup ? ' in ' + chatName : ''}: ${body.substring(0, 50)}...`);
      } catch (err) {
        console.error('[whatsapp] Error processing message:', err);
      }
    }
  });
}

/**
 * Send a WhatsApp message
 */
async function sendMessage(to, message) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }

  // Format number as JID if needed
  let jid = to;
  if (!jid.includes('@')) {
    jid = `${to}@s.whatsapp.net`;
  }

  try {
    await sock.sendMessage(jid, { text: message });

    // Log to inbox
    const recipientNumber = jid.split('@')[0];
    addMessage({
      source: 'whatsapp',
      direction: 'out',
      to_address: recipientNumber,
      body: message,
      timestamp: Math.floor(Date.now() / 1000)
    });

    console.log(`[whatsapp] Sent message to ${recipientNumber}: ${message.substring(0, 50)}...`);
    return true;
  } catch (err) {
    console.error('[whatsapp] Failed to send message:', err);
    throw err;
  }
}

/**
 * HTTP API Server
 */
const CLAW_API_KEY = process.env.CLAW_API_KEY;

function checkAuth(req, res) {
  if (!CLAW_API_KEY) return true; // No key configured = skip (dev mode)
  const key = req.headers['x-api-key'];
  if (key !== CLAW_API_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Auth check for all endpoints
  if (!checkAuth(req, res)) return;

  // GET /status
  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: connectionStatus,
      qrAvailable: qrCodeAvailable
    }));
    return;
  }

  // GET /qr
  if (req.method === 'GET' && url.pathname === '/qr') {
    if (!qrCodeAvailable || !existsSync(QR_PATH)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'QR code not available' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'image/png' });
    const fs = await import('fs');
    fs.createReadStream(QR_PATH).pipe(res);
    return;
  }

  // POST /send
  if (req.method === 'POST' && url.pathname === '/send') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { to, message } = JSON.parse(body);

        if (!to || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "to" or "message" field' }));
          return;
        }

        await sendMessage(to, message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 404 for all other routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`[whatsapp] HTTP API listening on http://127.0.0.1:${HTTP_PORT}`);
  console.log('[whatsapp] Endpoints:');
  console.log('  GET  /status - Connection status');
  console.log('  GET  /qr - QR code image');
  console.log('  POST /send - Send message: { to, message }');
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\n[whatsapp] Shutting down...');
  if (sock) {
    await sock.end();
  }
  server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start connection
console.log('[whatsapp] Starting WhatsApp Personal Connector...');
console.log('[whatsapp] Auth directory:', AUTH_DIR);
console.log('[whatsapp] Media directory:', MEDIA_DIR);
connectToWhatsApp().catch(err => {
  console.error('[whatsapp] Fatal error:', err);
  process.exit(1);
});
