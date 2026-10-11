# Prompt 07: Editor (palette, placement, snapping, selection, inspector, parameters)

> Phase 1 · depends on 06 · plan mode first

## Context
Read `CLAUDE.md`, `docs/UI.md` (especially §4, §5 and §8), DESIGN §6.2, §6.4 and §6.6, `packages/scene/README.md` and PROGRESS.md. Users can now **build scenes freely** from supports, blocks and pulleys, and edit every parameter. Strings come in prompt 08.

## Goal
A pleasant, precise editor. Place elements from the tool pill with smart snapping, select and move them while relations stay intact, and edit everything in a contextual inspector. Any numeric field can be linked to a named parameter in "Дано".

## Build
### 1. Tools in the pill
Select (V), Hand (H), Support (S), Block (B), Pulley (P), and String (L, a disabled placeholder until 08). Custom SVG icons for support, block and pulley, in lucide's style (24 grid, 1.5 px stroke).

### 2. Placement (all writes go through store actions, so undo works)
- **Support:**
  - Drag out a rectangle, snapped to the current grid step (Shift turns snapping off).
  - A single click places a default 1.2 × 0.8 m table standing on the ground.
  - Supports snap their bottom to y = 0 and to the edges of other supports.
- **Block:**
  - A ghost follows the cursor.
  - Within 24 px of a horizontal top face (a support or the ground), the ghost snaps onto it and placement becomes `onFace`. Otherwise it is `free` (it will fall).
  - Defaults: 0.3 × 0.2 m, 1 kg, with an automatic symbol.
- **Pulley:**
  - Snaps to support top corners (`mount: corner`) and to bottom faces (`mount: face`, hanging), with a preview of the bracket or hanger. Otherwise free.
  - The default radius is 0.05 m. The default `topHeight` is half the default block height, so a default block's string runs horizontally.
- **Snap guides:** accent dashed lines plus a chip ("на поверхности", "угол", "по вертикали"), per UI.md.

### 3. Selection and manipulation
- Click to select, Shift-click to add, drag a marquee. Hover highlights.
- `Del` deletes, cascading to dependent elements (a hanging pulley goes with its support). A toast offers undo.
- `Ctrl+D` duplicates. Arrow keys nudge by the grid step (Shift ×10).
- **Dragging:**
  - A block that is `onFace` slides along its face (changing `s`, clamped to the face). Pulling it more than 24 px away from the face detaches it to `free`.
  - Supports move freely with snapping. Their dependents (mounted pulleys, blocks on their faces) follow, because they are relational.
- A drag is **one** history entry.

### 4. Inspector (right panel, UI.md §5)
- **Block:**
  - symbol, mass, width, height;
  - position: "расстояние от края" for onFace placement, x and y for free placement;
  - initial velocity: along the face, or vx/vy;
  - a read-only "трение — см. опору" link that selects the host;
  - the flag "материальная точка", checked and disabled, with the tooltip "вращение тел появится позже".
- **Support:** size and position; μ, with a "μ покоя ≠ μ скольжения" switch that reveals μs and μk; restitution e in an "Дополнительно" section.
- **Pulley:** radius; mount (corner / face / free) with its offsets; the flags "невесомый, без трения", checked and disabled ("массивный блок — в следующей версии").
- **Ground:** μ, e.
- **Scene (nothing selected):** title; g as a segmented control (9,8 / 9,81 / 10 / other); duration (horizon); significant figures.
- **NumberField** (build it carefully; it is used everywhere later):
  - label drag-to-scrub;
  - arrow keys step the value, Shift ×10;
  - the unit suffix inside the field;
  - expression entry, with the evaluated value shown;
  - an error state with a tooltip;
  - a chain button to link the field to a parameter (pick one, or "создать параметр", which moves the current value into a new parameter);
  - a linked field shows the parameter chip and edits the parameter.

### 5. "Дано" section (left panel)
A list of parameters. Each row shows the symbol, an editable value with its unit, and a slider with editable min and max. A menu allows rename and delete; deleting a parameter in use asks to inline its value. Slider drags coalesce in history.

### 6. Diagnostics feedback
Resolver and compiler diagnostics show as small warning or error badges on the elements involved. The inspector lists them with localized messages; add an i18n key for each code.

### 7. Canvas labels
Symbols in math italic. Use a simple collision rule so the labels of neighbouring elements don't overlap.

## Tests
- **Unit:** the pure snapping functions (faces, corners, grid, thresholds by zoom); the placement → document mapping; the cascade-delete rules.
- **Playwright:**
  - place a table, put a block on it, put a pulley on the corner, change the mass in the inspector;
  - link the mass to a new parameter and move its slider;
  - undo and redo through all of it;
  - drag a block along the face, then detach it.

  Save screenshots in light and dark.
- **If you have a browser tool, use the editor yourself** and polish the details (hover states, cursor shapes, guide labels, alignment) against UI.md.

## Out of scope
Strings, simulation, probes, inclines, springs.

## Definition of done
- [ ] Every interaction above works and is undoable; nothing logs errors.
- [ ] Tests, e2e, typecheck and lint are green.
- [ ] PROGRESS.md entry with screenshots.
- [ ] Commit: `feat(web): editor (placement, snapping, selection, inspector, parameters)`
