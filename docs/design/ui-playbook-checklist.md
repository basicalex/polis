# UI playbook checklist

Distilled from the uxpeak "UI/UX Playbook" (144 pages). This is the rule set
the Polis web UI is audited and built against. Each rule has a code so audits,
packets, and reviews can cite it.

## Hierarchy and grouping

- H1 Rank content before styling. List what the screen must show, order it by
  what the reader needs first, then use size, weight, color, and position to
  match that order.
- H2 One primary action per view. Primary = filled brand color. Secondary =
  neutral fill or outline. Tertiary/destructive-lite = text link. Never three
  equally loud buttons.
- H3 Values louder than labels. In metric tiles and label:value rows, the value
  gets the larger size and darker color, the label gets small, muted text.
- H4 Headings darker than body. Heading near-black, body mid-gray. Never gray
  heading over black body.
- H5 Do not present everything as uniform label:value rows. Use weight, size,
  and icons so the page can be scanned.
- H6 Proximity: gap between a label and its own field (about 8px) must be
  clearly smaller than the gap to the next field group (about 24-32px). Same
  for card sections and list items.
- H7 Chunk long content under subheadings; paragraphs short; at most seven
  items per visual group.

## Clarity and simplicity

- C1 Neither over-simplified (missing context) nor overloaded. Every element on
  a task screen must serve that task.
- C2 Copy states the actual effect ("Select items to remove", not the inverse).
- C3 Expose content directly instead of hiding it behind banners, dropdowns, or
  extra clicks when it fits on screen.
- C4 Show choices visibly (segmented controls, chips, swatches) rather than in
  dropdowns when there are few options.

## Alignment, layout, whitespace

- L1 Left-align body text and lists. Center only titles or short blocks. Right-
  align numbers in tables.
- L2 Build on a grid; one alignment strategy per element type across pages.
- L3 Spacing system on a 4px base (4, 8, 12, 16, 24, 32, 48, 64). No odd values.
- L4 Start with more whitespace than seems needed, then tighten.
- L5 Do not stretch forms or CTAs across a 1440px viewport. Constrain to a box
  with generous space around it.
- L6 Body copy line length 45-75 characters on desktop, 30-40 on mobile.
- L7 Cards in a row share the same height; CTAs align to the card bottom;
  headings and descriptions similar length.
- L8 Order card content by reader priority (image or title first, then
  description, then price/meta, then action).
- L9 Mobile: primary actions inside the thumb zone (lower part of the screen).

## Consistency and harmony

- K1 One corner radius scale used everywhere (images, buttons, inputs, cards).
- K2 One color scheme for buttons across all cards and pages; button color
  never varies to match content.
- K3 Images in a consistent container shape and size.
- K4 One icon set, one style (outlined or filled); mix only to show state
  (selected vs unselected).
- K5 No single element dominates by size; no single color dominates by
  repetition.
- K6 Consistent spacing, type, and sizes for the same component everywhere.

## Contrast, depth, texture

- D1 Text contrast at least 4.5:1 (WCAG AA). No faint text on faint background.
- D2 No pure #000 on #fff or pure #fff on dark. Off-black headings, gray body.
- D3 Text over images needs an overlay or blur so it survives any image.
- D4 Shadows: soft, low-alpha, tinted toward the background hue, never harsh
  gray. Three levels: soft (buttons, small cards), medium (modals), strong
  (dropdowns, alerts). Use shadows on things floating over busy backgrounds.
- D5 Prefer a light neutral page background with white surfaces on top, or thin
  light outlines, to create depth. Do not stack borders and section colors.
- D6 Borders thin (1px) and light. Bold borders only as a deliberate style.
- D7 Glass/blur effects only where they stay readable; never on light-on-light.

## Color

- P1 Primary color reserved for interactive things (buttons, links, active
  states). If everything is highlighted, nothing is.
- P2 Few colors overall; neutral backgrounds (soft white, light gray, or dark).
- P3 Offer dark mode or at least keep the palette token-based so it can be
  added.
- P4 Never state by color alone: success/warning/error get icon + label.
- P5 Status colors follow convention: red error/destructive, green success,
  amber warning. Tune the tone to the brand, not the hue.

## Typography

- T1 One typeface (two at most). Sans-serif for body. Vary weight and size, not
  family. Licensed fonts only.
- T2 Body 16px minimum; nothing under 12px. Line-height 1.5-1.6 for body,
  about 1.2-1.3 for headings; bigger text gets tighter leading.
- T3 Headings bold/semibold/medium; body regular. No thin or extra-light
  weights.
- T4 Heading clearly larger than body. Size is the strongest hierarchy tool.
- T5 Space between paragraphs; subheadings for long sections.

## Interaction cost and forms

- I1 Related actions close together with large enough targets (Fitts).
- I2 Fewer choices per step (Hick); highlight a recommended set.
- I3 Recognition over recall: common icons, phrases, remembered state.
- I4 Remove or merge steps; automate repeated input.
- I5 Field width and type match the data (short fields for codes, dates,
  postal codes; segmented boxes for OTP).
- I6 No confirm-password field; show/hide toggle and inline validation instead.
- I7 Destructive confirmations: red destructive button on the right, Cancel on
  the left, copy says it cannot be undone.
- I8 Form layout can mirror the final output it produces.

## States and navigation

- S1 Empty states: say what this is for, give two or three concrete tips, and
  one CTA. Never a bare "No items".
- S2 Error states: what went wrong, how to fix it, same visual style as the app.
  404 offers links back.
- S3 Navigation dropdowns: icons per item, grouped by category, short
  descriptions; images only on highlighted items.
- S4 Visual cues (icons, avatars, initials, logos) beside list rows so rows
  can be told apart at a glance.

## Bonus

- B1 Two-column feature lists for scannable comparisons.
- B2 Overlapping images need an outline matching the background.
- B3 Task screens (sign-up, checkout) free of unrelated promos; an action-free
  brand graphic is fine.
