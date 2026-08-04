#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "The server worktree has uncommitted changes; refusing to update." >&2
  exit 1
fi

git pull --ff-only
exec ./scripts/deploy-production.sh
