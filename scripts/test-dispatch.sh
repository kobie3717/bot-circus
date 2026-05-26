#!/bin/bash
# Smoke test for dispatch functionality
#
# Tests the star+ephemeral pattern:
# - MEMORY.md in each performer dir is the "star node" (shared by all workers)
# - dispatch spawns ephemeral Claude CLI workers (no persistent process)
# - Workers read SOUL.md + MEMORY.md as context
# - On completion, worker appends one-line summary to MEMORY.md
#
# Usage: ./test-dispatch.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

echo "=== Bot-Circus Dispatch Smoke Test ==="
echo ""
echo "Testing ephemeral worker dispatch to 007..."
echo ""

# Run dispatch command
node bin/circus.js dispatch 007 "List your last 3 memory entries from MEMORY.md. Keep it concise - just show the timestamps and first 50 chars of each entry."

echo ""
echo "=== Test Complete ==="
echo ""
echo "Check performers/007/MEMORY.md for the appended worker result."
