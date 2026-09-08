---
version: '2.2'
name: 'Polis production design system'
description: 'Upstream visual and product design contract: the Trace line mechanism in a light civic world.'
direction:
  locked: 'Trace line'
  mechanism: 'One accountability record appends through voice, responsibility, response, independent check, and public receipt.'
  source: 'Reviewed generation 1 Trace line pitch, selected by the user on 2026-08-21. Visual world revised to light civic by the user on 2026-08-22; the mechanism and meaning model are unchanged. Interactive demo platform added by the user on 2026-08-22: the staged pitch moves to /presentation and the root becomes the product landing with working role demos. Demo chrome and tactile material locked by the user on 2026-08-22 from design-lab/demo-cohesion/refined (gen2): segmented role switcher, one-line boundary, ledger rows, engraved trace timeline, straight ink-stamp status marks.'
colors:
  bg: '#FAF8F5'
  surface: '#FFFFFF'
  surface-tint: '#F2EFE9'
  text: '#1C2024'
  muted: '#5A6472'
  border: '#E4E0D8'
  border-strong: '#C9C3B8'
  primary: '#0E7490'
  trace: '#0E7490'
  success: '#15803D'
  warning: '#8A5D00'
  danger: '#B91C1C'
  restricted: '#6D28D9'
  unknown: '#5A6678'
  on-primary: '#FFFFFF'
  on-danger: '#FFFFFF'
typography:
  display:
    fontFamily: "'Source Serif 4', Georgia, 'Times New Roman', serif"
    fontWeight: '600'
    source: 'Local self-hosted files only'
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif"
    fontSize: '1rem'
    fontWeight: '400'
    lineHeight: '1.55'
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: '0.875rem'
    fontWeight: '400'
    lineHeight: '1.45'
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif"
    fontSize: '0.8125rem'
    fontWeight: '600'
    letterSpacing: '0.06em'
    lineHeight: '1.4'
  heading-sm:
    fontFamily: "'Source Serif 4', Georgia, 'Times New Roman', serif"
    fontSize: 'clamp(1.35rem, 1.1rem + 1vw, 1.75rem)'
    fontWeight: '600'
    lineHeight: '1.2'
  heading-lg:
    fontFamily: "'Source Serif 4', Georgia, 'Times New Roman', serif"
    fontSize: 'clamp(2rem, 1.4rem + 2.6vw, 3.4rem)'
    fontWeight: '600'
    lineHeight: '1.08'
rounded:
  sm: '0.25rem'
  md: '0.5rem'
  pill: '999px'
spacing:
  '1': '0.25rem'
  '2': '0.5rem'
  '3': '0.75rem'
  '4': '1rem'
  '5': '1.25rem'
  '6': '1.5rem'
  '8': '2rem'
  '10': '2.5rem'
  '12': '3rem'
  '16': '4rem'
  xs: '0.5rem'
  sm: '0.75rem'
  md: '1.25rem'
  lg: '2rem'
  xl: '3rem'
layout:
  readingMeasure: '68ch'
  evidenceMeasure: '74rem'
  railWidth: '15rem'
  tapTarget: '2.75rem'
  phoneBreakpoint: '40rem'
  compactBreakpoint: '56.25rem'
components:
  app-background:
    backgroundColor: '{colors.bg}'
    textColor: '{colors.text}'
    typography: '{typography.body}'
  panel:
    backgroundColor: '{colors.surface}'
    borderColor: '{colors.border}'
    textColor: '{colors.text}'
    rounded: '{rounded.md}'
    padding: '{spacing.md}'
  action-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    minHeight: '{layout.tapTarget}'
  action-secondary:
    backgroundColor: '{colors.surface}'
    borderColor: '{colors.border-strong}'
    textColor: '{colors.text}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    minHeight: '{layout.tapTarget}'
  status-pending-review:
    textColor: '{colors.warning}'
    typography: '{typography.label}'
  status-verified-local:
    textColor: '{colors.success}'
    typography: '{typography.label}'
  status-restricted:
    textColor: '{colors.restricted}'
    typography: '{typography.label}'
  status-not-live:
    textColor: '{colors.warning}'
    typography: '{typography.label}'
---

# Polis design contract

This file is the upstream contract for every Polis product surface, presentation, document, marketing page, and visual asset. Subsystem design files may specialize it but cannot contradict it.

## Direction lock

**Trace line is locked.** The reviewed generation 1 Trace line direction is the production source. Do not blend in the Split rail or Evidence dossier compositions unless the user changes this contract.

