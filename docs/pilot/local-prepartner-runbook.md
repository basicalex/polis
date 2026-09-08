# Local pre-partner runtime

This harness is for controlled synthetic trace work only. It does not authorize a
municipal release, public intake, partner connection, external SMTP delivery, or
production database access.

## Boundary

The launcher creates a fresh `mkdtemp` directory outside the repository. It
owns a loopback PostgreSQL 17 cluster, the `polis_trace_test` database, captured
SMTP mail, service logs, process IDs, and private credentials. It does not use
Homebrew's default PostgreSQL cluster or any system service.

All application URLs use `127.0.0.1`:

- identity: `http://127.0.0.1:8650`
- trace: `http://127.0.0.1:8980`
- platform: `http://127.0.0.1:3000`
- web: `http://127.0.0.1:4321`
- SMTP: `127.0.0.1:1025`, or the selected available port

The default PostgreSQL port is `55433`. Set `PILOT_PG_PORT=55432` only when it
is available; the separate local test cluster currently uses `55432`.

## Prerequisites

- Bun and already-installed workspace dependencies.
- PostgreSQL binaries at `/opt/homebrew/opt/postgresql@17/bin` and the local
  `vector` extension.
- Built service artifacts. The launcher does not install dependencies.
- The service runtime must support `SERVICE_HOST=127.0.0.1`; the harness passes
  that exact value to identity, trace, and platform.

Start with the needed local builds only when asked:

```sh
bun --no-env-file scripts/pilot/runtime.mjs start --build
```

Without `--build`, start requires the existing DB, identity, platform, and web
artifacts and fails rather than installing or building anything. The start
output contains the runtime path, local URLs, and a safe inbox command. It
never prints database passwords, SMTP credentials, session tokens, mail bodies,
or trace material.

Use the printed runtime path for every later command:

```sh
bun --no-env-file scripts/pilot/runtime.mjs status --runtime /private/tmp/polis-vrsar-prepartner-XXXXXX
bun --no-env-file scripts/pilot/runtime.mjs stop --runtime /private/tmp/polis-vrsar-prepartner-XXXXXX
bun --no-env-file scripts/pilot/runtime.mjs restart --runtime /private/tmp/polis-vrsar-prepartner-XXXXXX
```

Stop preserves the database, mailbox, logs, and private credentials. An
operator may remove only an explicit, stopped runtime that passes ownership
checks:

```sh
bun --no-env-file scripts/pilot/runtime.mjs clean --runtime /private/tmp/polis-vrsar-prepartner-XXXXXX --confirm
```

The launcher rejects a repository path, missing metadata, mismatched metadata,
and non-test database ownership. It terminates only its recorded process groups
and its PostgreSQL data directory.

## Synthetic accounts and mail

The private seed step runs only against an owned loopback `*_test` database with
the explicit test marker. It creates these stable synthetic identities:

| ID | Email | Role configuration |
| --- | --- | --- |
| `trace-resident-test` | `resident@vrsar.example.test` | resident |
| `trace-resident-other-test` | `other@vrsar.example.test` | resident |
| `trace-official-test` | `official@vrsar.example.test` | official allowlist |
| `trace-reviewer-test` | `reviewer@vrsar.example.test` | reviewer allowlist |

The runtime sets `TRACE_OFFICIAL_CITIZEN_IDS=trace-official-test` and
`TRACE_REVIEWER_CITIZEN_IDS=trace-reviewer-test`. It sets
`IDENTITY_DEV_TOKENS=false`; there is no browser bypass or role selector.

The local SMTP relay binds only to `127.0.0.1`, requires its generated SMTP
credentials, accepts only the four listed recipient addresses, bounds message
size, and writes captures mode `0600`. It does not deliver mail outside the
machine. List captures without exposing bodies:

```sh
bun --no-env-file scripts/pilot/inbox.mjs list --runtime /private/tmp/polis-vrsar-prepartner-XXXXXX
```

An operator may explicitly decode and view a selected captured message:

```sh
bun --no-env-file scripts/pilot/inbox.mjs show --runtime /private/tmp/polis-vrsar-prepartner-XXXXXX --id MESSAGE_ID
```

`show` decodes quoted-printable and base64 body transfer encoding, including
wrapped login fragments. Do not send that output to shared logs.

## Service composition

