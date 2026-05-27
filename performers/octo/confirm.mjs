import { InlineKeyboard } from 'grammy';

// Store pending actions: actionId -> { type, data, chatId, description, timestamp }
const pending = new Map();

// Cleanup interval (60s)
const CLEANUP_INTERVAL_MS = 60 * 1000;
// Action expiry timeout (5 min)
const ACTION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Generate a unique action ID
 * @returns {string} Format: act_${timestamp}_${random6chars}
 */
export function generateActionId() {
  const timestamp = Date.now();
  const randomChars = Math.random().toString(36).substring(2, 8).padEnd(6, '0');
  return `act_${timestamp}_${randomChars}`;
}

/**
 * Create inline keyboard with confirm/edit/cancel buttons
 * @param {string} actionId - The action identifier
 * @returns {InlineKeyboard} Grammy InlineKeyboard instance
 */
export function createConfirmKeyboard(actionId) {
  return new InlineKeyboard()
    .text('✅ Send', `confirm:${actionId}`)
    .text('✏️ Edit', `edit:${actionId}`)
    .text('❌ Cancel', `cancel:${actionId}`);
}

/**
 * Add a pending action with auto-cleanup timeout
 * @param {string} actionId - The action identifier
 * @param {Object} actionData - Action data
 * @param {string} actionData.type - Action type: 'whatsapp', 'email', 'command'
 * @param {any} actionData.data - Action-specific data
 * @param {number} actionData.chatId - Telegram chat ID
 * @param {string} actionData.description - Human-readable description
 */
export function addPendingAction(actionId, { type, data, chatId, description }) {
  const timestamp = Date.now();
  pending.set(actionId, {
    type,
    data,
    chatId,
    description,
    timestamp,
  });

  // Auto-cleanup after timeout
  setTimeout(() => {
    if (pending.has(actionId)) {
      const action = pending.get(actionId);
      if (Date.now() - action.timestamp >= ACTION_TIMEOUT_MS) {
        pending.delete(actionId);
      }
    }
  }, ACTION_TIMEOUT_MS);
}

/**
 * Get a pending action by ID
 * @param {string} actionId - The action identifier
 * @returns {Object|undefined} The action data or undefined if not found
 */
export function getPendingAction(actionId) {
  return pending.get(actionId);
}

/**
 * Remove a pending action by ID
 * @param {string} actionId - The action identifier
 * @returns {boolean} True if action was removed, false if not found
 */
export function removePendingAction(actionId) {
  return pending.delete(actionId);
}

/**
 * Periodic cleanup of expired actions
 */
function cleanupExpiredActions() {
  const now = Date.now();
  for (const [actionId, action] of pending.entries()) {
    if (now - action.timestamp >= ACTION_TIMEOUT_MS) {
      pending.delete(actionId);
    }
  }
}

// Start periodic cleanup
setInterval(cleanupExpiredActions, CLEANUP_INTERVAL_MS);

// Default export
export default {
  generateActionId,
  createConfirmKeyboard,
  addPendingAction,
  getPendingAction,
  removePendingAction,
};