**The visual world is light civic (user decision, 2026-08-22).** The original dark evidence-room rendering read as an engineering console: warning chips louder than the story, border-only hierarchy, monospace prose. The production world is now a calm, light, paper-and-ink civic register. The mechanism, stage order, meaning model, privacy boundary, and honesty labels did not change; only their visual rendering did.

The product mechanism is one traceable accountability record moving through five ordered stages:

1. **Voice:** a person raises a problem or question.
2. **Responsibility:** the responsible public office and response obligation become inspectable.
3. **Response:** an official files a scoped commitment; it begins `PENDING REVIEW`.
4. **Independent check:** a distinct reviewer assesses evidence and controls publication or terminal status.
5. **Public receipt:** the public record appends the accepted decision, status, sources, and audit linkage.

The line is not a metaphor for progress and never decorates an unrelated layout. Every segment represents one appended public event. Every node names the stage, actor or role, action, time, and current state. Removing an event removes its segment. A dashed segment beyond a review gate means proposed history, not accepted history.

## Product experience

- **Product:** Polis, the public response layer between community voice and government action.
- **Primary audiences:** residents and community representatives, public officials and staff, independent reviewers, journalists, watchdogs, funders, and technical contributors.
- **Primary promise:** show who owns a public response, what was promised, what evidence changed the status, who reviewed it, and what happened in the end without exposing private case material.
- **Desired impression:** exact, calm, inspectable, and useful under pressure.
- **Trust level:** high scrutiny, low spectacle. State limits beside the claim or control they qualify.

The current strongest path is a local demonstrator with synthetic data. There is no authorized partner deployment. Općina Vrsar is a pilot target only; its name never implies engagement, authorization, transferred data, deployment, or outcome.

## Brand personality

- **Voice:** plain, evidence-linked, constructive toward the public and institutions.
- **Mood:** a calm civic reading room — paper, ink, and one traced record as the main object.
- **Keywords:** response, responsibility, review, source, boundary, receipt.
- **Avoid:** anti-government posture, sales language, civic-tech spectacle, generic dashboards, fake authority, invented outcomes, architecture-first explanations, and cryptographic mystique.

Lead with the response loop. Do not lead with AI, blockchain, services, signatures, hashes, or feature lists. Polis is not a social network, campaign platform, political ranking system, generic CRM, AI decision-maker, or production-ready service.

## Visual principles

1. **One record, one path.** Keep the record ID and current stage visible. Let evidence panels explain the selected node rather than compete with the line.
2. **Boundaries stay visible.** Public accountability and restricted casework may share a process reference, never private content. Show the boundary in structure, text, icon, and pattern.
3. **State before style.** Every status has an explicit label and semantic icon or shape. Color is only reinforcement.
4. **Evidence stays legible.** Prefer whitespace, hairline rules, rows, and source lists over glass, depth, ornamental cards, or document theatre. Hierarchy comes from size, weight, and space — never from stacking borders. Never nest a bordered panel inside another bordered panel.
5. **Limits stay adjacent — and quiet.** Fixture, local-only, pilot-target, proof, and not-live qualifications appear where the related claim is read or acted on, as small colored text labels. The page-level demonstration boundary is stated once, in one slim banner; it is never repeated as decoration on every section. A disclosure label may never be visually louder than the claim it qualifies.

## Trace topology

### Required anatomy

A trace view contains:

- a stable public record ID;
- ordered nodes for `voice`, `responsibility`, `response`, `check`, and `receipt`;
- a text stage label at every node;
- the public actor or responsible role, action, timestamp, and status change;
- a visibly emphasized newest event;
- source or audit links attached to the event they support;
- an independent-review gate before publication and before any terminal follow-through status;
- a receipt ledger that preserves public event order and hash linkage without exposing identity or case bytes.

Use a solid trace-teal segment only for appended public history. Use a dashed trace-teal segment and explicit `AWAITING INDEPENDENT REVIEW` text for a proposed transition. Green may mark an accepted local verification result or accepted review row; it does not replace the review label. No teal flourish, divider, underline, border, or connector may look like part of the trace unless it joins real events.

### Public and restricted boundary

The public record may show the process, responsible office, response obligation, commitment, review decision, sources, status, and public receipt. The restricted workflow may contain identity documents, case narrative, contact details, resident files, and internal notes.

Restricted content must not be fetched, serialized into page data, placed in the DOM, printed, copied into analytics, or hidden only with CSS. A public view may show category names and masked placeholders to explain what is withheld. The private branch terminates at that boundary; private bytes never join the public trace.

