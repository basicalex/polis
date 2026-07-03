#!/usr/bin/env bash
# M10 dev Keycloak provisioning — idempotent. Creates the `polis` realm, the
# `polis-web` confidential client (PKCE S256, redirect to the web app), and two
# email-verified test users. Run inside the keycloak image (kcadm.sh on PATH).
#
# Keycloak readiness: the official image has no curl, so keycloak-init uses
# depends_on: service_started and THIS script loops `kcadm config credentials`
# until Keycloak answers (connection-refused during startup), then exits 0.
#
# Id resolution: every id is read back via a `kcadm get` query — `kcadm create`
# does not reliably print a parseable id across versions.
set -euo pipefail

# kcadm.sh lives at /opt/keycloak/bin, which is NOT on the image's default PATH.
export PATH="/opt/keycloak/bin:$PATH"

: "${KC_SERVER:?KC_SERVER required}"
: "${KC_ADMIN:?KC_ADMIN required}"
: "${KC_ADMIN_PASSWORD:?KC_ADMIN_PASSWORD required}"
# Client id + secret are resolved from the same env the citizen-identity-service
# reads, so a .env/compose override stays consistent on both sides.
OIDC_CLIENT_SECRET="${OIDC_CLIENT_SECRET:-polis-web-dev-secret}"

REALM=polis
CLIENT_ID="${OIDC_CLIENT_ID:-polis-web}"
WEB_ORIGIN=http://localhost:4321
REDIRECT_URIS='["http://localhost:4321/login/callback","http://localhost:4321/login/callback/*"]'

# Extract the first id value from a kcadm JSON list/output (no jq on the image).
first_id() { grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//; s/"$//'; }

echo "[init-realm] waiting for Keycloak at $KC_SERVER ..."
connected=0
for i in $(seq 1 60); do
  if kcadm.sh config credentials --server "$KC_SERVER" --realm master \
      --user "$KC_ADMIN" --password "$KC_ADMIN_PASSWORD" >/dev/null 2>&1; then
    echo "[init-realm] Keycloak ready (attempt $i)."
    connected=1
    break
  fi
  sleep 2
done
if [ "$connected" -ne 1 ]; then
  echo "[init-realm] Keycloak never became ready; aborting." >&2
  exit 1
fi

# Realm — create if absent.
if ! kcadm.sh get realms/"$REALM" >/dev/null 2>&1; then
  echo "[init-realm] creating realm $REALM"
  kcadm.sh create realms -s realm="$REALM" -s enabled=true
else
  echo "[init-realm] realm $REALM exists"
fi

# Client — resync on every run: create if absent, else update secret + redirect +
# PKCE so a .env/compose change never leaves Keycloak mismatched with the service.
# (Ids are read back via get — kcadm create output is not a reliable id source.)
CID="$(kcadm.sh get -r "$REALM" clients -q clientId="$CLIENT_ID" 2>/dev/null | first_id || true)"
CLIENT_OPTS=(
  -s enabled=true
  -s secret="$OIDC_CLIENT_SECRET"
  -s publicClient=false
  -s standardFlowEnabled=true
  -s directAccessGrantsEnabled=false
  -s "redirectUris=$REDIRECT_URIS"
  -s "webOrigins=[\"$WEB_ORIGIN\"]"
  -s 'attributes={"pkce.code.challenge.method":"S256"}'
)
if [ -z "$CID" ]; then
  echo "[init-realm] creating client $CLIENT_ID"
  kcadm.sh create -r "$REALM" clients -s clientId="$CLIENT_ID" "${CLIENT_OPTS[@]}" >/dev/null
  CID="$(kcadm.sh get -r "$REALM" clients -q clientId="$CLIENT_ID" 2>/dev/null | first_id || true)"
  echo "[init-realm] client $CLIENT_ID created ($CID)"
else
  echo "[init-realm] client $CLIENT_ID exists ($CID) — resyncing secret + redirect config"
  kcadm.sh update -r "$REALM" clients/"$CID" "${CLIENT_OPTS[@]}" >/dev/null
fi

# User — create if absent, read its id back via get, set password.
make_user() {
  local username="$1" email="$2" password="$3" first="$4"
  local uid
  uid="$(kcadm.sh get -r "$REALM" users -q username="$username" 2>/dev/null | first_id || true)"
  if [ -z "$uid" ]; then
    echo "[init-realm] creating user $email"
    kcadm.sh create -r "$REALM" users \
      -s username="$username" \
      -s email="$email" \
      -s emailVerified=true \
      -s enabled=true \
      -s firstName="$first" \
      -s lastName="Resident" \
      >/dev/null
    uid="$(kcadm.sh get -r "$REALM" users -q username="$username" 2>/dev/null | first_id || true)"
    if [ -z "$uid" ]; then
      echo "[init-realm] FAILED to resolve id for $email after create" >&2
      exit 1
    fi
    kcadm.sh set-password -r "$REALM" --userid "$uid" --new-password "$password"
  else
    echo "[init-realm] user $email exists ($uid)"
  fi
}

make_user resident resident@polis.local resident Resident
make_user official official@polis.local official Official

echo "[init-realm] done."
