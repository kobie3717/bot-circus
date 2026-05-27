import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Whitelisted safe actions - NO user input is ever interpolated
const ACTIONS = {
  'restart-whatsauction': {
    cmd: 'docker restart whatsauction-api',
    confirm: true,
    warning: '~10s downtime for WhatsAuction API',
    description: 'Restart WhatsAuction Docker container'
  },
  'restart-flashvault': {
    cmd: 'systemctl restart vpn-backend',
    confirm: true,
    warning: '~5s downtime for FlashVault API',
    description: 'Restart FlashVault backend service'
  },
  'restart-whatsbookings': {
    cmd: 'docker restart whatsbookings',
    confirm: true,
    warning: '~10s downtime for WhatsBookings',
    description: 'Restart WhatsBookings Docker container'
  },
  'logs-whatsauction': {
    cmd: 'docker logs whatsauction-api --tail 50 2>&1',
    confirm: false,
    description: 'Show last 50 lines of WhatsAuction logs'
  },
  'logs-flashvault': {
    cmd: 'journalctl -u vpn-backend --no-pager -n 50',
    confirm: false,
    description: 'Show last 50 lines of FlashVault logs'
  },
  'disk': {
    cmd: 'df -h /',
    confirm: false,
    description: 'Check disk usage'
  },
  'memory': {
    cmd: 'free -h',
    confirm: false,
    description: 'Check memory usage'
  },
  'docker-ps': {
    cmd: 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
    confirm: false,
    description: 'List running Docker containers'
  },
  'pm2-status': {
    cmd: 'pm2 status',
    confirm: false,
    description: 'List PM2 process statuses'
  },
  'deploy-whatsauction': {
    cmd: 'cd /root/whatsauction && gh workflow run release.yml --ref main',
    confirm: true,
    warning: 'Full CI/CD deploy pipeline will run',
    description: 'Trigger WhatsAuction deploy via GitHub Actions'
  },
  'ssl-check': {
    cmd: 'for d in whatsauction.co.za flashvault.co.za; do echo -n "$d: "; echo | openssl s_client -servername $d -connect $d:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null || echo "FAILED"; done',
    confirm: false,
    description: 'Check SSL certificate expiry dates'
  }
};

/**
 * Get action definition by name
 * @param {string} name - Action name
 * @returns {object|null} Action definition or null if not found
 */
export function getAction(name) {
  return ACTIONS[name] || null;
}

/**
 * List all available actions
 * @returns {Array<{name: string, description: string, needsConfirm: boolean}>}
 */
export function listActions() {
  return Object.entries(ACTIONS).map(([name, action]) => ({
    name,
    description: action.description,
    needsConfirm: action.confirm
  }));
}

/**
 * Execute a whitelisted action
 * @param {string} name - Action name
 * @returns {Promise<{ok: boolean, output?: string, error?: string}>}
 */
export async function executeAction(name) {
  const action = ACTIONS[name];

  if (!action) {
    return { ok: false, error: 'Unknown action' };
  }

  try {
    const { stdout, stderr } = await execAsync(action.cmd, {
      timeout: 60000, // 60 second timeout
      maxBuffer: 5 * 1024 * 1024 // 5MB buffer
    });

    let output = stdout || stderr || '';

    // Truncate to 4000 chars if needed
    if (output.length > 4000) {
      output = output.slice(0, 4000) + '\n... (truncated)';
    }

    return { ok: true, output };
  } catch (error) {
    let errorMsg = error.message;

    // Include stderr if available
    if (error.stderr) {
      errorMsg += '\n' + error.stderr;
    }

    // Truncate error to 4000 chars
    if (errorMsg.length > 4000) {
      errorMsg = errorMsg.slice(0, 4000) + '\n... (truncated)';
    }

    return { ok: false, error: errorMsg };
  }
}
