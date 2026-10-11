# Prompt 05: App shell, design system, canvas camera and grid

> Phase 1 · depends on 04 (Phase 0 complete) · plan mode first

## Context
Read `CLAUDE.md`, **all of `docs/UI.md`**, DESIGN §6 and §7, and PROGRESS.md. This prompt creates the web app's frame and visual language: an empty but polished canvas you can pan and zoom, with the panels in place. There is no scene editing and no physics yet. The look must be **modern and minimalist**, exactly as UI.md describes: textbook line art on the canvas, quiet floating chrome, one accent color.

## Goal
`apps/web` runs with `pnpm dev`. It shows the full layout, light and dark themes, Russian and English i18n, and an SVG canvas with a meter-based camera, an adaptive grid, a scale bar and the hatched ground. Shortcut and tool infrastructure is in place.

## Build
### 1. Scaffold
- `apps/web` (package `@mech/web`): Vite + React + TypeScript (strict), depending on `@mech/engine` through the workspace (not used yet).
- Tailwind CSS v4 with its theme mapped to the CSS variables from UI.md §3.
- shadcn/ui initialized, with components copied into `src/ui/`: button, tooltip, popover, dropdown-menu, slider, switch, separator, scroll-area, dialog, input, toggle-group. **Restyle them with the tokens.** Stock shadcn styling is not acceptable.
- lucide-react for icons.
- Inter Variable self-hosted (`@fontsource-variable/inter`).
- `katex`: use only its `KaTeX_Math` italic font via `@font-face`, for canvas symbols.

### 2. Themes
- System, light and dark, with a `data-theme` attribute on `<html>`. Persist the choice in localStorage inside try/catch.
- All colors come from the tokens, including the force colors (defined now, used later).

### 3. i18n
- A small typed dictionary module: `t('tools.block')`, with Russian as the default and English as the fallback. A missing key is a type error.
- Seed it with the glossary from UI.md §7.
- A language switch lives in the settings popover.
- Russian number formatting uses a decimal comma. Put the formatter helper in `src/lib/format.ts`; it takes significant figures and a unit.

### 4. Layout (UI.md §2)
- A full-bleed canvas with floating panels:
  - top-left: document title (an inline-editable placeholder);
  - top-center: the tool pill (Select, Hand, then disabled placeholders for Support, Block, Pulley and String, each with a tooltip and shortcut);
  - top-right: status chip placeholder, share (disabled), settings popover (theme, language), theme toggle.
- **Left panel "Задача"** with collapsible empty sections: Условие, Дано, Найти, Допущения, События. Each shows a quiet empty state.
- **Right inspector:** shows "Сцена" settings placeholders when nothing is selected.
- **Bottom timeline bar:** disabled controls and an empty track, styled per UI.md §6.
- `[` and `]` toggle the side panels, with a smooth width/opacity transition.
- Below 900 px the panels collapse to icon rails.

### 5. Canvas (`src/canvas/`)
- **SVG camera** in world units (meters, y up):
  - `{ center: Vec2, pxPerMeter }` with pure functions `worldToScreen` and `screenToWorld`;
  - wheel and trackpad pinch zoom around the cursor (5–5000 px/m);
  - pan with Space+drag, middle mouse, the hand tool, or two-finger trackpad scroll;
  - `F` fits to content (for now the default view: ground plus about 4 m);
  - the camera is kept in a store slice. Camera changes must **not** re-render the panels.
- **Layers** (separate memoized `<g>` groups): grid, scene (empty), overlay (guides and selection, empty).
- **Grid:**
  - minor and major spacing from a 1–2–5 sequence, with minor lines ≥ 12 px apart;
  - major lines labelled in meters along the bottom and left edges (`--text-3`, 11 px);
  - the grid can be toggled in settings.
- **Scale bar** bottom-left inside the canvas ("50 см", "1 м", …).
- **Ground:** at y = 0 with the textbook hatching band spanning the visible width (UI.md §4). Use a pattern with non-scaling strokes.
- **Empty state:** a centered quiet hint ("Добавьте опору (S) или брусок (B), или откройте пример"). Shortcuts are placeholders until prompt 07.

### 6. Tool and shortcut infrastructure
- A tool state machine skeleton: `select`, `hand`, plus disabled placeholders.
- A shortcut registry that is the single source for both handlers and tooltip hints. Shortcuts are disabled while focus is in a text input.
- Global `Esc` returns to Select.

### 7. Quality
- No console errors or warnings in the dev server.
- Visible focus rings using the accent color.
- All icons have tooltips.
- Controls are reachable by keyboard.

## Tests
- **Unit (Vitest):** world↔screen round trip; zoom around a point keeps that world point under the cursor; the grid spacing chooser across zoom levels; number formatting (significant figures, Russian comma, units).
- **Playwright** (set it up now, with `pnpm e2e`): the app loads; switching to dark changes `data-theme`; panels toggle with `[` and `]`; wheel zoom changes the scale bar label. Save screenshots of light and dark to `apps/web/e2e/__screenshots__/` as artifacts. Do not assert pixels.
- **If you have a browser preview tool, open the app** and compare light and dark against UI.md before finishing. Fix spacing, alignment and contrast issues you see.

## Out of scope
The scene model, editing, physics, the worker, real timeline behavior.

## Definition of done
- [ ] `pnpm dev` shows the polished empty app; `pnpm --filter @mech/web build` passes.
- [ ] Tests, e2e, typecheck and lint are green.
- [ ] PROGRESS.md entry with screenshot paths.
- [ ] Commit: `feat(web): app shell, design tokens, i18n, canvas camera and grid`