Use purple, a lock icon, a hatched mask, and `PRIVATE / RESTRICTED`. Purple never means failure. Red never means private.

## One brand, two operating densities

Polis has one visual system and two surface modes.

### Public and presentation surfaces

- Use a narrative reading order and more space between the five trace stages.
- Make the unanswered record the first object; do not add a generic hero above it.
- Keep the demonstration boundary and current capability label visible.
- Explain sources and proof in public language before showing hashes or implementation details.
- Presentation mode may reveal one appended node at a time, but the active record, state, labels, and evidence remain readable without narration.
- The close is a working charter, not a sales CTA: process, owner, private boundary, public commitment or outcome, and independent reviewer.

### Task and operate surfaces

- Use the same field, type, trace, status, icon, border, and panel tokens at a denser rhythm.
- Keep a compact trace summary near queues, forms, review decisions, and record detail; do not turn every task screen into a five-beat deck.
- Put the next permitted action, blocking gate, owner, due state, and evidence requirement before secondary metadata.
- Preserve labels when space tightens. Do not reduce the interface to colored dots or icon-only controls.
- Do not use staged pitch animation, theatrical transitions, or quiet auto-hiding controls in operational work.

The difference is information density and task priority, not branding. Do not create separate public and staff themes.

## Demo platform surfaces

The public release is one site with three kinds of surface (user decision, 2026-08-22):

- `/` is the product landing: what Polis is, one sentence of mechanism, and entry points into each role demo and the presentation. It is not a marketing hero; the record loop is the subject.
- `/presentation` (and `/hr/presentation`) is the staged Trace line pitch, with presenter mode. It keeps its existing behavior unchanged.
- `/demo/*` are working role surfaces over one shared synthetic dataset: citizen (`/demo/citizen`), official (`/demo/official`), independent reviewer (`/demo/review`), the public record (`/demo/record`), and the embeddable interface demonstration (`/demo/embed`).

### Demo state rules

- Demo state lives only in the visitor's browser (localStorage plus in-memory fallback), seeded from committed synthetic fixtures. No network write exists. A visible reset control restores the seed.
- Demo actions obey the real meaning model: a filed report starts a record at `voice`; an official can accept responsibility and file a commitment, which starts `PENDING REVIEW`; only the reviewer surface can publish or return it; officials never set terminal status. The demo must not contain a shortcut the real product would forbid.
- One record object serves every role surface. Role surfaces list and act; `/demo/record` is the single place a full trace renders.
- Every demo surface states the demonstration boundary exactly once, as one thin line under the app bar (see Demo chrome below). The current role is conveyed by the role switcher, not by a separate role label or an inline "you are here" note. Records created by the visitor are labeled as their own demo input, distinct from seeded fixtures.
- Demo surfaces use the task/operate density of this contract: same tokens, denser rhythm, no staged pitch animation.
- Demo pages do not open with explanatory paragraphs. The page title, the institution line, and the working surface come first; provenance and role explanation live below the working content, not above it.

### Demo chrome and material (locked 2026-08-22, source: design-lab/demo-cohesion/refined)

The gen2 mockups are the visual authority for `/demo/*`; the corrections below override the mockups where they conflict.

- App bar: `Polis` wordmark left; a compact five-segment role switcher (Citizen · Official · Review · Record · Embed) with the active segment filled in `--polis-trace` and `--polis-on-primary` text; right side an `EN | HR` toggle and a reset control (icon button with an accessible name). On narrow viewports the switcher collapses to a role pill that opens the same five destinations.
- Boundary line: one centered muted line directly under the app bar ("Demonstration — fictional data, stored only in this browser." / HR equivalent). No second banner, no separate browser-local note paragraph.
- Institution anchor: demo page titles carry one quiet line `Grad Primjer — public record` / `Grad Primjer — javna evidencija` beneath them.
- Material: the page keeps the warm paper field; panels are soft layers with a hairline `--polis-border` and one diffuse low shadow. Lists are ledger rows separated by printed hairlines, never floating cards per row; the selected row is marked by a `--polis-surface-tint` fill and a left trace-colored rule.
- Buttons stay flat: solid `--polis-trace` fill or hairline outline, one soft shadow at most. No glossy bevels, no gradients, no inner highlights.
- The trace timeline is the spine: one continuous vertical line with numbered stage dots (filled = appended, ring = active, empty = ahead), each stage one bold short line plus one muted line. No stage renders as a paragraph.
- Status marks are straight ink-stamp chips: mono, uppercase, letter-spaced, hairline border in the status color. Never rotated, never circular seals or stars.
- Typography on demo surfaces: serif is reserved for the wordmark, page titles, and record subjects; all other UI text is the sans body; IDs and status chips are mono.
- Surface layouts: official and review are queues — a status-bucket rail with counts, compact ledger rows, and a detail panel carrying the trace timeline plus only the legal actions for that role. Citizen is "My reports": stepper cards plus one primary report action with category-first entry. Record renders the full trace with the same timeline anatomy. Embed keeps its emulation behavior and adopts this chrome.

