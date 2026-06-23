---
version: alpha
name: MarkMind PPTX
description: Editable, deterministic, multilingual slide design system for MarkMind PPTX generation.
colors:
  primary: "#101827"
  secondary: "#6A7485"
  tertiary: "#007294"
  neutral: "#F7FAFC"
  surface: "#FFFFFF"
  surface-alt: "#EAF1F7"
  on-primary: "#F8FBFF"
  on-surface: "#283447"
  accent-secondary: "#6EE7B7"
  border: "#D3DCE8"
  code-bg: "#E8EEF5"
  code-fg: "#172033"
typography:
  display:
    fontFamily: "Noto Sans Display"
    fontSize: 56px
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: 0em
  headline-lg:
    fontFamily: "Noto Sans Display"
    fontSize: 36px
    fontWeight: 700
    lineHeight: 1.16
    letterSpacing: 0em
  headline-md:
    fontFamily: "Noto Sans Display"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0em
  body-lg:
    fontFamily: "Noto Sans"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0em
  body-md:
    fontFamily: "Noto Sans"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0em
  body-sm:
    fontFamily: "Noto Sans"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0em
  label-md:
    fontFamily: "Noto Sans"
    fontSize: 12px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0em
  caption:
    fontFamily: "Noto Sans"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: 0em
  code-md:
    fontFamily: "Noto Sans Mono"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: 0em
  stat:
    fontFamily: "Noto Sans Display"
    fontSize: 64px
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: 0em
rounded:
  none: 0px
  sm: 4px
  md: 8px
  lg: 12px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  slide-margin: 56px
  slide-margin-wide: 72px
  column-gap: 32px
  card-padding: 18px
components:
  slide-cover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.display}"
    rounded: "{rounded.none}"
    padding: "{spacing.xl}"
  slide-content:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.none}"
    padding: "{spacing.slide-margin}"
  slide-section:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.headline-lg}"
    rounded: "{rounded.none}"
    padding: "{spacing.xl}"
  card-column:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.card-padding}"
  stat-callout:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.tertiary}"
    typography: "{typography.stat}"
    rounded: "{rounded.none}"
    padding: "{spacing.md}"
  table-header:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.none}"
    padding: "{spacing.sm}"
  code-block:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.code-fg}"
    typography: "{typography.code-md}"
    rounded: "{rounded.sm}"
    padding: "{spacing.md}"
  image-text-zone:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.headline-md}"
    rounded: "{rounded.none}"
    padding: "{spacing.lg}"
  slide-motif:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
    height: "{spacing.sm}"
  comparison-rail:
    backgroundColor: "{colors.accent-secondary}"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.none}"
    width: "{spacing.xs}"
  divider-line:
    backgroundColor: "{colors.border}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.none}"
    height: "{spacing.xs}"
---

# MarkMind PPTX Design System

## Overview

MarkMind PPTX output should feel like an intentionally designed presentation,
not a Markdown outline pasted onto slides. It is a work-focused desktop export
system for users who need editable, source-faithful, multilingual decks from
Markdown.

The visual identity is structured and calm: cool neutral surfaces, deep ink text,
cyan emphasis, and visible layout containers. It should suit executive briefings,
technical reports, research summaries, lecture decks, and decision documents.

The generation model follows the research direction from PPTAgent,
Presenton, PPT Master, AutoPresent, and DOC2PPT: use the LLM for slide planning,
semantic structure, narration, and image intent; use deterministic renderer code
for design tokens, geometry, contrast, overflow, and editable PowerPoint objects.

## Colors

The palette uses high-contrast neutrals with a single strong accent.

