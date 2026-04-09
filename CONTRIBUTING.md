# Contributing to Bot-Circus

Thank you for your interest in contributing to Bot-Circus!

## Development Setup

```bash
# Clone the repository
git clone https://github.com/kobie3717/bot-circus
cd bot-circus

# Install dependencies
npm install

# Run tests
bash test-installation.sh
```

## Project Structure

```
bot-circus/
├── bin/
│   └── circus.js              # CLI entry point
├── lib/
│   ├── orchestrator.js        # Main orchestrator class
│   ├── worker-pool.js         # Claude CLI subprocess pool
│   ├── message-queue.js       # Per-bot FIFO queue
│   ├── memory-manager.js      # Workspace and troupe management
│   ├── telegram-client.js     # Telegram Bot API wrapper
│   ├── metrics.js             # Prometheus metrics collector
│   └── rate-limiter.js        # Token bucket rate limiter
├── templates/
│   ├── default.soul.md
│   ├── customer-support.soul.md
│   ├── sales-agent.soul.md
│   ├── dev-helper.soul.md
│   └── meme-lord.soul.md
├── global/
│   └── TOOLS.md               # Global reference docs
├── performers/                # Bot workspaces (created at runtime)
│   └── <bot-id>/
│       ├── config.json
│       ├── SOUL.md
│       ├── IDENTITY.md
│       ├── USER.md
│       ├── MEMORY.md
│       └── memory/
├── troupes/                   # Shared memory groups (created at runtime)
│   └── <troupe-name>/
│       ├── MEMORY.md
│       └── members.json
├── circus.config.json         # Global configuration
├── package.json
├── README.md
├── SPEC.md
├── EXAMPLES.md
├── CONTRIBUTING.md
└── test-installation.sh       # Integration tests

```

## Code Style

- **ES Modules**: Use `import`/`export`, not `require()`
- **JSDoc**: Document all public methods
- **Error handling**: Always wrap in try/catch, never crash orchestrator
- **Logging**: Use pino logger with appropriate levels
- **No process.exit()**: Only in CLI code, never in library code

## Adding a New Feature

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/my-feature`
3. **Make your changes**
4. **Test thoroughly**: Ensure all existing tests pass
5. **Document**: Update README.md and relevant docs
6. **Commit**: Use clear commit messages
7. **Push**: `git push origin feature/my-feature`
8. **Create a Pull Request**

## Testing Guidelines

### Manual Testing

```bash
# Test bot creation
circus add-performer --name TestBot --token TEST_TOKEN

# Test troupe functionality
circus add-troupe test-troupe
circus join-troupe testbot test-troupe
circus list-troupes

# Test orchestrator
circus serve &
circus list
circus stats
circus health

# Cleanup
circus stop
circus rm-performer testbot
```

### Automated Testing

Run the test script:

```bash
bash test-installation.sh
```

All tests must pass before submitting a PR.

## Architecture Decisions

### Why Single Process?

- **Resource Efficiency**: 100 bots in ~1GB RAM vs ~10GB with Docker
- **Simplicity**: No container orchestration needed
- **Fast Startup**: All bots start in <5s
- **Easy Debugging**: Single process to attach debugger to

### Why Symlinks for Memory?

- **Real-time Sync**: Changes are immediate, no polling needed
- **Zero Overhead**: No file copying or duplication
- **Atomic Operations**: Symlink creation/deletion is atomic
- **Simple Implementation**: Native filesystem feature

### Why Fair Scheduling?

- **Prevent Starvation**: One busy bot can't block others
- **Balanced Load**: Distribute workers evenly across bots
- **Better UX**: All bots get responsive service

## Common Issues

### "Orchestrator not running" error

The `circus serve` command must be running for CLI commands to work. Use:

```bash
# In one terminal
circus serve

# In another terminal
circus list
```

Or use systemd to run as a service.

### Symlink Issues

If symlinks aren't working, ensure:
1. Filesystem supports symlinks (ext4, btrfs, etc.)
2. Not running on FAT32 or NTFS without WSL
3. Correct permissions on troupes directory

### Module Import Errors

Ensure you're using:
- Node.js ≥20
- `"type": "module"` in package.json
- `.js` extensions in import statements

## Versioning

We use [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes to API or CLI
- **MINOR**: New features, backwards compatible
- **PATCH**: Bug fixes, backwards compatible

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

Open an issue on GitHub or reach out to [@kobie3717](https://github.com/kobie3717).
