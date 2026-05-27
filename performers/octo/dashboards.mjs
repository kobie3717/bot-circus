/**
 * Business and Server Dashboard Queries
 *
 * Provides health metrics for:
 * - WhatsAuction (signups, auctions, bids)
 * - FlashVault (users, subscriptions, WireGuard peers)
 * - Server (disk, memory, load, docker, pm2)
 */

import pg from 'pg';
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();

const exec = promisify(execCallback);

// Lazy pool initialization
let waPool = null;
let fvPool = null;

/**
 * Get or create WhatsAuction database pool
 */
function getWAPool() {
  if (!waPool) {
    waPool = new pg.Pool({
      connectionString: process.env.WA_DB_URL,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    waPool.on('error', (err) => {
      console.error('WhatsAuction pool error:', err);
    });
  }
  return waPool;
}

/**
 * Get or create FlashVault database pool
 */
function getFVPool() {
  if (!fvPool) {
    fvPool = new pg.Pool({
      connectionString: process.env.FV_DB_URL,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    fvPool.on('error', (err) => {
      console.error('FlashVault pool error:', err);
    });
  }
  return fvPool;
}

/**
 * Execute shell command with timeout and error handling
 */
async function execSafe(command, timeoutMs = 10000) {
  try {
    const { stdout, stderr } = await exec(command, { timeout: timeoutMs });
    if (stderr && !stdout) {
      return { error: stderr.trim() };
    }
    return stdout.trim();
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * WhatsAuction Dashboard
 *
 * Returns signups, auction/bid activity, and API health
 */
export async function whatsauctionDashboard() {
  const pool = getWAPool();
  const result = {
    signups24h: 0,
    signups7d: 0,
    auctions: {},
    bids24h: 0,
    apiHealth: null
  };

  try {
    // Signups in last 24 hours
    const signups24 = await pool.query(
      `SELECT COUNT(*) as count FROM "User" WHERE "createdAt" > NOW() - INTERVAL '24 hours'`
    );
    result.signups24h = parseInt(signups24.rows[0].count, 10);

    // Signups in last 7 days
    const signups7 = await pool.query(
      `SELECT COUNT(*) as count FROM "User" WHERE "createdAt" > NOW() - INTERVAL '7 days'`
    );
    result.signups7d = parseInt(signups7.rows[0].count, 10);

    // Auctions grouped by status
    const auctions = await pool.query(
      `SELECT status, COUNT(*) as count FROM "Auction" GROUP BY status`
    );
    auctions.rows.forEach(row => {
      result.auctions[row.status] = parseInt(row.count, 10);
    });

    // Bids in last 24 hours
    const bids24 = await pool.query(
      `SELECT COUNT(*) as count FROM "Bid" WHERE "createdAt" > NOW() - INTERVAL '24 hours'`
    );
    result.bids24h = parseInt(bids24.rows[0].count, 10);

  } catch (err) {
    result.error = `Database error: ${err.message}`;
  }

  // API health check (independent of DB)
  const health = await execSafe('curl -sf http://localhost:4000/health');
  result.apiHealth = typeof health === 'string' ? 'OK' : health.error;

  return result;
}

/**
 * FlashVault Dashboard
 *
 * Returns user/subscription counts, active WireGuard peers, and API health
 */
export async function flashvaultDashboard() {
  const pool = getFVPool();
  const result = {
    totalUsers: 0,
    subscriptions: {},
    activePeers: 0,
    apiHealth: null
  };

  try {
    // Total users
    const users = await pool.query(`SELECT COUNT(*) as count FROM users`);
    result.totalUsers = parseInt(users.rows[0].count, 10);

    // Subscriptions grouped by status
    const subs = await pool.query(
      `SELECT status, COUNT(*) as count FROM subscriptions GROUP BY status`
    );
    subs.rows.forEach(row => {
      result.subscriptions[row.status] = parseInt(row.count, 10);
    });

  } catch (err) {
    result.error = `Database error: ${err.message}`;
  }

  // WireGuard active peers
  const peers = await execSafe('wg show wg0 | grep -c "peer:"');
  result.activePeers = typeof peers === 'string' ? parseInt(peers, 10) || 0 : 0;

  // API health check
  const health = await execSafe('curl -sf http://localhost:3000/health');
  result.apiHealth = typeof health === 'string' ? 'OK' : health.error;

  return result;
}

/**
 * Server Dashboard
 *
 * Returns disk, memory, load, docker, and pm2 status
 */
export async function serverDashboard() {
  const result = {
    disk: null,
    mem: null,
    load: null,
    docker: null,
    pm2: null
  };

  // Disk usage
  const disk = await execSafe('df -h / | tail -1');
  result.disk = disk;

  // Memory usage
  const mem = await execSafe('free -h | grep Mem');
  result.mem = mem;

  // Load average
  const load = await execSafe('uptime');
  result.load = load;

  // Docker containers (first 15)
  const docker = await execSafe('docker ps --format "{{.Names}} {{.Status}}" | head -15');
  result.docker = docker;

  // PM2 processes
  const pm2 = await execSafe('pm2 jlist');
  if (typeof pm2 === 'string') {
    try {
      const processes = JSON.parse(pm2);
      result.pm2 = processes.map(p => ({
        name: p.name,
        status: p.pm2_env?.status || 'unknown',
        uptime: p.pm2_env?.pm_uptime || null,
        restarts: p.pm2_env?.restart_time || 0
      }));
    } catch {
      result.pm2 = { error: 'Failed to parse pm2 output' };
    }
  } else {
    result.pm2 = pm2; // error object
  }

  return result;
}

/**
 * Full Dashboard
 *
 * Runs all 3 dashboards in parallel
 */
export async function fullDashboard() {
  const [whatsauction, flashvault, server] = await Promise.all([
    whatsauctionDashboard(),
    flashvaultDashboard(),
    serverDashboard()
  ]);

  return { whatsauction, flashvault, server };
}

/**
 * Cleanup pools on process exit
 */
process.on('exit', async () => {
  if (waPool) await waPool.end();
  if (fvPool) await fvPool.end();
});
