#!/bin/bash
# Switch the Prisma datasource provider between SQLite (local) and PostgreSQL (production/Vercel).
#
# Usage:
#   ./scripts/switch-db.sh sqlite       # Local dev (default)
#   ./scripts/switch-db.sh postgresql   # Production (Vercel/Neon/Supabase)
#
# After switching to postgresql, update DATABASE_URL in .env to your Postgres
# connection string, then run:
#   bun run db:push
#   bun run scripts/seed.ts
#
# NOTE: This script also ensures prisma.config.ts exists (which loads .env via dotenv).
# Prisma 6.x stops auto-loading .env when prisma.config.ts is present — without
# our explicit dotenv call, DATABASE_URL would be undefined and you'd see:
#   "the URL must start with the protocol file:"

set -e

TARGET="${1:-sqlite}"
SCHEMA="prisma/schema.prisma"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_TS="$PROJECT_ROOT/prisma.config.ts"

# Ensure prisma.config.ts exists — it explicitly loads .env via dotenv.
# Without it, Prisma 6.x skips .env loading entirely.
if [ ! -f "$CONFIG_TS" ]; then
  echo "→ Creating prisma.config.ts (loads .env via dotenv)..."
  cat > "$CONFIG_TS" <<'TS'
import { config } from "dotenv";
import { join } from "path";
config({ path: join(process.cwd(), ".env") });
config({ path: join(process.cwd(), ".env.local"), override: true });
export default {};
TS
  echo "✓ Created $CONFIG_TS"
fi

if [ ! -f "$SCHEMA" ]; then
  echo "✗ Schema file not found: $SCHEMA"
  exit 1
fi

case "$TARGET" in
  sqlite|postgresql)
    # Update the provider line in schema.prisma
    if grep -q 'provider = "sqlite"' "$SCHEMA"; then
      CURRENT="sqlite"
    elif grep -q 'provider = "postgresql"' "$SCHEMA"; then
      CURRENT="postgresql"
    else
      echo "✗ Could not detect current provider in $SCHEMA"
      exit 1
    fi

    if [ "$CURRENT" = "$TARGET" ]; then
      echo "✓ Already using $TARGET — no change needed"
      exit 0
    fi

    # Replace the provider line
    sed -i "s/provider = \"$CURRENT\"/provider = \"$TARGET\"/" "$SCHEMA"
    echo "✓ Switched Prisma provider: $CURRENT → $TARGET"

    # Regenerate Prisma client
    echo "→ Running prisma generate..."
    npx prisma generate

    # Remind about .env
    if [ "$TARGET" = "postgresql" ]; then
      echo ""
      echo "⚠️  Next steps:"
      echo "  1. Update DATABASE_URL in .env to your Postgres connection string"
      echo "     Get a free one from: https://neon.tech"
      echo "     Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
      echo "  2. Run: bun run db:push"
      echo "  3. Run: bun run scripts/seed.ts"
      echo "  4. Set the same DATABASE_URL in Vercel env vars"
    else
      echo ""
      echo "⚠️  Next steps:"
      echo "  1. Update DATABASE_URL in .env to: file:/home/z/my-project/db/custom.db"
      echo "  2. Run: bun run db:push"
      echo "  3. Run: bun run scripts/seed.ts  (if DB is empty)"
    fi
    ;;
  *)
    echo "Usage: $0 <sqlite|postgresql>"
    echo "  sqlite       — Local dev (file-based, no setup)"
    echo "  postgresql   — Production (Vercel/Neon/Supabase — requires DATABASE_URL)"
    exit 1
    ;;
esac
