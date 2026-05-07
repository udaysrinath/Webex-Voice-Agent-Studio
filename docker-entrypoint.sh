#!/bin/sh
set -e

echo "Pushing database schema..."
npm run db:push

echo "Starting dev server..."
exec npm run dev