### Embed demonstration rules

- The embed surface shows an emulated browser frame, visually explicit as an emulation (plain chrome, fictional address), never a claim of a live integration.
- The framed site is the fictional municipality Grad Primjer only. Never reproduce a real municipality's branding, domain, screenshots, seals, or content — including Vrsar. `PILOT TARGET` language stays out of the emulated site.
- The embedded Polis widget uses these tokens, carries its own fixture label, and writes to the same demo store with an `embed` origin, so the filed report is then visible in the app surfaces — that continuity is the point of the demonstration.

## Meaning model

Disclosure, workflow state, verification result, capability, and deployment boundary are separate fields. Never collapse them into one badge.

| Meaning | Required label | Visual treatment | Exact interpretation |
| --- | --- | --- | --- |
| Public disclosure | `PUBLIC` / `JAVNO` | Text label plus open-document icon | The named fields are approved for public reading. It says nothing about truth, review, or deployment. |
| Restricted disclosure | `PRIVATE / RESTRICTED` / `PRIVATNO / OGRANIČENO` | Purple label, lock icon, hatched mask | The content stays on the restricted rail. Public pages show no private values or bytes. |
| Pending review | `PENDING REVIEW` / `ČEKA NEOVISNU PROVJERU` | Amber label plus review-clock icon; dashed trace after the gate | A commitment or resolution claim has not passed independent review. It is not published history or a terminal outcome. |
| Review accepted | `ACCEPTED BY INDEPENDENT REVIEW` / `PRIHVAĆENO NEOVISNOM PROVJEROM` | Green label plus check icon | A distinct reviewer accepted the filing and the receipt appended. It does not make the underlying claim true. |
| Review returned | `RETURNED BY INDEPENDENT REVIEW` / `VRAĆENO NEOVISNOM PROVJEROM` | Amber label plus return icon | The reviewer sent the filing back with a required note; nothing published. A return is not a failure result — red is not used. |
| Verified local | `VERIFIED LOCALLY` / `LOKALNO PROVJERENO` | Green label plus check icon | A named local check completed against the stated local registry or fixture. It does not mean deployed, independently reviewed, or true. |
| Pilot target | `PILOT TARGET` / `CILJ PILOT-PROJEKTA` | Amber label plus outlined target icon | A prospective scoped pilot context only. It implies no engagement, authorization, data transfer, outcome, or partner claim. |
| Not live | `NOT LIVE` / `NIJE AKTIVNO` | Amber label plus stop-square icon | The surface or capability is demonstrator material and is not an authorized production service. |
| Demonstration fixture | `DEMONSTRATION FIXTURE` / `DEMONSTRACIJSKI PRIMJER` | Amber label plus document-fixture icon | Frozen synthetic test material, never a real person, case, partner record, or result. |
| Mismatch or invalid | Exact failure such as `CHANGED BYTE — NO MATCH` | Red label plus cross icon | A performed check failed. Red is reserved for actual failure, invalid input, or destructive action. |
| Unknown or not checked | Exact label such as `NOT CHECKED` | Neutral label plus question icon | No result is available. It must not look successful or pending review. |

A commitment starts `PENDING REVIEW` after its charter and scope gate. It publishes only after a distinct independent review. An official cannot declare their own terminal follow-through state.

Evidence and proof never make a claim true. A byte match means the checked bytes match the registered bytes. A signature means the stated key signed the stated bytes. A timestamp means the stated timestamp mechanism returned the stated result. The interface must say which mechanism ran, against which source, and with which result.

Use `hash-linked` or `tamper-evident`, never `immutable`.

## Color system

The default product world is light: warm paper, near-black ink, one deep teal accent. Critical information must survive forced colors, grayscale, and print.

