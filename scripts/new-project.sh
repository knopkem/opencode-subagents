#!/bin/sh
# Start a new project that is its own git root.
#
# OpenCode anchors the project at the nearest git worktree upward. A fresh,
# empty directory has no anchor, so it resolves to the parent workspace and
# every `**` glob can reach sibling projects. Running `git init` first keeps
# the session scoped from the first tool call. Repo hygiene (a stack-specific
# .gitignore) belongs to the project's scaffold task, not to this launcher.
#
# Usage: scripts/new-project.sh <directory>
set -eu

dir=${1:-}
if [ -z "$dir" ]; then
  echo "usage: new-project.sh <directory>" >&2
  exit 2
fi

mkdir -p "$dir"
dir=$(cd "$dir" && pwd -P)

top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || true)
if [ "$top" != "$dir" ]; then
  if [ -n "$top" ] && [ -n "$(ls -A "$dir")" ]; then
    echo "error: $dir is a non-empty subdirectory of the git worktree $top" >&2
    echo "       refusing to nest a new repo there; run 'git init' there yourself if that is intended" >&2
    exit 1
  fi
  git -C "$dir" init -q
  echo "initialized git repo in $dir"
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "error: 'opencode' not found on PATH" >&2
  exit 1
fi

exec opencode "$dir"
