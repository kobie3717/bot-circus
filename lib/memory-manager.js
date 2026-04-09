import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Memory manager for bot workspaces and troupe sharing
 */
export class MemoryManager {
  /**
   * @param {Object} logger - Pino logger instance
   */
  constructor(logger) {
    this.logger = logger;
    this.performersDir = path.join(ROOT_DIR, 'performers');
    this.troupesDir = path.join(ROOT_DIR, 'troupes');

    // Ensure directories exist
    this.#ensureDir(this.performersDir);
    this.#ensureDir(this.troupesDir);
  }

  /**
   * Create directories if they don't exist
   * @private
   */
  #ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Initialize a bot workspace
   * @param {string} botId - Bot identifier
   * @param {Object} options - Initialization options
   * @returns {string} - Workspace path
   */
  async initBotWorkspace(botId, options = {}) {
    const workspacePath = path.join(this.performersDir, botId);

    if (fs.existsSync(workspacePath)) {
      throw new Error(`Workspace already exists for bot ${botId}`);
    }

    this.#ensureDir(workspacePath);
    this.#ensureDir(path.join(workspacePath, 'memory'));

    // Create config.json
    const config = {
      id: botId,
      name: options.name || botId,
      token: options.token,
      troupe: options.troupe || null,
      persona_file: 'SOUL.md',
      rate_limits: {
        messages_per_minute: options.messagesPerMinute || 20,
        max_queue_size: options.maxQueueSize || 100
      },
      claude_config: {
        model: 'claude-sonnet-4-5',
        timeout_ms: 120000,
        streaming: true
      },
      telegram_config: {
        polling_interval: 1000,
        allowed_users: options.allowedUsers || [],
        respond_to_groups: options.respondToGroups ?? true
      },
      enabled: true,
      created_at: new Date().toISOString()
    };

    fs.writeFileSync(
      path.join(workspacePath, 'config.json'),
      JSON.stringify(config, null, 2)
    );

    // Copy or create persona file
    if (options.personaFile && fs.existsSync(options.personaFile)) {
      fs.copyFileSync(options.personaFile, path.join(workspacePath, 'SOUL.md'));
    } else {
      // Create default persona
      const defaultPersona = `# Bot Persona

You are ${options.name || botId}, a helpful AI assistant on Telegram.

## Role
Assist users with their questions and tasks professionally and efficiently.

## Behavior
- Be concise and direct
- Use markdown formatting when helpful
- Ask clarifying questions when needed
- Be friendly but professional
`;
      fs.writeFileSync(path.join(workspacePath, 'SOUL.md'), defaultPersona);
    }

    // Create IDENTITY.md
    const identity = `# Bot Identity

**Name:** ${options.name || botId}
**ID:** ${botId}
**Platform:** Telegram
**Capabilities:** Text conversation, Claude Code CLI integration
`;
    fs.writeFileSync(path.join(workspacePath, 'IDENTITY.md'), identity);

    // Create USER.md
    const userRules = `# User Behavior Rules

- Respond to all messages promptly
- Format responses in Markdown
- Keep responses under 4096 characters (Telegram limit)
- Use line breaks for readability
`;
    fs.writeFileSync(path.join(workspacePath, 'USER.md'), userRules);

    // Create initial MEMORY.md (or symlink if joining troupe)
    if (options.troupe) {
      await this.joinTroupe(botId, options.troupe);
    } else {
      const memory = `# Bot Memory

*This bot's conversation history and learned context will be stored here.*

## Recent Conversations

`;
      fs.writeFileSync(path.join(workspacePath, 'MEMORY.md'), memory);
    }

    this.logger.info({ botId, workspacePath }, 'Initialized bot workspace');
    return workspacePath;
  }

  /**
   * Create a troupe (shared memory group)
   * @param {string} troupeName - Troupe name
   */
  async createTroupe(troupeName) {
    const troupePath = path.join(this.troupesDir, troupeName);

    if (fs.existsSync(troupePath)) {
      throw new Error(`Troupe ${troupeName} already exists`);
    }

    this.#ensureDir(troupePath);

    // Create shared MEMORY.md
    const memory = `# Troupe Memory: ${troupeName}

*Shared memory for all bots in the ${troupeName} troupe.*

## Members
See members.json for current members.

## Shared Knowledge

`;
    fs.writeFileSync(path.join(troupePath, 'MEMORY.md'), memory);

    // Create members.json
    fs.writeFileSync(
      path.join(troupePath, 'members.json'),
      JSON.stringify([], null, 2)
    );

    this.logger.info({ troupeName, troupePath }, 'Created troupe');
  }

