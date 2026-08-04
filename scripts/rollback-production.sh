#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if [ ! -f .deploy-previous-tag ]; then
  echo "No previous deployed image is recorded." >&2
  exit 1
fi

previous_tag=$(cat .deploy-previous-tag)
if ! docker image inspect "tud-app:$previous_tag" >/dev/null 2>&1; then
  echo "Previous image tud-app:$previous_tag is not available on this server." >&2
  exit 1
fi

current_tag=$(cat .deploy-current-tag 2>/dev/null || true)
export TUD_IMAGE_TAG="$previous_tag"
compose="docker compose --env-file .env.production -f compose.production.yaml"

echo "Rolling the app container back to $previous_tag without reversing database migrations..."
$compose up -d --no-deps app

if [ -n "$current_tag" ]; then
  printf '%s\n' "$current_tag" > .deploy-previous-tag
fi
printf '%s\n' "$previous_tag" > .deploy-current-tag
$compose ps app
