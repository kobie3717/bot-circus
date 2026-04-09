#!/bin/bash
# Bot-Circus Installation Test Script

set -e

echo "=== Bot-Circus Installation Test ==="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

success() {
    echo -e "${GREEN}✓${NC} $1"
}

fail() {
    echo -e "${RED}✗${NC} $1"
    exit 1
}

# Test 1: Node.js version
echo "Testing Node.js version..."
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -ge 20 ]; then
    success "Node.js version OK ($NODE_VERSION)"
else
    fail "Node.js version too old. Need >=20, got $NODE_VERSION"
fi

# Test 2: Dependencies installed
echo "Testing npm dependencies..."
if [ -d "node_modules" ]; then
    success "Dependencies installed"
else
    fail "Dependencies not found. Run: npm install"
fi

# Test 3: CLI executable
echo "Testing CLI..."
if [ -x "bin/circus.js" ]; then
    success "CLI executable"
else
    fail "CLI not executable. Run: chmod +x bin/circus.js"
fi

# Test 4: CLI version
echo "Testing CLI version command..."
VERSION=$(node bin/circus.js --version)
if [ -n "$VERSION" ]; then
    success "CLI version: $VERSION"
else
    fail "CLI version command failed"
fi

# Test 5: Module imports
echo "Testing module imports..."
node -e "import('./lib/orchestrator.js').then(() => console.log('OK'))" > /dev/null 2>&1 && success "Orchestrator module" || fail "Orchestrator module"
node -e "import('./lib/worker-pool.js').then(() => console.log('OK'))" > /dev/null 2>&1 && success "Worker pool module" || fail "Worker pool module"
node -e "import('./lib/memory-manager.js').then(() => console.log('OK'))" > /dev/null 2>&1 && success "Memory manager module" || fail "Memory manager module"
node -e "import('./lib/telegram-client.js').then(() => console.log('OK'))" > /dev/null 2>&1 && success "Telegram client module" || fail "Telegram client module"
node -e "import('./lib/message-queue.js').then(() => console.log('OK'))" > /dev/null 2>&1 && success "Message queue module" || fail "Message queue module"
node -e "import('./lib/metrics.js').then(() => console.log('OK'))" > /dev/null 2>&1 && success "Metrics module" || fail "Metrics module"
node -e "import('./lib/rate-limiter.js').then(() => console.log('OK'))" > /dev/null 2>&1 && success "Rate limiter module" || fail "Rate limiter module"

# Test 6: Templates exist
echo "Testing persona templates..."
[ -f "templates/default.soul.md" ] && success "default.soul.md" || fail "default.soul.md missing"
[ -f "templates/customer-support.soul.md" ] && success "customer-support.soul.md" || fail "customer-support.soul.md missing"
[ -f "templates/sales-agent.soul.md" ] && success "sales-agent.soul.md" || fail "sales-agent.soul.md missing"
[ -f "templates/dev-helper.soul.md" ] && success "dev-helper.soul.md" || fail "dev-helper.soul.md missing"
[ -f "templates/meme-lord.soul.md" ] && success "meme-lord.soul.md" || fail "meme-lord.soul.md missing"

# Test 7: Config file
echo "Testing configuration..."
[ -f "circus.config.json" ] && success "circus.config.json exists" || fail "circus.config.json missing"

# Test 8: Directories
echo "Testing directory structure..."
[ -d "lib" ] && success "lib/ directory" || fail "lib/ missing"
[ -d "bin" ] && success "bin/ directory" || fail "bin/ missing"
[ -d "templates" ] && success "templates/ directory" || fail "templates/ missing"
[ -d "global" ] && success "global/ directory" || fail "global/ missing"
[ -d "performers" ] && success "performers/ directory" || fail "performers/ missing"
[ -d "troupes" ] && success "troupes/ directory" || fail "troupes/ missing"

# Test 9: Claude CLI (optional)
echo "Testing Claude CLI..."
if command -v claude &> /dev/null; then
    success "Claude CLI found at $(which claude)"
else
    echo "⚠️  Claude CLI not found (optional but required for bot functionality)"
fi

# Test 10: Create test bot
echo "Testing bot creation..."
TEST_BOT_ID="testbot"  # ID is normalized from name
rm -rf "performers/$TEST_BOT_ID" 2>/dev/null || true

node bin/circus.js add-performer \
    --name "TestBot" \
    --token "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ-test" \
    --persona templates/default.soul.md \
    > /dev/null 2>&1 && success "Bot creation" || fail "Bot creation failed"

# Test 11: Verify workspace
echo "Testing workspace structure..."
[ -f "performers/$TEST_BOT_ID/config.json" ] && success "config.json created" || fail "config.json missing"
[ -f "performers/$TEST_BOT_ID/SOUL.md" ] && success "SOUL.md created" || fail "SOUL.md missing"
[ -f "performers/$TEST_BOT_ID/IDENTITY.md" ] && success "IDENTITY.md created" || fail "IDENTITY.md missing"
[ -f "performers/$TEST_BOT_ID/USER.md" ] && success "USER.md created" || fail "USER.md missing"
[ -f "performers/$TEST_BOT_ID/MEMORY.md" ] && success "MEMORY.md created" || fail "MEMORY.md missing"
[ -d "performers/$TEST_BOT_ID/memory" ] && success "memory/ directory created" || fail "memory/ directory missing"

# Test 12: Troupe creation
echo "Testing troupe creation..."
node bin/circus.js add-troupe test-troupe > /dev/null 2>&1 && success "Troupe creation" || fail "Troupe creation failed"

# Test 13: Join troupe
echo "Testing troupe join..."
node bin/circus.js join-troupe $TEST_BOT_ID test-troupe > /dev/null 2>&1 && success "Troupe join" || fail "Troupe join failed"

# Test 14: Verify symlink
echo "Testing symlink..."
if [ -L "performers/$TEST_BOT_ID/MEMORY.md" ]; then
    success "MEMORY.md is a symlink"
else
    fail "MEMORY.md should be a symlink"
fi

# Test 15: Leave troupe
echo "Testing troupe leave..."
node bin/circus.js leave-troupe $TEST_BOT_ID > /dev/null 2>&1 && success "Troupe leave" || fail "Troupe leave failed"

# Test 16: Verify regular file restored
echo "Testing backup restoration..."
if [ ! -L "performers/$TEST_BOT_ID/MEMORY.md" ]; then
    success "MEMORY.md restored to regular file"
else
    fail "MEMORY.md should not be a symlink"
fi

# Cleanup
echo "Cleaning up test data..."
node bin/circus.js rm-performer $TEST_BOT_ID > /dev/null 2>&1 && success "Bot removal" || fail "Bot removal failed"
rm -rf "troupes/test-troupe" 2>/dev/null || true

echo ""
echo "==================================="
echo -e "${GREEN}All tests passed!${NC}"
echo "==================================="
echo ""
echo "Next steps:"
echo "  1. Get a Telegram bot token from @BotFather"
echo "  2. Run: circus add-performer --name YourBot --token YOUR_TOKEN"
echo "  3. Run: circus serve"
echo ""
echo "See EXAMPLES.md for more usage examples."