  /**
   * Join a bot to a troupe (symlink MEMORY.md)
   * @param {string} botId - Bot identifier
   * @param {string} troupeName - Troupe name
   */
  async joinTroupe(botId, troupeName) {
    const botMemoryPath = path.join(this.performersDir, botId, 'MEMORY.md');
    const troupeMemoryPath = path.join(this.troupesDir, troupeName, 'MEMORY.md');
    const membersFile = path.join(this.troupesDir, troupeName, 'members.json');

    if (!fs.existsSync(troupeMemoryPath)) {
      throw new Error(`Troupe ${troupeName} does not exist`);
    }

    // Backup existing local memory if it exists and is not a symlink
    if (fs.existsSync(botMemoryPath)) {
      const stats = fs.lstatSync(botMemoryPath);
      if (!stats.isSymbolicLink()) {
        const backupPath = `${botMemoryPath}.backup`;
        fs.renameSync(botMemoryPath, backupPath);
        this.logger.info({ botId, backupPath }, 'Backed up local memory');
      } else {
        // Already a symlink, remove it
        fs.unlinkSync(botMemoryPath);
      }
    }

    // Create symlink
    fs.symlinkSync(path.resolve(troupeMemoryPath), botMemoryPath, 'file');
    this.logger.info({ botId, troupeName }, 'Created memory symlink');

    // Update troupe membership
    const members = JSON.parse(fs.readFileSync(membersFile, 'utf8'));
    if (!members.includes(botId)) {
      members.push(botId);
      fs.writeFileSync(membersFile, JSON.stringify(members, null, 2));
    }

    // Update bot config
    const configPath = path.join(this.performersDir, botId, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.troupe = troupeName;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
  }

  /**
   * Remove a bot from a troupe
   * @param {string} botId - Bot identifier
   */
  async leaveTroupe(botId) {
    const botMemoryPath = path.join(this.performersDir, botId, 'MEMORY.md');
    const configPath = path.join(this.performersDir, botId, 'config.json');

    if (!fs.existsSync(configPath)) {
      throw new Error(`Bot ${botId} does not exist`);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const troupeName = config.troupe;

    if (!troupeName) {
      throw new Error(`Bot ${botId} is not in a troupe`);
    }

    // Remove symlink
    if (fs.existsSync(botMemoryPath)) {
      const stats = fs.lstatSync(botMemoryPath);
      if (stats.isSymbolicLink()) {
        fs.unlinkSync(botMemoryPath);
      }
    }

    // Restore backup or create new local memory
    const backupPath = `${botMemoryPath}.backup`;
    if (fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, botMemoryPath);
      this.logger.info({ botId }, 'Restored memory backup');
    } else {
      const memory = `# Bot Memory

*This bot's conversation history and learned context will be stored here.*

## Recent Conversations

`;
      fs.writeFileSync(botMemoryPath, memory);
      this.logger.info({ botId }, 'Created new local memory');
    }

    // Remove from troupe members
    const membersFile = path.join(this.troupesDir, troupeName, 'members.json');
    if (fs.existsSync(membersFile)) {
      const members = JSON.parse(fs.readFileSync(membersFile, 'utf8'));
      const filtered = members.filter(id => id !== botId);
      fs.writeFileSync(membersFile, JSON.stringify(filtered, null, 2));
    }

    // Update bot config
    config.troupe = null;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    this.logger.info({ botId, troupeName }, 'Left troupe');
  }

  /**
   * List all troupes
   * @returns {Array} - Array of troupe objects
   */
  listTroupes() {
    if (!fs.existsSync(this.troupesDir)) {
      return [];
    }

    const troupes = [];
    const entries = fs.readdirSync(this.troupesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const membersFile = path.join(this.troupesDir, entry.name, 'members.json');
        const members = fs.existsSync(membersFile)
          ? JSON.parse(fs.readFileSync(membersFile, 'utf8'))
          : [];

        troupes.push({
          name: entry.name,
          members,
          memberCount: members.length
        });
      }
    }

    return troupes;
  }

  /**
   * Get troupe members
   * @param {string} troupeName - Troupe name
   * @returns {Array} - Array of bot IDs
   */
  getTroupeMembers(troupeName) {
    const membersFile = path.join(this.troupesDir, troupeName, 'members.json');
    if (!fs.existsSync(membersFile)) {
      throw new Error(`Troupe ${troupeName} does not exist`);
    }
    return JSON.parse(fs.readFileSync(membersFile, 'utf8'));
  }

  /**
   * Delete a bot workspace
   * @param {string} botId - Bot identifier
   * @param {boolean} keepWorkspace - Keep workspace files
   */
  async deleteBot(botId, keepWorkspace = false) {
    const workspacePath = path.join(this.performersDir, botId);

    if (!fs.existsSync(workspacePath)) {
      throw new Error(`Bot ${botId} does not exist`);
    }

    // Leave troupe if member
    const configPath = path.join(workspacePath, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.troupe) {
        await this.leaveTroupe(botId);
      }
    }

    if (!keepWorkspace) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      this.logger.info({ botId }, 'Deleted bot workspace');
    } else {
      this.logger.info({ botId }, 'Bot removed but workspace kept');
    }
  }

  /**
   * Get bot workspace path
   * @param {string} botId - Bot identifier
   * @returns {string} - Workspace path
   */
  getWorkspacePath(botId) {
    return path.join(this.performersDir, botId);
  }
}
