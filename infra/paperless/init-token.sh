#!/usr/bin/env bash
# M11 dev Paperless-ngx provisioning — idempotent. Upserts a known DRF API
# token for the `admin` user so the adapter (HttpPaperlessClient) and
# Paperless agree on a shared secret (M10 shared-secret pattern). Runs inside
# the paperless-ngx image; both `paperless` and `paperless-init` mount the
# same paperless-data volume so this `manage.py` writes the token the main
# container reads.
#
# Readiness: the image has no curl, so this loops a Python urllib GET against
# Paperless until it answers (first-boot runs migrations + creates the admin
# from PAPERLESS_ADMIN_*), then waits for the admin row, then upserts the
# token. Exits 1 if Paperless never answers.
set -euo pipefail

: "${PAPERLESS_REDIS:?PAPERLESS_REDIS required}"
: "${POLIS_PAPERLESS_DEV_TOKEN:?POLIS_PAPERLESS_DEV_TOKEN required}"
PAPERLESS_ADMIN_USER="${PAPERLESS_ADMIN_USER:-admin}"

# Paperless-ngx keeps manage.py inside its src tree.
cd /usr/src/paperless/src

PAPERLESS_HOST="${PAPERLESS_HOST:-paperless}"
PAPERLESS_PORT="${PAPERLESS_PORT:-8000}"
HEALTH_URL="http://${PAPERLESS_HOST}:${PAPERLESS_PORT}/"

echo "[init-token] waiting for Paperless at ${HEALTH_URL} ..."
connected=0
for _ in $(seq 1 90); do
  if python3 - "$HEALTH_URL" <<'PY' >/dev/null 2>&1
import sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=3) as r:
        sys.exit(0 if r.status < 500 else 1)
except Exception:
    sys.exit(1)
PY
  then
    connected=1
    break
  fi
  sleep 1
done
if [ "$connected" -ne 1 ]; then
  echo "[init-token] Paperless never answered; aborting" >&2
  exit 1
fi
echo "[init-token] Paperless is up; waiting for admin user…"

# Wait for migrations to finish (the admin row is created from PAPERLESS_ADMIN_*
# once the auth migration + the Paperless admin-provisioning command complete).
for _ in $(seq 1 60); do
  if python3 manage.py shell -c \
    "from django.contrib.auth import get_user_model; import sys; sys.exit(0 if get_user_model().objects.filter(username='${PAPERLESS_ADMIN_USER}').exists() else 1)" \
    >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Upsert the known token (idempotent across reboots).
POLIS_PAPERLESS_DEV_TOKEN="${POLIS_PAPERLESS_DEV_TOKEN}" python3 manage.py shell -c \
"import os
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
key = os.environ['POLIS_PAPERLESS_DEV_TOKEN']
u = get_user_model().objects.get(username='${PAPERLESS_ADMIN_USER}')
# update_or_create races on DRF Token's unique-per-user constraint and throws
# on a re-run; filter().update() is an unconditional UPDATE (no save() signal)
# that stays idempotent across reboots, with a create fallback for first boot.
if not Token.objects.filter(user=u).update(key=key):
    Token.objects.create(user=u, key=key)
print('token ready')"

echo "[init-token] done."
