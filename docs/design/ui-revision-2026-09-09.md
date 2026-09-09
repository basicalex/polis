# UI revision 2026-09-09: Croatian first, hierarchy, landing, footer

User review of the 2026-09-08 campaign (see `ui-audit-2026-09-08.md`) on the
running site. Findings and decisions below are the contract for this pass.
Rule codes cite `ui-playbook-checklist.md`. DESIGN.md is updated where a
decision changes it; the light civic world, Trace line, meaning model, and
privacy rules do not change.

## Findings

- V1 The site is English first. Croatian lives under `/hr/` and the local
  chrome (banner, nav, footer) has no Croatian at all.
- V2 Everything on the landing has the same weight: the loop row and the six
  demo rows read as one list. The page is a demo launcher, not a landing (H1, H2).
- V3 Page titles are too small for their role; section titles are uppercase
  eyebrows, so the page has one level, not three (H1, T2).
- V4 Content runs nearly edge to edge on wide screens (`.site-main` is 94rem
  in the local world, 92rem public). Header and footer content do not align
  with the page column (L1, L4, L8).
- V5 The footer is one muted line. It carries no navigation, no description,
  no language switch, and looks unfinished (S4, K2).
- V6 The interactive demonstration is the first thing the visitor meets.
  What Polis is, for whom, and why it can be trusted are not on the page.

## Decisions

- R1 Croatian is the default. `/` and `/presentation` serve Croatian.
  English moves to `/en/` and `/en/presentation`. `/hr/` and `/hr/presentation`
  return 301 to the Croatian root routes. Every page that has both languages
  carries `<link rel="alternate" hreflang>` for both plus `x-default` to `/`.
  The demo store's default language is `hr`. The site chrome (banner, skip
  link, nav labels and notes, footer) is localized in both worlds from one
  typed content source, `apps/web/src/content/chrome.ts`. Local internal
  tooling pages whose content is English only keep `lang="en"` and English
  chrome; nothing mixes languages inside one page.
- R2 One page column. `.site-main` is `width: min(72rem, 100%)` with
  `padding-inline: clamp(1.25rem, 6vw, 4rem)`. Header and footer content
  sit inside a `.site-container` with the same measure, so the brand, the
  page column, and the footer columns share left and right edges. Prose keeps
  68ch inside the column; evidence compositions may still reach 74rem by
  opting out with `.site-main--wide` (demo shell and pilot only).
- R3 Type scale. `--type-heading-lg: clamp(2.25rem, 1.5rem + 3vw, 3.75rem)`,
  new `--type-heading-md: clamp(1.75rem, 1.3rem + 1.6vw, 2.5rem)`,
  `--type-heading-sm: clamp(1.375rem, 1.15rem + 1vw, 1.875rem)`. Page `h1`
  uses lg, section `h2` uses md, `h3` uses sm. Section titles on public
  surfaces are serif headings, not uppercase eyebrows; the eyebrow style
  survives only as an optional kicker above a heading.
- R4 Landing structure, in this order, Croatian first with an English mirror
  of identical structure:
  1. Opening. Kicker, `h1` that says what Polis is for residents and their
     municipality, one lede, one primary button that jumps to "how it works",
     and one secondary link to the demonstration. Beside or below it, one
     static synthetic record trace (five stages in the locked engraved
     timeline material, with the fixture label) as the only visual. No demo
     entry rows above the fold. No photo, no gradient, no slogan wall.
  2. For whom. Two short columns: residents, municipalities.
  3. How it works. The five stages, each with a title and one sentence of
     what happens and who does it.
  4. Why it can be trusted. Independent review, the public receipt, open
     source under AGPL, the privacy boundary. Short items, no hashes.
  5. For municipalities. What a pilot involves, in two or three sentences,
     with links to the presentation and the source. No real municipality is
     named.
  6. Demonstration. The six entry rows as they are, under a real heading,
     with the "stays in this browser" note.
- R5 Footer, both worlds. Brand and one-sentence description; three link
  columns (product: demonstration, presentation, public record; trust:
  transparency, methodology, privacy, security; source: source code,
  documentation, licence); the language switch; a bottom row with the
  boundary labels (public) or the version line (local). Columns collapse to
  one on phones.

## Ownership for this pass

- Agent A (chrome and language): `Base.astro`, `styles/chrome.css`, new
  `content/chrome.ts`, `pages/index.astro`, `pages/presentation.astro`,
  `pages/en/*`, `pages/hr/*`, `lib/demo-store.mjs` default language,
  `lib/release-route-policy.mjs`, `middleware.ts`, tests, DESIGN.md language
  and footer lines.
- Agent B (landing, scale, column): `components/PublicLanding.astro`,
  `styles/public.css`, the `landing` block in `content/public-release.ts`,
  `packages/ui/src/styles/base.css`, `styles.css`, DESIGN.md landing and
  scale lines.
- `PublicLanding` keeps its props `{ lang, entryHrefs }`. Agent B must not
  touch pages; Agent A must not touch the landing component or public.css.
