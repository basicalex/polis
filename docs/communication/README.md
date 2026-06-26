# Communication & open-structure design

Design specs for communicating Polis Interface's open-governance promise to the
public. Public-first strategy: the open-policy/transparency promise is
**public-read by design** and ships now on a read-only track, **in parallel with**
(not blocked by) the slower M10–M15 productionization milestones that gate
private/transactional flows behind auth.

## The set

| Doc | Owns |
|---|---|
| [`open-by-default-contract.md`](./open-by-default-contract.md) | **Source of truth.** What is published by default, what anyone can verify, what is demonstration-only, and what is explicitly not live yet. |
| [`public-information-architecture.md`](./public-information-architecture.md) | Public portal IA + the five-stage narrative arc (Problem → How → Evidence → Verify → Participate), trust-first nav, and the `transparency.astro` upgrade spec. |
| [`launch-narrative.md`](./launch-narrative.md) | Strategic communication: positioning, audiences, the show-don't-tell demo path, claim/limit guardrails, and the M9→M15 partner-pilot arc. |

## Capability tags (used across all three)

Every capability claim is tagged: `[public-read]` · `[verifiable]` · `[demonstration/stub]` · `[not yet live]`. Stubs are never presented as live capability.

## Relationship to root docs

These specs are the **public-facing expression** of [`TRANSPARENCY.md`](../../TRANSPARENCY.md) and [`GOVERNANCE.md`](../../GOVERNANCE.md); the visual contract is [`DESIGN.md`](../../DESIGN.md) (dark terminal-mono). Spec grounding: §28 (strategic communication), §34 (demo scenario), §26.3 (audit), §30.10 (pilot). Productionization context: [`../roadmap/productionization-overview.md`](../roadmap/productionization-overview.md).

## Fast path (why this is unblocked)

Public-read trust anchors — governance graph, source-linked claims, proof manifests, `/verify`, the append-only hash-chained audit trail (public/redacted view per §26.4; only `visibility=public` rows are exposed), methodology, and policy-as-code Rego — require **no auth and none of M10–M15**. The launch-hardening items (flip `IDENTITY_DEV_TOKENS=false`, label all stub data as demonstration, read-only/rate-limit the public BFF edge) are config + small guards, tracked as the next implementation step.
