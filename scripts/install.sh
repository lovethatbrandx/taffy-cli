#!/usr/bin/env bash
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BINARY="$REPO_DIR/dist/taffy"
INSTALL_PATH="/usr/local/bin/taffy"

echo "pulling latest..."
cd "$REPO_DIR"
git pull --quiet

echo "building..."
bun run build

echo "installing..."
sudo cp "$BINARY" "$INSTALL_PATH"
sudo chmod +x "$INSTALL_PATH"

echo "done. $(taffy -v)"
