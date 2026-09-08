# Pre-partner evidence ledger — 2026-09-05

**Status:** **Passed — controlled automated software validation.** All controlled automated check slots are fulfilled. This is not human acceptance, real-municipality approval, public-launch authorization, or a change to the municipal **NO-GO**.

**Sources:** [Vrsar-Orsera research notes](vrsar-source-notes.md), [local pre-partner runbook](local-prepartner-runbook.md), and the [source manifest](prepartner-source-manifest-2026-09-05.json).

## Boundary

This work validates only an unofficial, synthetic Vrsar-Orsera software configuration. It has no real partner, real resident report, municipal intake, municipal account, outreach, public deployment, or municipal-system connection. The local test intake is functional and open after its controlled closure check; it is not a real or municipal intake.

The real-municipality **NO-GO** in [`GO_LIVE_READINESS.md`](../../GO_LIVE_READINESS.md) remains unchanged. Automated pre-partner validation cannot satisfy its charter, owner, legal, privacy, security, provider, or release-approval gates.

| Evidence status | Meaning |
| --- | --- |
| Passed — automated | A controlled automated result passed within the stated scope. It is not human acceptance or a launch decision. |
| Recorded | A configuration, source, or historical observation is recorded. |
| Unrun | No evidence has been recorded. |

## Evidence register

| Ref | Evidence | Status | Limit |
| --- | --- | --- | --- |
| E1 | The fixed test configuration is `vrsar-orsera`, category `public-lighting`, office `communal-system`, with HR, IT, and EN labels. Its public-lighting scope and office context come from the official sources listed in [Vrsar-Orsera source notes](vrsar-source-notes.md). The office routing remains `inferred-test-only`. | Recorded | Sources establish public context only. They do not show municipal participation, routing approval, or a defect-reporting process. |
| E2 | The local runtime uses four controlled synthetic identities: resident, other resident, official, and reviewer. It is loopback-only, uses synthetic data and local captured SMTP, and has no browser role selector or token bypass. | Recorded | Local SMTP proves controlled local capture only, not external delivery or mail-provider acceptance. TLS-sourced OIDC claim validation is in scope; ID-token signature verification is not. |
| E3 | An earlier workspace checkpoint built, typechecked, and ran 416 tests: 416 passed, 0 failed, 0 skipped. | Recorded | This historical checkpoint predates later changes and has no immutable source SHA. |
| E4 | Targeted checkpoints reported trace 23, identity 25, BFF 31, web 52, operations 13, and catalog 9 tests passed. The latest targeted web checkpoint has 53 passes. | Recorded | Targeted runs do not identify an immutable source state. |
| E5 | Independent automated identity review verified and fixed 2 findings. Independent trace/proxy review verified and fixed 5 findings. | Recorded | Automated review does not replace human privacy, security, or release approval. |
| E6 | Browser acceptance passed 18 of 18 checks, 0 failed, 0 unrun at 2026-09-05T11:18:22Z. It strictly checked 6 allowed public event tuples with 4 fields, all controlled roles, local captured SMTP, HR/IT/EN, desktop and phone behavior, privacy, receipt hashes, and logout. | Passed — automated | This is controlled local browser evidence. It is not human usability, native editorial approval, external mail delivery, or municipal authorization. Evidence artifact: `vrsar-acceptance-report.json`. |
| E7 | Fresh owned-runtime encrypted recovery passed. It compared 8 trace tables with 2 records, 18 events, 2 attachments, and 2 public snapshots; authenticated ciphertext tampering was detected. | Passed — automated | Local-only recovery evidence. It is not off-host, production, or disaster-recovery evidence. No private key, token, mail, or record body is recorded here. |
| E8 | Restart proof passed at 2026-09-05T11:47:02Z. The same pre-restart session remained valid; two private and two public records remained unchanged; logout revoked the old session. | Passed — automated | Controlled local restart evidence only. Evidence artifact: `restart-proof.json`. |
| E9 | Narrow public-receipt visual review passed M1–M4 after the latest receipt selection. The EN desktop and HR phone captures show the newest completion event. | Passed — automated | This makes no Italian screenshot or private-form visual claim. Functional IT coverage is in E6. Evidence artifacts: `vrsar-resolved-desktop-1440x1000.png` and `vrsar-resolved-phone-390x844.png`. |
| E10 | The [source manifest](prepartner-source-manifest-2026-09-05.json) records 111 files relative to base HEAD `5dd8e0ed0b346ecc247b6ca2c4363fe4b4f2c437`, branch `feat/vrsar-prepartner`, and fingerprint `5bba4dabb77fb90f1990d2cdacb0542d9596123807a80a1ad673d1a368764052`. | Recorded | The working tree is uncommitted, not an immutable commit or signed artifact. No CI, commit, push, deployment, or release approval is recorded. The rolling readiness and evidence records are excluded from this fingerprint. |
| E11 | Final whole-workspace build and typecheck exited 0. Workspace tests reported 425 passed, 0 failed, 0 skipped; operations reported 13 passed; catalog reported 9 passed and 19 services valid. | Passed — automated | Results ran from the uncommitted working tree identified by E10. |
| E12 | Local public-release `qa:release` passed with Wrangler 4.125.0 preview `--local`. No deployment ran. | Passed — automated | Local preview QA is not public deployment evidence. |
| E13 | A fresh owned local runtime cold-started from the final working-tree code after the generated Vite cache was archived. It used loopback URLs only. | Passed — automated | Cold-start evidence does not replace the specific restart and recovery proofs in E7 and E8. |
| E14 | Final operational smoke passed: health, closed intake, cleanup, and verified reopened intake all succeeded. | Passed — automated | This is local operational evidence, not external monitoring, provider acceptance, or a release decision. Evidence artifact: `operational-smoke.log`. |
| E15 | Local monitoring probe passed at 2026-09-05T11:54:21Z. It paused only the verified owned trace process, observed platform readiness return 503, resumed it in `finally`, then observed readiness return 200. | Passed — automated | External paging was not tested. |

