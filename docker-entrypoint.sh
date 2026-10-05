#!/bin/sh
set -e

# node_modules lives in a named volume that survives image rebuilds, so a dependency added to package.json would never
# reach a container that already has the volume. Reinstall when the lockfile baked into the image differs from the one
# the volume was last installed from.
LOCK_HASH="$(md5sum package-lock.json | cut -d' ' -f1)"
if [ "$(cat node_modules/.lock-hash 2>/dev/null)" != "$LOCK_HASH" ]; then
  echo "Dependencies changed; installing..."
  npm ci --no-audit --no-fund
  echo "$LOCK_HASH" > node_modules/.lock-hash
fi

echo "Pushing database schema..."
npm run db:push

echo "Starting dev server..."
exec npm run dev
