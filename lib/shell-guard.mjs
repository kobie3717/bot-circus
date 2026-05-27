// Shell command guard - adapted from Mercury-agent
// Prevents dangerous commands from executing

export const BLOCKED = [
  'sudo *',
  'rm -rf /',
  'rm -rf ~',
  'rm -rf /*',
  'mkfs *',
  'dd if=*',
  'chmod 777 /',
  'chown * /',
  ':(){ :|:& };:',
  'shutdown *',
  'reboot *',
  'halt *',
  'init 0',
  'init 6',
  'kill -9 1',
  '> /dev/sda',
  'mv /* /dev/null',
  'del /s /q C:\\*',
  'rmdir /s /q C:\\*',
  'format *',
  'net user *',
  'netsh *',
  'reg delete *',
];

export const AUTO_APPROVED = [
  'ls *',
  'cat *',
  'pwd',
  'which *',
  'node *',
  'npm run *',
  'npm test *',
  'npm list *',
  'git status *',
  'git diff *',
  'git log *',
  'git branch *',
  'echo *',
  'head *',
  'tail *',
  'wc *',
  'find *',
  'grep *',
  'rg *',
  'ps *',
  'df *',
  'du *',
  'uname *',
  'curl *',
  'wget *',
  'pm2 list *',
  'pm2 status *',
  'docker ps *',
  'docker logs *',
];

export const NEEDS_APPROVAL = [
  'npm publish *',
  'git push *',
  'docker *',
  'curl * | sh',
  'curl * | bash',
  'wget * | sh',
  'pip install *',
  'pip3 install *',
  'rm -r *',
  'rm -rf *',
  'mv *',
  'cp -r *',
  'chmod *',
  'mkdir *',
  'rmdir *',
];

/**
 * Match a command against a glob pattern
 * @param {string} cmd - Command to check
 * @param {string} pattern - Glob pattern (* = any, ? = single char)
 * @returns {boolean} - True if matched
 */
function matchPattern(cmd, pattern) {
  // Escape regex special chars except * and ?
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(cmd.trim());
}

/**
 * Check if a command is allowed, blocked, or needs approval
 * @param {string} cmd - Command to check
 * @returns {{ decision: 'blocked'|'auto'|'needs_approval'|'unknown', reason: string }}
 */
export function checkCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') {
    return { decision: 'blocked', reason: 'Invalid command' };
  }

  const normalized = cmd.trim();

  // Check BLOCKED first (highest priority)
  for (const pattern of BLOCKED) {
    if (matchPattern(normalized, pattern)) {
      return {
        decision: 'blocked',
        reason: `Matches blocked pattern: ${pattern}`,
      };
    }
  }

  // Check AUTO_APPROVED
  for (const pattern of AUTO_APPROVED) {
    if (matchPattern(normalized, pattern)) {
      return {
        decision: 'auto',
        reason: `Matches auto-approved pattern: ${pattern}`,
      };
    }
  }

  // Check NEEDS_APPROVAL
  for (const pattern of NEEDS_APPROVAL) {
    if (matchPattern(normalized, pattern)) {
      return {
        decision: 'needs_approval',
        reason: `Matches approval-required pattern: ${pattern}`,
      };
    }
  }

  // Unknown/unmatched commands
  return {
    decision: 'unknown',
    reason: 'Command does not match any known pattern',
  };
}