The harness starts PostgreSQL and `vector`, full `@polis/db` migrations,
synthetic identity seed, trace-owned migrations, grants to the non-superuser
app role, SMTP, identity, trace, the bounded platform, then web. It uses the
published `@polis/trace-service` `build`, `migrate`, and `start` commands.

The harness supplies the shared explicit environment, including:

- `SERVICE_HOST=127.0.0.1`, `DATABASE_URL` for the non-superuser app role,
  loopback PostgreSQL settings, and `INTERNAL_API_TOKEN`;
- `IDENTITY_MAGIC_LINK_DELIVERY=smtp`, `PUBLIC_APP_URL`,
  `IDENTITY_ALLOW_HTTP_LOCALHOST=true`, loopback SMTP settings, and
  `IDENTITY_DEV_TOKENS=false`;
- `TRACE_ENABLED=true`, `TRACE_INTERNAL_URL=http://127.0.0.1:8980`, the two
  stable role allowlists, and `TRACE_INTAKE_OPEN=true`; trace loads its fixed
  repository pilot configuration at `config/pilots/vrsar-orsera.json`;
- `PILOT_API_BASE=http://127.0.0.1:3000`, `PUBLIC_SITE_URL` on loopback, and
  `PUBLIC_RELEASE=0`.

The platform at port `3000` composes only operational routes, trace routes, and
the five identity routes required by the pilot plus logout. It rejects legacy
platform routes and `/api/v1/identity/dev-tokens`. Its `/readyz` requires a
database query plus identity and trace readiness, rather than legacy service
dependencies.

No child receives the caller's `DATABASE_URL` or arbitrary inherited
configuration. Bun commands use `--no-env-file`; the launcher also constructs
a small explicit child environment rather than relying on that flag alone.

## Restart proof

Run this only against a quiescent, owned running runtime with populated synthetic
private and public record fixtures. It completes the controlled resident login
through the local web proxy, holds its opaque HttpOnly cookie only in process
memory, restarts the whole owned test stack, then checks readiness through the
same session, unchanged records and receipts, and logout revocation.

```sh
node scripts/pilot/restart-proof.mjs --runtime /private/tmp/polis-vrsar-prepartner-XXXXXX
```

It writes safe JSON only to `logs/restart-proof.json` with mode `0600`; it does
not print a token, mail body, cookie, or private record body. This restarts the
owned local test stack. It is not production, partner, or release approval.

## Local operational checks

The smoke helper checks local database and service health, restarts trace with
`TRACE_INTAKE_OPEN=false`, then posts through the trace service's trusted
internal contract with a synthetic resident identity. It expects the real `503
intake_closed` result and restores `TRACE_INTAKE_OPEN=true` in `finally`. This
is an operational service check, not a browser authentication bypass.

```sh
bun --no-env-file scripts/pilot/operational-smoke.mjs --runtime /private/tmp/polis-vrsar-prepartner-XXXXXX
```


The recovery drill creates an encrypted local `pg_dump`, tests authenticated
ciphertext tamper detection, restores to a newly generated owned `*_test`
database, compares configured exact trace tables by row count and canonical
digest, and runs the trace worker's chain checker against source and restore.
It is local restore evidence only, not off-host or production recovery evidence.

```sh
bun --no-env-file scripts/pilot/recovery-drill.mjs run --runtime /private/tmp/polis-vrsar-prepartner-XXXXXX
```

The comparison covers the trace migration ledger, records, private material,
participant state, events, idempotency records, attachment bytes, and public
snapshots. It invokes the trace service's exported event-chain and receipt-hash
verifier.

The encrypted artifact and a separate mode-`0600` operator key file remain in
the runtime directory. The restore database remains by default. Remove a
specific recorded restore target only after review:

```sh
bun --no-env-file scripts/pilot/recovery-drill.mjs clean --runtime /private/tmp/polis-vrsar-prepartner-XXXXXX --restore-id RESTORE_ID --confirm
```

The recovery helper writes no pre-run acceptance report; it records an outcome
only after the local comparison and verifier run.

## Targeted tests

```sh
bun --no-env-file test scripts/pilot/test/runtime-lib.test.mjs
```

These tests cover runtime ownership and cleanup guards, loopback port probing,
explicit environment isolation, bounded platform route composition and readiness,
SMTP recipient rejection, and transfer decoding for wrapped login links.
