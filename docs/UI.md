# UI guide: modern, minimalist, textbook line art

**Direction.** A calm, precise instrument. The canvas looks like a clean textbook drawing: thin ink strokes, hatched fixed supports, italic math symbols. The chrome around it is quiet, floating panels in the style of current design tools. Color is reserved for meaning (forces, selection, state) and never used for decoration.

## 1. Principles
1. **The canvas is the hero.** The canvas is full-bleed and everything else floats over it. Panels can collapse.
2. **One accent color** for selection, focus, the primary action and the playhead. Everything else is neutral.
3. **Semantic color only for physics.** Every kind of force has a fixed color, used identically on the canvas, in readouts and in graphs.
4. **Numbers are first-class.** Use tabular figures, a units suffix in muted text, and the user's chosen number of significant figures. Values must never jitter in width.
5. **Quiet motion.** 120–160 ms ease-out transitions on hover, press and panels. Nothing bounces. Honor `prefers-reduced-motion`.
6. **Keyboard-first and discoverable.** Every tool and action has a shortcut that is shown in its tooltip.

## 2. Layout
```
┌────────────────────────────────────────────────────────────────────────┐
│ [≡ Title ▾]        [ V  H │ S  B  P  L … ]  (floating tool pill)  [status][⤴][⚙][◐] │
│ ┌─ Задача ─────┐                                         ┌─ Inspector ─┐ │
│ │ Условие      │                                         │ contextual  │ │
│ │ Дано         │            full-bleed SVG canvas        │ fields      │ │
│ │ Найти        │                                         │             │ │
│ │ Допущения    │                                         │             │ │
│ │ События      │                                         └─────────────┘ │
│ └──────────────┘                                                         │
│ ┌─ ▶  ⏮ ◀ ▶ ⏭   t = 0,714 с  1× ─────────[phase bands · event ticks]────┐ │
│ └────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```
- Panels float 12 px from the window edges.
  - Left panel: 288 px wide, collapsible with `[`.
  - Right inspector: 280 px wide, collapsible with `]`. With nothing selected it shows scene settings.
  - Timeline: 56 px tall, docked bottom between the side panels.
- Top: the document title sits floating on the left. The tool pill is centered. The status chip and actions (share, settings, theme) sit on the right.
- Below 900 px width, side panels collapse to icon rails (good enough for now; mobile layout comes later).

## 3. Tokens (CSS variables; Tailwind theme maps to them)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F7F5` | `#121314` | canvas "paper" |
| `--panel` | `#FFFFFF` | `#1A1B1D` | panels, popovers |
| `--panel-2` | `#F2F2EF` | `#222326` | inputs, hover, secondary fills |
| `--border` | `#E4E4E0` | `#2C2D31` | panel and input borders, dividers |
| `--border-strong` | `#CFCFCA` | `#3A3B40` | focused/hovered borders |
| `--text` | `#1A1A1A` | `#EDEDEC` | primary text |
| `--text-2` | `#5E5E5A` | `#A9A9A6` | labels, secondary |
| `--text-3` | `#8C8C87` | `#7C7C79` | units, hints, disabled |
| `--accent` | `#2F5BEA` | `#7A96FF` | selection, focus, primary, playhead |
| `--accent-soft` | `rgb(47 91 234 / .12)` | `rgb(122 150 255 / .16)` | selection halo, active tool background |
| `--danger` | `#D14343` | `#F06A6A` | errors |
| `--warning` | `#B7791F` | `#E0A84A` | warnings |
| `--success` | `#2E8B57` | `#4CC38A` | "matches" states |
| `--ink` | `#1A1A1A` | `#E6E6E3` | canvas strokes |
| `--body-fill` | `#FFFFFF` | `#26272A` | bodies, pulleys |
| `--grid-minor` | `rgb(26 26 26 / .05)` | `rgb(255 255 255 / .04)` | |
| `--grid-major` | `rgb(26 26 26 / .10)` | `rgb(255 255 255 / .08)` | |

**Force and kinematics colors** (based on the colorblind-safe Okabe–Ito palette). Use the light value on the light theme and the dark value on the dark theme.
| Quantity | Light | Dark |
|---|---|---|
| Gravity (mg) | `#0072B2` | `#5AA9E6` |
| Normal force (N) | `#009E73` | `#3CC59B` |
| Friction (F_тр) | `#D55E00` | `#FF8A3D` |
| Tension (T) | `#CC79A7` | `#E39BC5` |
| Spring (F_упр) | `#E69F00` | `#F2B84B` |
| Applied force (F) | `--ink` | `--ink` |
| Velocity | `--accent`, solid | |
| Acceleration | `--accent`, dashed | |

**Typography**
- UI text: *Inter Variable* (self-hosted).
  - Sizes: 11 (units, captions), 12 (labels, secondary), 13 (base), 14 (panel titles), 16 (document title).
  - Weights: 400, 500, 600.
  - All numbers use `font-variant-numeric: tabular-nums`.
- Math symbols (m₁, T, α, μ, F_тр): **KaTeX_Math italic** (from the `katex` package), so canvas labels match the equations that come later. Canvas labels are 15 px at screen scale and do not scale with zoom.

**Spacing, sizing and elevation**
- Spacing: 4 px grid (4, 8, 12, 16, 24, 32).
- Controls: 28 px tall; icon buttons 28×28; tool pill 40 px tall.
- Radii: 6 px for controls, 10 px for panels and popovers, 999 for chips and pills.
- Shadow (light theme): `0 1px 2px rgb(0 0 0/.04), 0 4px 16px rgb(0 0 0/.06)`.
- Dark theme: border only, plus `0 4px 16px rgb(0 0 0/.35)`.
- No gradients, no glass blur, no colored panel backgrounds.

