# Partner Pilot Charter Template

Use this template before a partner uses Polis Interface with real data.

If the [isolated public-read API profile](../operations/isolated-pilot-runbook.md) is selected, this charter must limit it to seeded synthetic/public data. That profile is not a path to real-person data or writable workflows.

## Pilot identity

- Partner institution:
- Jurisdiction:
- Public purpose:
- Pilot owner:
- Technical owner:
- Security/privacy contact:
- Deployment profile selected (isolated public-read or separately reviewed broader profile):
- Named deployment owner and backup:
- Named security/incident owner and backup:
- Named backup operator and backup:
- Named restore-drill operator and backup:
- DNS/TLS owner and backup:
- Dated successful restore evidence (snapshot ID, operator, reviewer, disposable target, evidence location):

## Scope

- Civic process or service being tested:
- User groups affected:
- Data categories:
- Public evidence to be published:
- Private documents to be processed:
- Systems integrated:
- For the isolated public-read profile, confirm the service list is limited to PostgreSQL, one-shot seed/migrations, governance graph, public audit, proof, Polis bridge, platform API, and Caddy:
- For the isolated public-read profile, confirm data is seeded synthetic/public only and all write, login, and participation routes remain denied:

## Current implementation status

State which adapters are still mocked. Charter signing defaults to
`SIGNING_PROVIDER=stub`; record Documenso as live only after the pilot tests its
configured v2 API and webhook. For local v1, Paperless, upstream Polis,
Keycloak/OIDC, AI providers, payment rails, timestamping, and government
systems are not live.

The isolated public-read profile does not make any mocked or external provider live. Preserve that distinction when completing this status section.

## Safeguards

- Legal basis and privacy notice:
- Retention schedule:
- Access roles:
- Redaction rules:
- AI review process:
- Audit/event review process:
- Incident contact and response time:
- Rollback trigger:
- Pilot launch gate: all operational-owner fields name people and backups; a reviewer has accepted dated restore evidence; DNS/TLS, readiness, and denied-route checks are attached.

## Charter signing

- Provider, mode, and service owner:
- Signer name, role, institution, and contact:
- Identity evidence checked before sending the invitation:
- Evidence retained: provider completion record, signed charter hash, proof manifest, lifecycle events, and review record.
- Restricted evidence: signed charter bytes and signer contact data.
- Retention period and deletion process:
- Revocation trigger and authority:
- Superseding charter process:
- Legal non-claims: the provider completion records a standard electronic signing ceremony. The pilot does not claim an advanced or qualified electronic signature, identity assurance by the signature alone, legal advice, court or registry acceptance, or a production trust service.

## Success criteria

- Evidence quality:
- User comprehension:
- Complaint or appeal traceability:
- Document verification outcome:
- Operational burden:
- Risks found:

## Exit plan

Define how data, accounts, documents, audit events, and public pages are archived, deleted, or transferred at pilot end.
