#!/usr/bin/env bash
set -e
REPO=$(git rev-parse --show-toplevel)
git -C "$REPO" config core.hooksPath .githooks
chmod +x "$REPO/.githooks/pre-commit"
echo "[circus] git hooksPath set to .githooks/"
