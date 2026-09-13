#!/bin/bash
set -euo pipefail

cd /app
service="$(cat /app/deploy/railway/service)"

case "$service" in
  trace-service)
    node services/trace-service/dist/migrate.js
    exec node services/trace-service/dist/index.js
    ;;
  citizen-identity-service)
    node --input-type=module --eval \
      "import { runMigrationsOnce } from './packages/db/dist/index.js'; await runMigrationsOnce(process.env.DATABASE_URL);"
    exec node services/citizen-identity-service/dist/index.js
    ;;
  platform-api)
    exec node services/platform-api/dist/index.js
    ;;
  *)
    printf 'Unknown Railway service: %s\n' "$service" >&2
    exit 64
    ;;
esac
