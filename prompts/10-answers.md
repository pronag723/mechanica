# Prompt 10: Answers (probes, Find, event log, phase summary, assumptions, examples; Phase 1 exit)

> Phase 1 · depends on 09 · plan mode first

## Context
Read `CLAUDE.md`, `docs/UI.md`, DESIGN §4 and §6.5, the engine README (probes, queries, `forcesAt`, `uniform` phases) and PROGRESS.md. A problem asks for a specific quantity, and this prompt makes the answer **visible, exact and easy to find**. It completes Phase 1.

## Goal
- Users attach measurements to any element and read exact values at the playhead.
- Users ask "when …" and "max/min …" questions.
- Users browse the event log and per-phase constant values, and see the scene's idealizations listed as assumptions.
- An examples gallery opens the presets.

## Build
### 1. Measurements ("Найти")
- **Adding a measurement:** "+ Измерение" in the inspector of the selected element, a right-click context menu on canvas elements, or the Find panel's add menu.
- **Available quantities by element:**
  - block: x, y, displacement (along the face for onFace placement), velocity, speed, acceleration, path, kinetic energy;
  - string: tension;
  - block on a face: N, F_тр (with its regime and limit).
- Stored in `doc.find[]` (schema update with a migration test). Compiled to engine `ProbeRef`s through provenance.
- **Find panel row:**
  - symbol and name ("a₁ — ускорение m₁");
  - the live value at the playhead with unit and significant figures, in tabular figures;
  - a tiny inline sparkline over the whole run, with a playhead dot;
  - when the value is constant on the current phase (`uniform`): a "const" chip, and the value is shown as exact;
  - clicking the row selects and highlights the element;
  - the row menu offers remove, copy value, and "график" (disabled until Phase 2).
- **On-canvas value chips:** optional, toggled per measurement, attached near the element and colored like the quantity per UI.md §3.
- **Indeterminate values** (engine `indeterminate`) show "не определено" with a tooltip explaining why. **Never show a number** for them.

### 2. Questions (queries)
- In the Find panel: "Когда [величина] = [значение]" and "Максимум / минимум [величина]".
- These compile to engine queries and recompute the trajectory. Each lists its hits (t and value). Clicking a hit jumps the playhead there.
- Show a clear "не наступает до t = horizon" when there is no hit.

### 3. Event log ("События", left panel)
- A chronological list with icons, times and localized messages built from event kind, params and provenance. Example: "0,714 с · m₂ коснулся пола (неупругий удар, потеряно 1,96 Дж) · нить T₁ провисла".
- Diagnostics appear in the same list, styled distinctly by severity.
- Clicking an entry jumps the playhead there.

### 4. Phase summary
- Clicking a phase band (or the "Сводка этапа" button) opens a popover showing:
  - the time span and mode description;
  - every quantity constant on the phase: the acceleration of each body, the tensions, N, and F_тр with its regime and static limit ("6,70 Н из 9,21 Н");
  - the state at the end of the phase.
- Quantities that are not constant show their range (min to max).

### 5. Assumptions ("Допущения")
- Generated automatically from the document and model. For example:
  - "Тела — материальные точки"
  - "Нить T₁ невесомая и нерастяжимая"
  - "Блоки невесомые, трения в оси нет"
  - "g = 9,8 м/с²"
  - "Удар о пол неупругий (e = 0)"
  - "μ покоя = μ скольжения = 0,2 (опора 1)"
- Clicking an item selects the related element.

### 6. Problem text ("Условие")
An auto-growing textarea at the top of the left panel, stored in `doc.meta.problemText`.

### 7. Examples gallery
- A dialog opened from the title menu ("Примеры") with cards for t01, t02a–c, t03 and t14.
- Each card has an SVG thumbnail rendered from the document, a title and a one-line description.
- Opening an example replaces the document, and the replacement is undoable.
- Each preset comes with its measurements and queries already added, so the answers are visible immediately.

### 8. Formatting
- Significant figures follow the scene setting.
- Russian units; decimal comma in Russian (inputs accept both).
- Values below 1e-12 relative to the scene's force or velocity scale display as 0.

## Phase 1 exit (DESIGN §9)
- **Playwright exit test:**
  - for each preset: open, run, read the values in Find, the phase summary and query hits, and compare them with `expected.json` at the displayed precision;
  - build t03 from scratch through the UI (reuse prompt 08's helpers), add the measurements, and verify the answers: a = 1,96, T = 15,68, impact at 0,7143 с, stop at 1,429 с, path 1,000 м.
- **Manual check, recorded in PROGRESS.md:** "a newcomer builds tests 1–3 in under 2 minutes". Write the exact click path you would give a newcomer, and every rough edge you noticed as a follow-up.

## Tests
- **Unit:** event-message and assumption generators (fixtures); constant-phase detection display; formatting edge cases; `find[]` schema migration.
- **e2e** as described above.

## Out of scope
Graphs and the uPlot panel, force-vector overlays, "check my answer", inclines, springs (all Phase 2).

## Definition of done
- [ ] Tests, e2e (including the Phase 1 exit test), typecheck and lint are green.
- [ ] PROGRESS.md: Phase 1 marked complete with screenshots, the click path, follow-ups, and suggested scope for Phase 2 prompts 11–16 based on what you learned.
- [ ] Commit: `feat(web): measurements, queries, event log, phase summary, assumptions, examples (Phase 1 exit)`