## 4. Canvas drawing language
- All strokes use `vector-effect: non-scaling-stroke`, so widths are in screen pixels.
- **Supports** (table, wall, ceiling, beam): 1.5 px `--ink` outline, filled with 45° hatching at 6 px spacing and 35 % ink.
- **Ground:** a 1.5 px line with a 10 px hatched band below it, spanning the visible width.
- **Blocks:** `--body-fill`, 1.5 px ink outline, corner radius 1 px. The symbol (m₁) sits centered in math italic, or beside the block if it is smaller than 28 px on screen.
- **Pulleys:** ink circle with `--body-fill` and a 3 px axle dot. A bracket or hanger line connects them to their mount.
- **Strings:** 1.25 px ink. They wrap visibly around pulleys as arcs and have 2 px anchor dots. A slack string is drawn with a gentle sag (visual only).
- **Springs** (later): 8-coil zig-zag, 1.25 px ink, with a short straight lead at each end.
- **Vectors:** 2 px line with a filled 8 px arrowhead. The label chip shows symbol and value (`T = 15,7 Н`) in the vector's color. One length scale per scene, shared by all forces.
- **Selection:** 2 px accent outline plus a 4 px `--accent-soft` halo. Hover changes the stroke to accent at 60 %.
- **Snap guides:** 1 px accent dashed line plus a small chip ("на поверхности", "по вертикали", "параллельно").
- **Grid:** minor and major lines spaced on a 1–2–5 sequence, with minor lines ≥ 12 px apart. Major lines carry meter labels along the bottom and left edges in `--text-3`. A scale bar sits bottom-left.
- **Hit testing:** every interactive element has a hit area of at least 8 px on screen.
- **During playback:** edit handles are hidden and bodies are drawn at their simulated state. A faint t = 0 ghost can be toggled.

## 5. Components
- **Panel:** header 36 px with title (14/600) and actions. Sections are separated by 1 px dividers and collapsible. Section titles are sentence case at 12/600 in `--text-2`.
- **Inspector row:** label column 96 px (`--text-2`), field fills the rest.
- **NumberField:**
  - The value is right-aligned with the unit suffix inside the field in `--text-3`.
  - Dragging the label horizontally scrubs the value. Arrow keys step it; Shift multiplies the step by 10.
  - Accepts expressions (`2*sqrt(3)`, `m1/2`) and shows the evaluated value.
  - A chain icon links the field to a named parameter.
  - Invalid input gets a `--danger` border and a tooltip.
- **Segmented control** for small enumerations, e.g. g = 9,8 / 9,81 / 10.
- **Switch** for idealization flags. A switch that is locked in the current phase is disabled and its tooltip explains why.
- **Chips** for statuses, units and parameter links.
- **Tooltip:** 12 px text with a shortcut hint on the right in `--text-3`.
- **Toasts:** bottom-center above the timeline, with an undo action where relevant.
- Base everything on shadcn/ui (Radix) and restyle it with these tokens. Do not ship stock shadcn styling unreviewed.

## 6. Timeline
- Controls on the left: play/pause, to-start, previous event, next event, time readout (`t = 0,714 с`), speed menu.
- The scrubber track shows **phase bands** as alternating neutral tints. Hovering a band shows its mode ("нить натянута · m₁ скользит").
- **Event ticks** are shown with small icons by kind. The **playhead** is accent colored.
- At the right end of the track: the horizon and an "extend" control.

## 7. Copy (Russian by default)
Write in sentence case and keep it short: no exclamation marks, no emoji. Use a decimal comma in Russian. Inputs accept both comma and point.

| Concept | RU | EN |
|---|---|---|
| block (body) | брусок / тело | block / body |
| pulley | блок | pulley |
| string | нить | string |
| spring | пружина | spring |
| support (table/wall/ceiling) | опора | support |
| ground | пол | ground |
| incline | наклонная плоскость | incline |
| rod | стержень | rod |
| tension | сила натяжения T | tension T |
| normal force | сила реакции опоры N | normal force N |
| friction | сила трения F_тр | friction F_fr |
| gravity | сила тяжести mg | gravity mg |
| givens / find / assumptions | Дано / Найти / Допущения | Givens / Find / Assumptions |
| problem statement | Условие | Problem |
| event / phase | событие / этап | event / phase |
| measurement (probe) | измерение | probe |
| play / pause / step | пуск / пауза / шаг | play / pause / step |

**Units:** м, с, кг, Н, м/с, м/с², Дж, °.

## 8. Keyboard map
| Shortcut | Action |
|---|---|
| `V` | Select |
| `H` | Hand (or hold Space to pan) |
| `S` | Support |
| `B` | Block |
| `P` | Pulley |
| `L` | String |
| `K` | Spring (later) |
| `I` | Incline (later) |
| `Space` (outside an input) | Play/pause; Space+drag pans |
| `Home` | Go to t = 0 |
| `Shift+←` / `Shift+→` | Previous / next event |
| `←` / `→` | Frame step |
| `F` | Fit to content |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+D` | Duplicate |
| `Del` | Delete |
| `Esc` | Back to Select |
| `[` / `]` | Toggle left / right panel |

## 9. Don'ts
- No second accent color and no colored panel backgrounds.
- No drop shadows or gradients on canvas elements.
- No decorative animation of physics elements. Bodies move only under simulation.
- Never show a number without a unit, or one that the engine flagged as indeterminate.
