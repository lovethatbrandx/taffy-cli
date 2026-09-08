#!/usr/bin/env bash
# taffy shell integration — add to your ~/.bashrc or ~/.zshrc
#
# Usage: taffy "open the music player"
#   → Loads the command/app into your prompt so you can edit before executing
#
# Install:
#   echo 'source /path/to/taffy-cli/scripts/taffy.sh' >> ~/.bashrc
#   # or for zsh:
#   echo 'source /path/to/taffy-cli/scripts/taffy.sh' >> ~/.zshrc

# Detect if we're in zsh or bash and define the function accordingly
if [ -n "$ZSH_VERSION" ]; then
  # ── zsh ──────────────────────────────────────────────────────
  taffy() {
    local cmd
    cmd="$(taffy-cli "$@")" || return
    vared -p "" -c cmd
    print -s -- "$cmd"   # add to zsh history
    eval "$cmd"
  }
elif [ -n "$BASH_VERSION" ]; then
  # ── bash (4+) ────────────────────────────────────────────────
  taffy() {
    local cmd
    cmd="$(taffy-cli "$@")" || return
    read -e -i "$cmd" -p "" cmd || return
    builtin history -s -- "$cmd"
    eval -- "$cmd"
  }
else
  # ── fallback: just print the command ─────────────────────────
  taffy() {
    taffy-cli "$@"
  }
fi
