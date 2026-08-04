#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

backup_dir=${BACKUP_DIR:-"$project_dir/backups"}
mkdir -p "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$backup_dir/tud-$timestamp.dump"
compose="docker compose --env-file .env.production -f compose.production.yaml"

$compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' > "$backup_file"
chmod 600 "$backup_file"
echo "$backup_file"
