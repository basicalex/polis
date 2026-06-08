# Security

## Reporting

Report vulnerabilities to `security@intrface.eu` or the security contact configured by the deploying operator. Do not open public issues for private-data exposure, authentication bypass, proof forgery, audit tampering, credential leakage, or supply-chain compromise.

Include:

- affected app, service, package, or endpoint;
- reproduction steps;
- expected and actual impact;
- whether private documents, evidence, audit data, or credentials were exposed.

## Current local v1 limits

Local v1 is not hardened for production. `.env.example` contains `CHANGE_ME` secrets and `MOCK_EXTERNALS=true`. Do not deploy it publicly without replacing secrets, adding production auth, configuring storage, reviewing policy rules, and connecting real audit/proof infrastructure.

## Private-document handling

- Do not commit private documents, filled `.env` files, production exports, or partner datasets.
- Use synthetic/demo content for local tests.
- Treat proof manifests, document hashes, and audit events as sensitive when they can be linked to a person or case.
- Redact personal data before sharing logs or screenshots.

## Required production gates

Before production use, operators must complete identity, authorization, storage encryption, audit integrity, backup/restore, incident response, dependency review, and threat-model review.
