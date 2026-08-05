#!/usr/bin/env bash
# Reset local D1, apply migrations, load demo seed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WEB="$ROOT/apps/web"
SEED="$ROOT/packages/db/seed/local.sql"

echo "→ Removing local D1 state…"
rm -rf "$WEB/.wrangler/state/v3/d1"

echo "→ Applying migrations…"
cd "$WEB"
pnpm exec wrangler d1 migrations apply mankr-star --local

echo "→ Seeding demo data…"
pnpm exec wrangler d1 execute mankr-star --local --file="$SEED"

echo "✓ Done. Login: demo / password123"
