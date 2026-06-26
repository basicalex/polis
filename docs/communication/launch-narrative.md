# Launch narrative

Strategic-communication design spec for launching Polis Interface's open-governance promise to the public. Grounding: spec §28 strategic communication architecture and spec §34 initial demo scenario. Align with [`open-by-default-contract.md`](./open-by-default-contract.md) and route the public surface through [`public-information-architecture.md`](./public-information-architecture.md).

## Positioning

Polis Interface is [public-read] public-interest civic infrastructure for making governance traceable without exposing private documents by default. In the public mind, it should mean: public maps of institutions, processes, roles, claims, evidence, policy rules, proofs, and audit history that anyone can inspect. The differentiator versus generic “transparency” is [verifiable] policy-as-code plus self-verifiable proof: not just published PDFs, but reviewable Rego rules, hash-linked audit rows, proof manifests, and a `/verify` path that lets the public check claims instead of trusting a press release.

## Audiences & primary message

| Audience | What they want | The one sentence we say to them | Page/route that delivers it |
| --- | --- | --- | --- |
| Citizens | Understand who is responsible, what proof is valid, and how a public service can improve. | [public-read] You can see the process map, evidence, proof, and audit trail before you are asked to trust the system. | `/`, `/issues/[issueId]`, `/governance/[jurisdiction]`, `/verify` |
| Journalists | Source-linked claims, audit history, and a plain limits section. | [verifiable] Every public claim should point to evidence, policy, proof, or audit history you can inspect yourself. | `/transparency`, `/proofs`, `/audit`, `/source` |
| Researchers | Methodology, scoring rules, graph structure, and reproducible decisions. | [verifiable] The methodology, evidence rules, scoring model, and policy source are public enough to critique and re-run. | `/methodology`, `/docs`, `/governance/[jurisdiction]`, `/source` |
| Partner institutions | Safe pilot path without sudden disruption or private-document exposure by default. | [not yet live] A real institution can pilot the model under a written charter, scoped data rules, redaction governance, and public results. | `/partners`, `/pilot/results`, `/transparency` |
| Contributors | Clear places to improve maps, evidence, reviews, code, and governance rules. | [demonstration/stub] You can contribute evidence and graph corrections in the demo flow while production contribution controls mature behind auth. | `/contribute/evidence`, `/contribute/graph-edit`, `/contribute/review`, `/docs` |
| Oversight | Assurance that rules and changes are visible, constrained, and auditable. | [verifiable] The rules governing evidence, AI, rewards, proof, access, and audit are themselves public code and changes are audit-relevant. | `/security`, `/privacy`, `/audit`, `/transparency`, `/source` |

## The show-don't-tell demo path

This [verifiable] walkthrough proves the open-by-default contract by making the public check each trust anchor themselves, not by asking them to accept capability breadth.

1. [public-read] Start at `/governance/[jurisdiction]` to see the seeded governance map: jurisdictions, processes, institutions, roles, domains, laws, budget lines, controls, and claims.
2. [public-read] Open `/issues/[issueId]` to read a concrete public problem: the municipal document requirement map from spec §34, where a citizen asks why the same document moves through multiple offices.
3. [public-read] Open `/contributions/[id]` or `/contribute/evidence` from the source-linked claim to inspect its evidence, then use `/methodology` or `/docs` to inspect how evidence, scoring, and claim status are supposed to work.
4. [verifiable] Open `/proofs` to inspect the proof manifest for a sample public document proof.
5. [verifiable] Use `/verify` to hash-check the document or proof through `POST /api/v1/verify/hash`.
6. [verifiable] Open `/audit` to inspect the public/redacted audit view (§26.4): each visible public row exposes its hash and previous hash and the trail is append-only (no UPDATE/DELETE). Private document-access and private-flow events are restricted and never shown unredacted.
7. [verifiable] Review Rego source in `packages/policy-rules` through `/source`, then re-run the policy decision with `opa eval` against committed policy code.
8. [demonstration/stub] Visit `/assistant`, `/deliberate`, `/contribute/review`, and `/rewards` only after the proof path, with explicit labels: deterministic RAG, no live Polis, demo review, demo eligibility.

Cross-reference: [`open-by-default-contract.md`](./open-by-default-contract.md) owns the public-read, verifiable, demonstration/stub, and explicit-limits contract.

## Messaging guardrails — what we claim vs. do NOT claim

Hard rules:

