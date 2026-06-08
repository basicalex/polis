---
version: "alpha"
name: "Project design system"
description: "Project-level visual and product design contract for coding agents."
colors:
  bg: "#0B0F14"
  surface: "#121923"
  primary: "#38BDF8"
  accent: "#A78BFA"
  text: "#E5E7EB"
  muted: "#9CA3AF"
  success: "#22C55E"
  warning: "#F59E0B"
  danger: "#EF4444"
  on-primary: "#071018"
  on-danger: "#0B0F14"
typography:
  body-md:
    fontFamily: "terminal-default monospace"
    fontSize: "1rem"
    fontWeight: "400"
    lineHeight: "1.5"
  heading-sm:
    fontFamily: "terminal-default monospace"
    fontSize: "1.125rem"
    fontWeight: "700"
    lineHeight: "1.3"
  label:
    fontFamily: "terminal-default monospace"
    fontSize: "0.875rem"
    fontWeight: "600"
    lineHeight: "1.4"
rounded:
  sm: "4px"
  md: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  action-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px"
  action-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-danger}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "8px"
  app-background:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    typography: "{typography.body-md}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "16px"
  caption:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    typography: "{typography.body-md}"
  status-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.bg}"
    typography: "{typography.label}"
  status-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.bg}"
    typography: "{typography.label}"
  status-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg}"
    typography: "{typography.label}"
---

# DESIGN.md

This is the project-wide visual and product design contract for agents and humans. Treat it as the source of truth before making product-facing UI, website, documentation, marketing, or media changes.

> AOC note: this template is AOC-owned and compatible with the Google Labs `design.md` format. Keep the YAML token front matter valid, concise, concrete, and updated when intentional design-system changes are made.

## Product experience

- Product/project:
- Primary audience:
- Primary promise:
- Desired emotional impression:
- Trust/energy level:

## Brand personality

- Voice:
- Mood:
- Keywords:
- Avoid:

## Visual principles

1.
2.
3.

## Layout system

- Density:
- Grid/container rules:
- Spacing scale:
- Responsive behavior:
- Empty/loading/error-state layout rules:

## Color system

| Token | Value | Usage | Notes |
| --- | --- | --- | --- |
| `--color-bg` |  | Page/background |  |
| `--color-surface` |  | Cards/panels |  |
| `--color-primary` |  | Primary CTA/key action |  |
| `--color-accent` |  | Highlights/attention |  |
| `--color-text` |  | Main text |  |
| `--color-muted` |  | Secondary text |  |
| `--color-success` |  | Positive state |  |
| `--color-warning` |  | Attention state |  |
| `--color-danger` |  | Destructive/error state |  |

## Typography

- Primary font:
- Secondary/fallback font:
- Heading style:
- Body style:
- Numeric/metric style:
- Line-height/measure notes:

## Component rules

- Buttons:
- Cards/panels:
- Forms/inputs:
- Navigation:
- Tables/lists:
- Modals/dialogs:
- Notifications/toasts:
- Icons:

## Motion and interaction

- Motion personality:
- Duration range:
- Easing:
- What should animate:
- What should not animate:
- Reduced-motion expectations:

## Imagery and media

- Image style:
- Illustration style:
- Iconography style:
- Screenshot/product-frame treatment:
- Video/animation treatment:

## Content design

- Tone:
- CTA style:
- Terminology:
- Error message style:
- Things to avoid:

## Accessibility requirements

- Contrast:
- Keyboard/focus behavior:
- Reduced motion:
- Captions/alt text:
- Minimum readable sizes:

## Design do / don't

### Do

-

### Don't

-

## Subsystem design extensions

Subsystem-specific design files may extend this document, but should not contradict it.

- HyperFrames/media: `hyperframes/docs/DESIGN.md`
- Web/app-specific extensions:
- Docs/marketing-specific extensions:

## Agent instructions

When changing UI, visual assets, product copy, documentation presentation, marketing pages, or media:

1. Read this file first.
2. Reuse existing components, tokens, and patterns before inventing new ones.
3. Preserve visual consistency unless the user explicitly requests a design-system change.
4. Update this file when making intentional design-system changes.
5. If a subsystem has its own `DESIGN.md`, treat this root file as the upstream contract and the subsystem file as a specialization.
6. Mention design-impacting changes in task notes, PRs, commits, or handoffs.