| Token | Value | Use |
| --- | --- | --- |
| `--polis-bg` | `#FAF8F5` | Root field and full-page background (warm paper) |
| `--polis-surface` | `#FFFFFF` | Panels and controls that must sit above the page |
| `--polis-surface-tint` | `#F2EFE9` | Quiet tinted regions: withheld categories, receipt ledger field |
| `--polis-text` | `#1C2024` | Primary text (ink) |
| `--polis-muted` | `#5A6472` | Secondary text that remains readable |
| `--polis-border` | `#E4E0D8` | Hairline dividers and panel edges |
| `--polis-border-strong` | `#C9C3B8` | Inputs, controls, and active structural boundaries |
| `--polis-trace` | `#0E7490` | Inspectable trace, active navigation, focus, primary action |
| `--polis-valid` | `#15803D` | Exact positive result only |
| `--polis-warning` | `#8A5D00` | Fixture, pending, warning, pilot-target, and not-live families; labels separate meanings |
| `--polis-restricted` | `#6D28D9` | Private and restricted boundary only |
| `--polis-danger` | `#B91C1C` | Invalid result, error, and destructive action |
| `--polis-unknown` | `#5A6678` | Unknown, absent, or not-checked result |

Status colors are used as text and icon color on the light field, not as fills or loud borders. Do not use gradients, glows, blur, or shadows to establish hierarchy. A restrained shadow is allowed only when a temporary overlay must separate from content. Never put low-contrast text on a tinted status background.

One corner radius scale and one shadow scale, both defined once in `packages/ui/src/styles/base.css` with every other token:

| Token | Value | Use |
| --- | --- | --- |
| `--radius-sm` | `0.25rem` | Controls, inputs, chips, stamps |
| `--radius-md` | `0.5rem` | Panels, cards, drop zones |
| `--radius-pill` | `999px` | Fully rounded controls only |
| `--shadow-1` | ink at 6% | The one soft panel layer |
| `--shadow-2` | ink at 10% | Dialogs and temporary overlays |
| `--shadow-3` | ink at 14% | Menus over dense content |

Shadows tint toward the ink color in the light world and toward black in the dark demonstrator. They separate an overlay from what it covers; they never carry hierarchy on the page itself.

## Typography

### Font policy

- Self-host Source Serif 4 weight 600 (regular and, where needed, italic) for display headings. Store font files in the product build; make no external font request. Use `font-display: swap`. The former Barlow Condensed display face is retired from product surfaces.
- Use the system sans stack in frontmatter as the workhorse body, form, navigation, control, and status-label face. The product must remain stable when Source Serif 4 is unavailable; Georgia is the fallback.
- Use the mono stack only for record IDs, hashes, and code. Dates, statuses, capability values, and disclosure values are set in the sans label style, not monospace. Do not set page body, prose, buttons, or headings in monospace.
- Status labels use the sans label face: `0.8125rem`, weight 600, `0.06em` letter spacing, uppercase where the reviewed label is uppercase. Never boxed, never filled, never monospace.
- Do not use more than these three families.

### Scale and measure

The root size stays at `100%`; respect browser zoom and user font settings. Use rem and fluid `clamp()` values. Pixels are limited to one-pixel rules, raster asset dimensions, and compatibility declarations for the 44 CSS pixel target.

| Token | Size | Line height | Use |
| --- | --- | --- | --- |
| `--type-meta` | `0.75rem` | `1.4` | Short labels; never primary instructions |
| `--type-data` | `0.875rem` | `1.45` | IDs, hashes, dates, and statuses |
| `--type-body` | `1rem` | `1.55` | Workhorse prose and controls |
| `--type-body-lg` | `clamp(1.0625rem, 1rem + 0.3vw, 1.25rem)` | `1.5` | Lead and public explanation |
| `--type-heading-sm` | `clamp(1.35rem, 1.1rem + 1vw, 1.75rem)` | `1.15` | Panel and section headings |
| `--type-heading-lg` | `clamp(1.9rem, 1.4rem + 2.4vw, 3.1rem)` | `1.1` | Page and presentation headings |

Keep body text at or above `1rem` and critical labels at or above `0.875rem`. Limit prose to `68ch`; evidence compositions may reach `74rem`. Use balanced wrapping only on short display headings. Let IDs and hashes wrap anywhere; never shrink them until unreadable.

## Layout system