- [demonstration/stub] Never present a stub as live. Label assistant, deliberation, contribution/review, rewards eligibility, timestamps, and signatures as demonstration surfaces unless a production milestone explicitly replaces the stub.
- [verifiable] Lead with verifiability, not breadth: “inspect the rule, proof, hash, source, or audit row” beats “we have AI / rewards / deliberation.”
- [public-read] Say “public by default for public governance artifacts,” not “everything is open.” Private documents are not exposed by default.
- [not yet live] State limits plainly: no production authority connected; no live Polis; no external AI model; no Paperless backend; no active timestamp, signature, identity, or payment provider.
- [verifiable] Tie every public capability claim to one of four anchors: `/verify`, audit-chain hash linkage, proof manifest inspection, or in-repo Rego review.

| Forbidden claim | Approved framing |
| --- | --- |
| “AI-powered advice for citizens.” | [demonstration/stub] “The assistant is deterministic RAG over approved evidence today; no external AI model is live.” |
| “Live government data.” | [not yet live] “The public launch uses seeded governance data and a simulated pilot until a real partner charter is signed.” |
| “Live Polis deliberation.” | [demonstration/stub] “The deliberation surface demonstrates the mechanism; no upstream Polis instance is live.” |
| “Paperless integration is running.” | [not yet live] “No Paperless backend is processing documents in local v1.” |
| “Cryptographically official documents.” | [demonstration/stub] “Proofs use hash manifests and test-key signatures today; production timestamp/signature providers are not yet active.” |
| “Identity, payments, and rewards are production-ready.” | [demonstration/stub] “Identity and rewards are demo/local flows; no active identity or payment provider is connected.” |
| “Everything will be open.” | [public-read] “Public governance artifacts are open by default; private documents stay private by default.” |
| “AI will run the state.” | [verifiable] “Rules, sources, scores, AI behavior, and changes are auditable; humans and institutions remain accountable.” |
| “This proves a government has adopted Polis Interface.” | [not yet live] “M9 proves the mechanism with a simulated Grad Primjer pilot; M15 is the first real partner proof point.” |

## The partner-pilot story arc

M9 is [demonstration/stub] the simulated Grad Primjer pilot: [`docs/pilot/charter.md`](../pilot/charter.md) defines the partner as simulated, scopes the municipal complaints process, publishes charter/results expectations, and names redaction governance. The public story is [verifiable]: the model can publish a charter, show what evidence will be public, preserve an audit trail, and prevent unilateral deletion of results while no real personal data or production authority is involved.

M15 is [not yet live] the real partner institution under written charter. The launch arc moves from [demonstration/stub] “the mechanism works in a simulated civic setting” to [not yet live] “a real institution accepts the open-by-default obligation”: purpose, jurisdiction, data categories, retention, review roles, escalation paths, publication rules, rollback conditions, and redactions agreed before real data is used. Use [`docs/partners/pilot-charter-template.md`](../partners/pilot-charter-template.md) as the bridge and cite spec §30.10 for the pilot milestone. The proof point is not adoption theater; it is [verifiable] whether the charter, results, redactions, proofs, and audit history remain inspectable after institutional pressure begins.

## Phased communication rollout

### A. Read-only public launch of trust anchors now

Communicate [public-read] the governance map, public claims, proof manifests, `/verify`, audit-chain reads, methodology, source, and the pilot charter/results surface. Communicate [verifiable] that policy-as-code in `packages/policy-rules` can be reviewed and re-run. Communicate [demonstration/stub] assistant, deliberation, contribution/review, rewards eligibility, timestamps, and signatures as mechanism demos only. Prime canonical surface: `/transparency`, currently a thin stub, should become the public open-by-default landing page.

### B. First real partner pilot — M15

Communicate [not yet live] until signed. Once signed and scoped, communicate [public-read] the partner charter, public purpose, metrics, redaction rules, and results. Communicate [verifiable] proof manifests, `/verify`, audit-chain linkage, and policy source for the pilot. Do not communicate private-document processing unless M10–M14 prerequisites are live and documented.

### C. Productionization milestones — M10–M14

Communicate each private-flow capability only when the corresponding milestone is live behind auth: [not yet live] M10 identity/auth, M11 Paperless, M12 RFC3161 timestamp + EU DSS signature, M13 real AI provider, M14 real upstream Polis. Until then, the public message is narrower and stronger: public-read trust anchors work now; private integrations are deliberate productionization steps, not implied launch claims.

## Risk & honesty posture

[verifiable] Over-claiming is the top reputational risk. The project wins trust by making its limits as visible as its capabilities. The explicit-limits section of [`open-by-default-contract.md`](./open-by-default-contract.md) is mandatory in all external comms, partner decks, demos, homepage copy, release notes, and pilot announcements. If a claim cannot be tied to `/verify`, audit-chain linkage, proof manifests, or reviewable Rego source, it must be rewritten as [demonstration/stub], [not yet live], or removed.
