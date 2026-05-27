#!/usr/bin/env node
/**
 * Email Sender - SMTP send via Nodemailer with inbox logging
 *
 * Sends emails via Zoho SMTP and logs all outbound messages to the unified inbox.
 * Uses STARTTLS on port 587 for secure email delivery.
 */

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { addMessage } from './inbox.mjs';

// Load environment variables
dotenv.config();

// SMTP Configuration from .env
const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.zoho.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false, // STARTTLS (use true for port 465)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
};

const EMAIL_FROM = process.env.EMAIL_FROM || process.env.SMTP_USER;

// Create transporter
let transporter;
try {
  transporter = nodemailer.createTransport(SMTP_CONFIG);
} catch (error) {
  console.error('[email-sender] Failed to create transporter:', error.message);
}

/**
 * Verify SMTP connection
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function verifySmtp() {
  if (!transporter) {
    return { ok: false, error: 'Transporter not initialized' };
  }

  try {
    await transporter.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Send an email via Zoho SMTP
 * @param {Object} options - Email options
 * @param {string|string[]} options.to - Recipient email address(es)
 * @param {string} options.subject - Email subject
 * @param {string} options.body - Email body (plain text or HTML)
 * @param {Array} [options.attachments=[]] - Array of attachments (file paths or objects)
 * @param {string} [options.from] - Sender address (defaults to EMAIL_FROM)
 * @param {string} [options.replyTo] - Reply-to address
 * @param {string} [options.cc] - CC addresses
 * @param {string} [options.bcc] - BCC addresses
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
 */
export async function sendEmail({ to, subject, body, attachments = [], from = EMAIL_FROM, replyTo, cc, bcc }) {
  if (!transporter) {
    const error = 'Transporter not initialized';
    console.error('[email-sender]', error);
    return { ok: false, error };
  }

  if (!to || !subject || !body) {
    const error = 'Missing required fields: to, subject, body';
    console.error('[email-sender]', error);
    return { ok: false, error };
  }

  try {
    // Prepare mail options
    const mailOptions = {
      from,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text: body, // Plain text body
      html: body.includes('<html') || body.includes('<div') || body.includes('<p>') ? body : undefined,
      attachments: processAttachments(attachments)
    };

    // Optional fields
    if (replyTo) mailOptions.replyTo = replyTo;
    if (cc) mailOptions.cc = cc;
    if (bcc) mailOptions.bcc = bcc;

    // Send email
    const info = await transporter.sendMail(mailOptions);

    // Log to inbox
    addMessage({
      source: 'email-zoho',
      direction: 'out',
      from_name: 'WhatsAuction Bot',
      from_address: from,
      to_address: Array.isArray(to) ? to.join(', ') : to,
      subject,
      body,
      timestamp: Math.floor(Date.now() / 1000),
      is_read: 1, // Mark outbound as read
      priority: 'normal'
    });

    console.log('[email-sender] Email sent:', {
      messageId: info.messageId,
      to: mailOptions.to,
      subject
    });

    return { ok: true, messageId: info.messageId };
  } catch (error) {
    console.error('[email-sender] Failed to send email:', error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Process attachments into nodemailer format
 * @param {Array} attachments - Array of file paths or attachment objects
 * @returns {Array} - Array of nodemailer attachment objects
 */
function processAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }

  return attachments.map(att => {
    // If it's a string, treat it as a file path
    if (typeof att === 'string') {
      return { path: att };
    }

    // If it's already an object, pass it through
    // Expected format: { filename, path } or { filename, content }
    return att;
  });
}

// Export for direct CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('[email-sender] Email Sender initialized');
  console.log('[email-sender] SMTP Host:', SMTP_CONFIG.host);
  console.log('[email-sender] SMTP Port:', SMTP_CONFIG.port);
  console.log('[email-sender] SMTP User:', SMTP_CONFIG.auth.user);
  console.log('[email-sender] From Address:', EMAIL_FROM);

  // Verify SMTP connection
  console.log('[email-sender] Verifying SMTP connection...');
  verifySmtp().then(result => {
    if (result.ok) {
      console.log('[email-sender] SMTP connection verified successfully');
    } else {
      console.error('[email-sender] SMTP verification failed:', result.error);
    }
    process.exit(result.ok ? 0 : 1);
  });
}
