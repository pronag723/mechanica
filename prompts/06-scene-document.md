# Prompt 06: Scene document, expressions, layout resolver, compiler, store and sharing

> Phase 1 · depends on 05 · plan mode first

## Context
Read `CLAUDE.md`, DESIGN §1.2 items 3 and 9, and §6.1 (the relational model, a key decision), the engine README (ModelSpec, diagnostics) and PROGRESS.md. This prompt creates `packages/scene`, which defines **what the user edits, saves and shares**. It also creates the app's document store, and renders documents read-only on the canvas. Editing tools come in prompt 07.

**This is a free-form sandbox.** The schema describes general elements and relations, never scenarios. Any number of supports, blocks, pulleys and strings in any arrangement must be representable. Something valid in the schema but unsupported by the engine becomes a diagnostic.

## Goal
A versioned, zod-validated relational document. The resolver turns it into exact world geometry; the compiler turns that into an engine `ModelSpec` with provenance. On the app side: a store with undo/redo, autosave, URL sharing and read-only rendering.

## Build
### 1. `packages/scene` (named `@mech/scene`; depends on `@mech/engine` and `zod` only)
**Document v1 (`schemaVersion: 1`).** IDs are short and stable. Generate them with an injectable generator so tests are deterministic.
- `meta`: `{ title, problemText }`.
- `settings`: `{ g /* m/s², default 9.8 */, horizon /* s, default 10 */, sigFigs /* default 4 */ }`.
- `parameters[]` ("Дано"): `{ id, name /* identifier like m1 */, symbol /* display, e.g. "m₁" */, value, unit, min, max, step }`.
- **Numeric fields** are `NumOrExpr = number | { expr: string }`. Expressions may reference parameter names.
- `ground`: `{ material }`. It always exists; its surface is y = 0.
- `supports[]`: `{ id, kind: 'box', x, y, w, h, material }`. Axis-aligned rectangles cover a table, wall, ceiling beam or shelf. Phase 2 adds inclines.
- `blocks[]`: `{ id, symbol?, mass, w, h, placement, v0 }`, where `placement` is one of:
  - `{ kind: 'free', x, y }`: may start in the air;
  - `{ kind: 'onFace', host: supportId | 'ground', face: 'top', s }`: s is the distance from the face's start to the block's center; the block's bottom lies exactly on the face;
  - `{ kind: 'hanging', string, end: 'start' | 'end', by: 'length' | 'heightAboveGround', value }`: straight below the string's last tangent point.

  `v0` is `{ kind: 'alongFace', value } | { kind: 'xy', vx, vy }`.
- `pulleys[]`: `{ id, radius, mount }`, where `mount` is one of:
  - `{ kind: 'free', x, y }`;
  - `{ kind: 'corner', host, corner: 'topLeft' | 'topRight', topHeight }`: the pulley sits just outside the corner, with its top tangent `topHeight` above the face, so the string from a block on that face runs horizontally;
  - `{ kind: 'face', host, face: 'bottom', s, hanger }`: hangs from a ceiling or beam.
- `strings[]`: `{ id, symbol?, route, length: { kind: 'taut' } | { kind: 'slack', by } }`.
  - Ends: `{ kind: 'block', block, anchor: 'auto' | { face, s } }` or `{ kind: 'fixed', host, face, s }`.
  - Vias: `{ kind: 'pulley', pulley, wrap: 'cw' | 'ccw' }`.
- `materials`: support and ground materials carry `{ mu, muS?, muK?, restitution }`. `mu` sets both μs and μk unless they are split.
- `find[]`: reserved for probes and queries (prompt 10). Validate it as an empty array for now.

**Expressions (`expr.ts`):**
- A small safe parser (no `eval`): numbers (decimal comma or point), `+ − * / ^`, unary minus, parentheses, parameter names, and `pi`, `sqrt`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `abs`, `min`, `max`.
- **Trigonometric functions take degrees**, the school convention. Document this.
- Errors carry character positions. Cycles between parameters are reported.

**Layout resolver (`resolve.ts`):**
- Walk a dependency DAG: parameters → supports → pulleys (mounted on supports) → strings and blocks (hanging blocks depend on string geometry).
- Produce world geometry: support polygons, block positions (bottoms exactly on faces), pulley centers and string routes.
- **Alignment rule (textbook geometry):** when a string connects a block on a face (anchor `'auto'`) to a pulley, choose the anchor point on the block's side face at the height of the pulley's tangent point. The segment is then exactly parallel to the face, to 1e-12. Hanging blocks sit exactly below the tangent point, so the segment is exactly vertical. If the alignment is impossible (the tangent height falls outside the block's side face), emit the warning `ALIGNMENT_IMPOSSIBLE` with a suggested fix.
- **Diagnostics:** cycles, missing references, overlapping bodies and supports at t = 0, and blocks on faces wider than the face.

**Compiler (`compile.ts`):**
- Takes the resolved geometry and produces `ModelSpec`, plus `provenance: modelId → docElementId` and resolved symbols.
- Symbols are assigned automatically (m₁, m₂ … in creation order; T₁, T₂ … for strings) unless the user set one.
- The output is valid input for `compileModel` in the engine. Diagnostics are merged.

**Migrations:** `migrate(unknownDoc) → DocV1`, with a version switch (only v1 now) and tests.

### 2. App store (`apps/web/src/store/`)
- Zustand plus Immer patches.
  - `doc`, the history (undo/redo with **coalescing**: continuous drags or slider moves become one entry), and `selection` (not stored in history).
  - Derived values are memoized: `resolved` and `compiled` (ModelSpec + diagnostics).
- Autosave to localStorage, debounced and wrapped in try/catch. On startup, load the URL hash, then the autosave, then an empty document.
- **Share:** doc → JSON → `CompressionStream('deflate-raw')` → base64url → `#s=…`. Decode on load. Warn if the hash exceeds 8 KB. The share button copies the link and shows a toast.

### 3. Read-only rendering
Draw ground, supports, blocks, pulleys (with brackets and hangers) and strings (straight segments plus wrap arcs) from the resolved geometry. Follow UI.md §4 exactly: hatching, stroke widths, math-italic symbols.

### 4. Presets
- Document versions of `t01_atwood`, `t02a/b/c`, `t03_load_hits_floor` and `t14_two_strings` in `tests/scenes/doc/`.
- The app gets an "Open example" menu item (a simple list for now; the gallery comes in prompt 10).

## Tests
- **Schema:** round trip, invalid documents rejected with readable paths, migration.
- **Expressions:** precedence, degrees, unknown names, cycles, decimal comma, error positions.
- **Resolver:**
  - changing a parameter (block height, table height, pulley radius) keeps every relation exact: still on the face, horizontal segment, vertical hanging segment;
  - moving a support moves its mounted pulley and hanging block;
  - `ALIGNMENT_IMPOSSIBLE` is produced when appropriate.
- **Equivalence (key test):** compile each document preset, run `simulate`, and get the same values from `expected.json` as the engine-level scenes, at 1e-9.
- **Store:** undo/redo, coalescing, selection outside history.
- **Sharing:** URL encode/decode round trip.

## Out of scope
Editing tools, the string tool, simulation in the UI, probes.

## Definition of done
- [ ] All tests are green, including the equivalence suite; typecheck and lint are green.
- [ ] Presets render correctly in both themes (take screenshots if you have a browser tool).
- [ ] `packages/scene/README.md` documents the schema, relations, alignment rule and expression language.
- [ ] PROGRESS.md entry.
- [ ] Commit: `feat(scene): relational document, expressions, resolver, compiler; web store, undo, sharing`
