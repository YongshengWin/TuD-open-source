#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

if [ ! -f .env.production ]; then
  echo "Missing .env.production. Copy .env.production.example and fill in real values." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required." >&2
  exit 1
fi

compose="docker compose --env-file .env.production -f compose.production.yaml"
revision=$(git rev-parse --short=12 HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)
export TUD_IMAGE_TAG="$revision"
rollback_tag=""
if [ -f .deploy-current-tag ]; then
  candidate=$(cat .deploy-current-tag)
  if docker image inspect "tud-app:$candidate" >/dev/null 2>&1; then
    rollback_tag="$candidate"
  fi
fi

restore_previous_app() {
  if [ -z "$rollback_tag" ]; then
    return
  fi
  failed_tag=$TUD_IMAGE_TAG
  export TUD_IMAGE_TAG="$rollback_tag"
  echo "Restoring the previous app image $rollback_tag..." >&2
  $compose up -d --no-deps app >&2
  export TUD_IMAGE_TAG="$failed_tag"
}

$compose config --quiet

echo "Building TuD image $TUD_IMAGE_TAG while the current app remains online..."
$compose build app

echo "Starting PostgreSQL and applying forward migrations..."
$compose up -d postgres
$compose --profile tools run --rm migrate

echo "Replacing the application container..."
$compose up -d app --remove-orphans

container_id=$($compose ps -q app)
attempt=0
while [ "$attempt" -lt 40 ]; do
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}starting{{end}}' "$container_id" 2>/dev/null || true)
  if [ "$health" = "healthy" ]; then
    break
  fi
  if [ "$health" = "unhealthy" ]; then
    echo "TuD failed its health check." >&2
    $compose logs --tail=120 app >&2
    restore_previous_app
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 3
done

if [ "${health:-}" != "healthy" ]; then
  echo "Timed out waiting for TuD to become healthy." >&2
  $compose logs --tail=120 app >&2
  restore_previous_app
  exit 1
fi

echo "Warming the server-backed icon catalog..."
$compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/brands/search?limit=1').then(r=>{if(!r.ok)throw new Error(String(r.status))}).catch(e=>{console.error(e);process.exit(1)})"

if [ -f .deploy-current-tag ] && [ "$(cat .deploy-current-tag)" != "$TUD_IMAGE_TAG" ]; then
  cp .deploy-current-tag .deploy-previous-tag
fi
printf '%s\n' "$TUD_IMAGE_TAG" > .deploy-current-tag

$compose ps
echo "TuD $TUD_IMAGE_TAG is healthy."