- **Primary (#101827):** deep ink for cover slides, section slides, headlines,
  overlays, and high-contrast text zones.
- **Secondary (#6A7485):** quiet metadata color for section trails, captions,
  slide numbers, and secondary labels.
- **Tertiary (#007294):** deep cyan accent for side rails, emphasis, table headers,
  key stats, and limited calls to attention.
- **Neutral (#F7FAFC):** calm slide background for readable content pages.
- **Surface (#FFFFFF):** cards, table bodies, and contained evidence blocks.
- **Surface Alt (#EAF1F7):** subtle motif strips, low-emphasis panels, and
  non-primary structure.
- **Accent Secondary (#6EE7B7):** secondary rail or comparison accent, used
  sparingly beside tertiary.

Do not flood content slides with saturated accent fills. Accent color should
clarify hierarchy and structure, not decorate.

## Typography

Typography must be free/open, readable, and language-aware. The token defaults
use Noto families; renderer code may substitute per text run. If the user
selects an installed font family in the PPTX export UI, that installed family
takes precedence for headings and body text:

- **Korean:** Pretendard.
- **Japanese:** Noto Sans JP.
- **Simplified Chinese:** Noto Sans SC.
- **Traditional Chinese:** Noto Sans TC.
- **Pan-CJK fallback:** Noto Sans CJK.
- **Latin headings:** Noto Sans Display.
- **Latin body:** Noto Sans.
- **Editorial serif option:** Noto Serif Display / Noto Serif only when
  explicitly selected and appropriate for the script.
- **Code:** Noto Sans Mono.

Use one concrete PowerPoint font name per text run. Do not ask the LLM to output
CSS-style fallback stacks. Avoid serif display fonts for Korean titles unless
the title is Latin-only.

## Layout

Slides use a 16:9 canvas with fixed, renderer-owned geometry. Use clear content
zones and repeatable primitives:

- **Cover:** large title, short subtitle, quiet motif.
- **Section:** one strong section title and optional context line.
- **Content:** title plus compact body in a structured block.
- **Two-column:** two aligned cards with balanced content and thin accent rails.
- **Comparison:** parallel cards with matching labels and balanced density.
- **Stat:** one large number or key phrase with concise context.
- **Quote:** one concise quotation or claim with attribution/context.
- **Image-focus:** image plus safe text zone.
- **Evidence/table:** compact table or data block with summary.
- **Process/timeline:** ordered steps with consistent spacing.

Minimum margin is 0.5 in; preferred slide margin is 0.65-0.9 in. Preferred gaps
between cards or columns are 0.25-0.45 in. Every content slide needs visible
structure beyond title plus loose bullet text.

## Elevation & Depth

Depth is mostly flat and structural. Prefer tonal layers, borders, rails, and
containment over shadows. Content cards should sit on calm neutral backgrounds
with subtle borders and clear internal padding.

Heavy drop shadows, blurred glass panels, and decorative gradients are not part
of the MarkMind PPTX identity.

## Shapes

Shapes are restrained and geometric.

- Cards use small radii, usually 4px equivalent.
- Slide-level frames and rails may be square.
- The deck uses one motif at a time: side rail, corner block, frame, or subtle
  band.
- Motifs must clarify structure. Avoid decorative title underlines and thick
  full-width footer bars.
- Slide numbers are small, quiet, and outside major content zones.

## Components

Use components as semantic PPTX primitives, not UI widgets:

- **slide-cover:** dark primary background, large display title, short subtitle.
- **slide-content:** neutral background, deep text, quiet motif, small page
  number.
- **slide-section:** accent-heavy divider with one message.
- **card-column:** white surface card, thin rail, compact body text.
- **stat-callout:** large tertiary number or key phrase with short context.
- **table-header:** tertiary fill with high-contrast label text.
- **code-block:** muted code background with mono typography.
- **image-text-zone:** primary overlay or side zone that protects readability on
  image-focus slides.

All output must remain editable PowerPoint: text boxes, shapes, tables, charts,
and image objects. Never flatten a complete slide into one generated image.

## Do's and Don'ts

- Do preserve source facts. Never invent numbers, dates, citations, outcomes, or
  claims.
- Do let the LLM choose slide role, layout enum, semantic blocks, speaker notes,
  source paths, and optional image intent.
- Do let MarkMind renderer own colors, typography, coordinates, dimensions,
  motif objects, overflow behavior, and final artifact cleanup.
- Do honor a user-selected installed font family for PPTX headings and body text
  when one is provided.
- Do hide implementation artifacts: `(root)`, source IDs such as S1/S2, hidden
  draft markers, raw JSON fields, renderer notes, and design-token names.
- Do use stock/logo providers for real-world subjects and image generation for
  abstract or custom concept visuals.
- Don't shrink body text until it is unreadable. Split, summarize, or choose a
  denser layout instead.
- Don't use decorative underlines, thick footer bars, random gradients, or
  slide-wide saturated accent washes behind body text.
- Don't put draft review comments into PPTX slide content unless explicitly
  requested.
