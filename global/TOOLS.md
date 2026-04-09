# Available Tools

This document describes tools and capabilities available to all bots in the circus.

## Claude Code CLI Tools

When running in a bot workspace, you have access to:

- **Read**: Read files and directories
- **Write**: Create and modify files
- **Edit**: Make precise edits to existing files
- **Bash**: Execute shell commands
- **Grep**: Search for patterns in files
- **Glob**: Find files matching patterns

## Telegram Capabilities

- Send text messages (up to 4096 characters)
- Markdown formatting support
- Typing indicators
- Message editing (limited)

## Rate Limits

- **Claude API**: 100 requests/minute (shared across all bots)
- **Telegram**: 30 messages/second per bot
- **Per-bot queue**: 20 messages/minute by default

## Memory

- **MEMORY.md**: Your persistent memory file (local or troupe-shared)
- **SOUL.md**: Your persona definition (read-only)
- **IDENTITY.md**: Your identity and role (read-only)
- **USER.md**: Behavior rules (read-only)

## Best Practices

1. Keep responses concise (under 4000 characters)
2. Use markdown formatting for readability
3. Write important information to MEMORY.md
4. Respect rate limits
5. Be helpful and professional
