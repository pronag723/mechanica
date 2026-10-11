# Prompt 08: String tool

> Phase 1 · depends on 07 · plan mode first

## Context
Read `CLAUDE.md`, `docs/UI.md`, DESIGN §6.3, `packages/scene/README.md` (string route, alignment rule) and PROGRESS.md. Strings are the hardest UX in Phase 1. The tool must make **textbook geometry the default outcome**: segments parallel to faces, hanging segments vertical, no fiddling.

## Goal
With tool **L**, the user can route a string from a block or fixed point, over any number of pulleys, to a block or fixed point, or end it with "hang a weight". Existing strings can be inspected, re-routed and deleted. Bad routes are caught with clear warnings.

## Build
### 1. Routing interaction
1. Activate L. Valid targets highlight on hover:
   - **blocks**, where the anchor defaults to `auto`, i.e. aligned (see 2);
   - **support faces**, where a click creates a fixed anchor (a ceiling hook, for example) at that point;
   - **pulleys.**
2. **Pulley wrap side** is inferred from where the cursor sits relative to the line from the previous route point through the pulley center. Preview the resulting tangent and wrap arc live **before** the click.
3. A rubber band runs from the last point to the cursor with a live length label.
4. Finishing the route:
   - Clicking a block or a fixed point ends the string.
   - **Enter** after a pulley does "hang a weight": it creates a new block hanging below the free tangent point (`placement: hanging`, default length 0.5 m, or snapped so the block clears the ground).
   - `Backspace` removes the last waypoint and `Esc` cancels.
5. While the route is in progress, show a hint chip near the cursor ("кликните блок, брусок или опору · Enter — подвесить груз").

### 2. Alignment
- Segments between a block on a face and a pulley use the resolver's alignment rule: they end up exactly parallel to the face.
- Hanging blocks sit exactly under the tangent point.
- When the resolver reports `ALIGNMENT_IMPOSSIBLE`, the inspector offers a one-click fix: adjust the pulley's `topHeight` to the block's mid-height.

### 3. String inspector
- symbol (T₁);
- length: "натянута" (taut, shows the computed length read-only) or "провисание" with an amount;
- route summary (A → блок 1 (по часовой) → B) with a "Изменить маршрут" button that restarts the tool with the existing waypoints;
- flags "нерастяжимая" and "невесомая", checked and disabled with explanatory tooltips.

### 4. Integrity
- Deleting a block, pulley or support that a string uses deletes the string too, with a toast and undo.
- **Validation diagnostics** (add i18n keys):
  - a string intersecting a block or support: warning `STRING_INTERSECTS_BODY`, using segment–polygon tests;
  - both ends on the same block: error;
  - the same pulley twice in a row: error;
  - a wrap angle ≥ 360°: error.

### 5. Rendering
- 1.25 px ink strings with wrap arcs on pulleys and anchor dots.
- A selected string gets the accent color and shows its waypoint handles.
- Use the engine's `stringGeometry` (via resolved geometry) so the drawing always matches the physics.

## Tests
- **Unit:** the wrap-side inference function, including near-degenerate cursor positions; alignment results (block on a table to a corner pulley gives a horizontal segment, and a hanging block gives a vertical one, both exact to 1e-12); cascade deletes; each validation diagnostic.
- **Playwright, the key test.** Build two scenes **from scratch through the UI only**:
  1. the Atwood machine (a ceiling beam, a hanging pulley, two weights);
  2. the table-and-hanging-mass scene (a table, a block, a corner pulley, "hang a weight").

  For each, compile the document and assert the resulting ModelSpec geometry: segments axis-aligned within 1e-12, and the ends attached as intended. This proves the editor produces textbook geometry by default.
- **If you have a browser tool, route several strings yourself** (including two pulleys with opposite wrap sides) and polish the previews.

## Out of scope
Elastic strings, movable pulleys, simulation.

## Definition of done
- [ ] Tests, e2e, typecheck and lint are green.
- [ ] PROGRESS.md entry.
- [ ] Commit: `feat(web): string tool with pulley wrap preview, hang-a-weight and alignment`