- Use one spacing ladder on a 4px base: `--space-1` `0.25rem`, `--space-2` `0.5rem`, `--space-3` `0.75rem`, `--space-4` `1rem`, `--space-5` `1.25rem`, `--space-6` `1.5rem`, `--space-8` `2rem`, `--space-10` `2.5rem`, `--space-12` `3rem`, `--space-16` `4rem`. Nothing off the ladder. The older names remain as aliases: `--space-xs` = `--space-2`, `--space-sm` = `--space-3`, `--space-md` = `--space-5`, `--space-lg` = `--space-8`, `--space-xl` = `--space-12`.
- Center public reading surfaces. Use a maximum `74rem` evidence column plus an optional `15rem` stage rail on wide screens.
- Prefer CSS grid with `minmax(0, 1fr)` and intrinsic content sizing. Do not fix application content to presentation capture dimensions.
- Keep panels flat: either a hairline border or a quiet tint, never both stacked, with `0.25rem` or `0.5rem` corner radius and no ornamental card nesting. Most of the page needs no enclosure at all — whitespace and hairline rules separate sections.
- Place empty, loading, unavailable, and error states in the content region they replace. Keep the record ID, boundary label, cause, and next permitted action visible.
- Skeletons may reserve layout briefly but cannot hide an error or imitate verified content. Use text such as `Loading public record…`, not animated shimmer under reduced motion.

### Phone under stress

At `56.25rem` and below, move the stage rail above the record. It may scroll horizontally with snap points, a textual active-stage cue, and a visible overflow cue. Updating the active stage must not move keyboard focus.

At `40rem` and below:

- use one content column and at least `1rem` inline page padding;
- keep the trace as a narrow left rail with every node and label intact;
- stack field labels over values when needed;
- restack receipt tables into labeled rows rather than forcing page-level horizontal scroll;
- wrap status boundaries, language controls, actions, and legends without clipping;
- keep every target at least `2.75rem × 2.75rem` with adequate separation;
- keep the primary action and blocking status visible without sticky layers covering content;
- never rely on hover, drag, fine motor control, or a swipe-only path.

The page must have no horizontal body overflow at 320 CSS pixels, 390 × 844, 200% zoom, EN, or HR. A locally scrollable code or raw-hash region is allowed only when it has a keyboard path, visible overflow cue, and equivalent wrapped text.

## Panels and controls

### Panels

- A panel has one purpose, one heading, at most one enclosure, and a stable place in reading order.
- Put status and disclosure labels in the panel header. Put the source beside the field or event it supports.
- Use description lists for field/value records, lists for event trails, and native tables for comparable rows.
- On phone layouts, preserve table header meaning with visible per-cell labels.
- Do not make evidence resemble an authenticated civic document. Synthetic material stays a flat product panel with its fixture label attached.

### Actions and forms

- Use native buttons, links, inputs, selects, textareas, fieldsets, and legends before custom widgets.
- Every button is one `.btn` with a `data-variant`. Primary fills with the trace color and carries the on-primary text; there is one primary per view. Secondary uses a surface fill and a strong border. Tertiary has no fill and no border: trace-colored text that underlines on hover. Danger fills with red and is used only when the action destroys something. A bare `<button>` paints nothing.
- Every button clears the `2.75rem` target, uses `--radius-sm`, weight 600, and `1rem` text.
- Every control has a persistent text label. Icon-only controls require an accessible name and are reserved for universally understood compact actions.
- Disabled controls remain legible and state why the action is unavailable. A dashed edge and a quiet fill carry the state; opacity alone does not. `aria-disabled` reads the same as `disabled`.
- Put instructions and validation near the field. Error text names the problem and the correction; do not blame the user.
- A review decision must show the reviewer role, independence rule, evidence scope, and consequence before submission.
- Confirmation dialogs are reserved for destructive or irreversible actions. Trap focus, close on `Escape` where safe, and restore focus to the invoking control.
- Toasts may confirm a completed action but cannot carry the only copy of an error, review state, or public receipt.

### Navigation

- Keep the five trace stages in the same order everywhere.
- Mark the current stage with text and `aria-current`, not color alone.
- A skip link targets primary content. Route changes and record changes produce a clear page heading.
- Do not hide required navigation behind fullscreen, hover, pointer movement, or animation.

## Motion and interaction

Motion explains one state change. Allowed motion:

- append the newest trace node;
- draw the segment created by that append;
- disclose a panel after an explicit action;
- transition a verifier from unchecked to an announced result;
- move between presenter beats.