## Verification ledger

| Check | Evidence | Current status | Remaining boundary |
| --- | --- | --- | --- |
| Source base, hash manifest, and code state | E10 | Recorded | Uncommitted working tree, no CI, commit, push, deployment, or signed artifact. |
| Durable persistence | E7, E13 | Passed — automated, local | Off-host recovery remains unrun. |
| Restart | E8 | Passed — automated, local | No production or external-service conclusion. |
| Concurrency | E4, E11 | Passed — controlled automated validation | No real-municipality conclusion. |
| Idempotency | E4, E11 | Passed — controlled automated validation | No real-municipality conclusion. |
| Privacy boundary | E5, E6 | Passed — controlled automated validation | Human legal and privacy decisions remain unrun. |
| Role separation | E2, E5, E6 | Passed — controlled automated validation | No real owner or municipal-account evidence. |
| Backup and recovery | E7 | Passed — automated, local | Off-host recovery remains unrun. |
| Mail delivery | E2, E6 | Passed — automated, local captured SMTP | External delivery and provider acceptance remain unrun. |
| Login | E6, E8 | Passed — automated, local | OIDC scope is TLS-sourced claim validation, not ID-token signature verification. |
| Monitoring | E15 | Passed — automated, local probe | External paging remains unrun. |
| Intake closure and fail-closed behavior | E14 | Passed — automated, local | Local test intake is open after the test; no real or municipal intake. |
| Croatian (HR) content | E6, E9 | Passed — automated | Native Croatian editorial approval remains unrun. |
| Italian (IT) content | E6 | Passed — automated, functional | No Italian screenshot claim; native Italian editorial approval remains unrun. |
| English content | E6, E9 | Passed — automated | English is a test-convenience language. |
| Mobile behavior | E6, E9 | Passed — automated | Human usability remains unrun. |

## Repeat commands and evidence artifacts

The command templates come from the [local pre-partner runbook](local-prepartner-runbook.md). Use only a printed owned-runtime path and keep output outside the repository. Do not copy private runtime material into this record.

| Check | Command or artifact |
| --- | --- |
| Browser acceptance | `cd apps/web && bun scripts/run-with-timeout.mjs 600 -- bun scripts/vrsar-acceptance.mjs --runtime <printed-runtime-path> --url <printed-web-url> --output <outside-repo-dir>`; `vrsar-acceptance-report.json`; `vrsar-resolved-desktop-1440x1000.png`; `vrsar-resolved-phone-390x844.png` |
| Restart proof | `node scripts/pilot/restart-proof.mjs --runtime <printed-runtime-path>`; `restart-proof.json` |
| Recovery drill | `bun --no-env-file scripts/pilot/recovery-drill.mjs run --runtime <printed-runtime-path>` |
| Operational smoke | `bun --no-env-file scripts/pilot/operational-smoke.mjs --runtime <printed-runtime-path>`; `operational-smoke.log` |

## Unrun human and external gates

The following remain unrun and cannot be inferred from automation: human usability; native HR and IT editorial review; legal and privacy decisions; off-host recovery; mail or identity provider acceptance; contracts; named real owners; signed charter and scope; municipal agreement; and independent real-release approval.
