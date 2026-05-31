#!/usr/bin/env node

/**
 * Subject detection for multi-task orchestration
 * Detects project/subject from user messages using hashtags, keywords, or carry-forward
 */

// Known subject normalization map (for hashtags)
const KNOWN_SUBJECTS = {
  whatsauction: 'WhatsAuction',
  auction: 'WhatsAuction',
  flashvault: 'FlashVault',
  vault: 'FlashVault',
  relay: 'Relay',
  'hydra-note': 'Relay',
  hydranote: 'Relay',
  recon: 'Recon',
  friday: 'Friday',
  'friday-bot': 'Friday',
  octo: 'Octo',
};

// Keyword map for subject detection (case-insensitive)
const KEYWORDS = {
  WhatsAuction: ['whatsauction', 'auction', 'bid', 'lot', 'auctioneer'],
  FlashVault: ['flashvault', 'vpn', 'vault'],
  Relay: ['relay', 'hydra-note', 'predsea', 'yacht', 'captain', 'crew'],
  Recon: ['recon', 'bd hackathon', 'lablab', 'competitive intelligence'],
  Friday: ['friday-bot', 'multitask', 'orchestrator', 'task pool'],
  Octo: ['octo-workspace', 'octo agent'],
};

/**
 * Detect subject from message text and context
 * @param {string} text - User message
 * @param {object} ctx - Telegram context (optional, for carry-forward)
 * @returns {string|null} Subject name or null
 */
export function detectSubject(text, ctx = null) {
  // Priority 1: Hashtag detection
  const hashtagMatch = text.match(/#(\w+)/);
  if (hashtagMatch) {
    const tag = hashtagMatch[1].toLowerCase();
    const normalized = KNOWN_SUBJECTS[tag];
    if (normalized) {
      return normalized;
    }
    // Unknown hashtag — capitalize first letter
    return tag.charAt(0).toUpperCase() + tag.slice(1);
  }

  // Priority 2: Keyword detection
  const lowerText = text.toLowerCase();
  for (const [subject, keywords] of Object.entries(KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        return subject;
      }
    }
  }

  // Priority 3: Carry-forward from recent task
  if (ctx && ctx.getRecentTasksByUser) {
    try {
      const userId = ctx.from?.id;
      if (userId) {
        const recent = ctx.getRecentTasksByUser(userId, 1);
        if (recent.length > 0) {
          const lastTask = recent[0];
          const age = Date.now() - lastTask.created_at;
          // Carry forward if last task was < 5 minutes ago
          if (age < 5 * 60 * 1000 && lastTask.subject) {
            return lastTask.subject;
          }
        }
      }
    } catch (err) {
      // Carry-forward failed — not critical
      console.error('[SubjectDetector] Carry-forward failed:', err.message);
    }
  }

  // Default: no subject detected
  return null;
}

/**
 * Test function for unit testing without ctx
 * @param {string} text
 * @returns {string|null}
 */
export function __test_detectSubject(text) {
  return detectSubject(text, null);
}