Use `120–200ms` for control feedback, `200–320ms` for panel disclosure, and at most `520ms` for a trace append. Use `cubic-bezier(0.16, 1, 0.3, 1)` for authored trace motion and a standard ease-out for controls. Do not use ambient loops, parallax, scroll hijacking, autoplay, celebratory motion, bouncing status, or motion on private content.

With `prefers-reduced-motion: reduce`, remove animation, transition, smooth scrolling, and delayed reveal. Render the same record, boundary, gate, decision, verifier result, and receipt immediately. Reduced motion changes timing, never information or order.

## Presenter behavior

Presenter mode supports visible previous, next, progress, and fullscreen controls. The keyboard contract is:

- `ArrowRight`, `ArrowDown`, `PageDown`, or `Space`: next beat;
- `ArrowLeft`, `ArrowUp`, or `PageUp`: previous beat;
- `Home`: first beat;
- `End`: receipt beat;
- `F`: toggle fullscreen;
- `Escape`: dismiss a fullscreen error or leave native fullscreen.

Clamp at the first and last beats. Global shortcuts must ignore events originating in buttons, links, inputs, textareas, selects, and editable content. Fullscreen denial must produce an announced inline error and leave the presentation usable in the window. Controls remain fully opaque while focused and permanently visible under reduced motion.

## Bilingual EN/HR

- EN and HR are equal product languages with the same information, stage order, actions, status meanings, source references, and privacy boundaries.
- Use one typed content source when both languages appear in one application. Do not maintain direction-specific or component-specific translations of the same product claim.
- Set the document `lang` attribute on language change. Keep the language choice reachable by keyboard and preserve the current record and stage.
- Allow at least 30% text expansion. Do not truncate status labels, action labels, evidence notes, or Croatian diacritics. Do not encode meaning in English abbreviations alone.
- Dates, times, numbers, and plural forms use locale-aware formatting. Stable record IDs and hash values do not change.
- Use the reviewed labels in the meaning table. A Croatian public-sector editor must review charter, independent-review, and public-receipt terminology before an external release.

## Fixture and provenance rules

The page-level demonstration boundary — fixture material, pilot-target scope, not-live status — is stated once in a slim persistent banner at the first view, in plain sentence form, with the reviewed labels available behind or beside it. Beyond that banner, a boundary label appears only where its specific claim is read:

- `PENDING REVIEW` on the commitment and proposed trace events;
- `PRIVATE / RESTRICTED` on the withheld-categories panel;
- `LOCAL PROOF REGISTRY / TEST MATERIAL` on the verifier;
- `PILOT TARGET` on the pilot worksheet;
- `DEMONSTRATION FIXTURE` / `NOT LIVE` in the banner, the footer, and print headers — not repeated per section.

A fixture view names its fixture ID, capability state, and disclosure class in one quiet metadata line, and links to the transparency page, which carries the full source-reference list. Repository file paths are provenance data for the transparency page, never body copy on the public story. Labels remain attached in mobile, presenter, fullscreen, print, screenshots, and copied excerpts. Do not use real resident data, private data, civic photography, partner marks, official seals, fake signatures, fake evidence, or external hosts to make a fixture feel real.

A verifier must show the file or record checked, registered value, computed value, mechanism, result, and whether bytes leave the device. Match and mismatch states are both explicit. Always include: “A match shows the registered bytes match; it does not make the claim true.”

## Imagery and iconography

- Prefer the record, trace, public fields, masked categories, review gate, source rows, and receipt ledger over illustrative media.
- Do not use stock civic photography, portraits, government-building imagery, abstract network art, maps without a product need, aged-paper effects, or fabricated official documents.
- Author simple inline SVG icons. Icons inherit semantic color, use a consistent stroke weight, and include a text label or accessible name.
- Screenshots retain the fixture, pilot-target, not-live, language, and provenance boundaries. Never crop away a qualification.
- Video or animation follows the same motion and labeling rules and includes captions and a transcript.

## Accessibility requirements

- Meet WCAG 2.2 AA contrast: `4.5:1` for normal text, `3:1` for large text and meaningful UI graphics. Test status combinations, not just base text.
- Keep DOM order equal to reading order at every breakpoint. Do not use CSS reordering to change meaning.
- All actions work with keyboard alone. Focus is never trapped except in an open modal dialog.
- Use a visible `0.125rem` trace-teal focus outline with `0.125rem` offset. In forced-colors mode, use system focus colors and borders.
- Status, disclosure, review, proof, and verifier changes expose text and suitable semantics. Announce asynchronous results with `role="status"`; use `role="alert"` only when immediate action is required.
- Decorative trace segments are hidden from assistive technology; the ordered event list carries the same relationship in text.
- Minimum target size is `2.75rem × 2.75rem`. Minimum workhorse text is `1rem`; critical labels are at least `0.875rem`, with one exception: the uppercase letter-spaced status-label style may use its specified `0.8125rem`.
- Provide alt text for informative images, empty alt text for decoration, captions for recorded media, and transcripts for audio.
- Never reveal restricted text in accessible names, hidden descriptions, page source, or announcements.

## Print

Printing produces a usable record, not a screenshot.

- Use a light, high-contrast field and preserve dark text, rules, labels, icons, and patterns without depending on background printing.
- Public and task records use A4 portrait by default with sensible US Letter fallback. Trace presentations use A4 landscape with one complete stage per page.
- Print every public trace event, record ID, status, disclosure label, source reference, review gate, verifier meaning, receipt row, selected language, fixture boundary, pilot-target boundary, and not-live boundary.
- Expand collapsed public evidence needed to understand the record. Remove navigation, buttons, sticky positioning, animation, and nonessential chrome.
- Keep restricted content absent. Print only the category and `PRIVATE / RESTRICTED` mask.
- Avoid splitting a trace node, review decision, source item, verifier result, or receipt row across pages. Show full link text or a numbered URL reference where a destination matters.

## Testable release gates

A product-facing change is not ready until the affected surface passes these checks:

1. **Trace:** each visible segment maps to one ordered public event; newest, gated, reviewed, and receipt states remain distinct in text.
2. **Privacy:** restricted values and bytes are absent from public HTML, serialized page data, network responses, print, analytics, and accessible names.
3. **State:** public, restricted, pending-review, verified-local, pilot-target, not-live, fixture, mismatch, and unknown meanings remain distinct without color.
4. **Phone:** at 320 CSS pixels and 390 × 844 in EN and HR, there is no body overflow, clipping, covered action, missing label, or target below `2.75rem`.
5. **Keyboard:** all actions, stage navigation, language switching, review, verifier states, dialogs, and fullscreen fallback work with visible focus and predictable order.
6. **Reduced motion:** the same record, boundary, gate, result, and receipt appear immediately with no animated or smooth-scrolling dependency.
7. **Print:** the affected public record and presentation print with source, status, disclosure, language, provenance, and privacy boundaries intact.
8. **Proof language:** a verifier match states the mechanism and local or provider scope and says that proof does not establish truth.
9. **Bilingual:** EN and HR preserve meaning and structure; no critical text truncates; the document language changes correctly.
10. **Provenance:** fixtures, local-only mechanisms, pilot targets, external stubs, and not-live surfaces cannot be mistaken for a real deployment or outcome.

## Design do / don’t

### Do

- Start with the unanswered record and follow it to a public receipt.
- Keep responsibility, private boundaries, reviewer authority, evidence scope, and product limits visible.
- Reuse the frontmatter tokens and established shared components before adding a pattern.
- Preserve the trace when the layout compacts; reduce decoration and metadata density first.
- Write exact status and error text that names what happened and what can happen next.

### Don’t

- Turn the trace into a decorative progress stepper, timeline wallpaper, or brand flourish.
- Publish a private narrative, identity, resident document, or restricted audit detail.
- Let an official self-declare publication or terminal follow-through.
- Call a byte match true, verified by default, immutable, live, deployed, approved, or partnered.
- Use a generic hero, dashboard mosaic, stock photo, glass card, gradient glow, or monochrome terminal page as the production identity.

## Subsystem design extensions

- HyperFrames and media may extend this contract at `hyperframes/docs/DESIGN.md`.
- App-specific files may define route layout and component composition but must use this meaning model, trace topology, token roles, privacy boundary, and accessibility gates.
- Documentation and marketing may simplify technical depth but may not weaken capability, provenance, pilot-target, proof, or not-live labels.

## Agent instructions

Before changing product UI, visual assets, product copy, documentation presentation, marketing pages, or media:

1. Read this file and the applicable subsystem design file.
2. Treat Trace line as the locked upstream direction.
3. Reuse existing semantic components and tokens; do not create a second convention beside them.
4. Keep disclosure, workflow, verification, capability, and deployment meanings separate.
5. Test the affected phone, keyboard, reduced-motion, print, language, provenance, and privacy contracts.
6. Update this file only for an intentional project-wide design decision authorized by the user.
7. Record design-impacting changes in the task, review, PR, commit, or handoff notes.
