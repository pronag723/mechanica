# Prompt 02: Model spec, constraints and the instantaneous solve

> Phase 0 · depends on 01 · high effort · plan mode first

## Context
Read `CLAUDE.md`, DESIGN §1.2 items 4–6, §3.1, §3.2 and §3.6, and the numeric API in `packages/engine/README.md`. This prompt turns a **general** mechanical description into constraint rows and solves the acceleration-level KKT system **for one given mode at one instant**. There is no time integration and no mode selection yet; those come in prompt 03.

**Generality matters.** The engine must work for any number of bodies, supports, pulleys and strings, in any topology the spec allows. Test scenes are only examples.

## Goal
1. An engine input format, `ModelSpec`: plain JSON-serializable data in world coordinates.
2. A compiler from `ModelSpec` to an internal model with degrees of freedom and constraint instances.
3. Exact constraint functions, gradients and curvature terms for strings over fixed pulleys and for body–support contacts.
4. `solveAccelerations()` for a given mode, returning accelerations, multipliers and a force breakdown with provenance.

## Build
### 1. `ModelSpec` (`src/spec.ts`)
This is a sketch; refine it, but keep it serializable and documented.
- `gravity: Vec2`
- `bodies[]`: `{ id, symbol?, mass, shape: { kind: 'box', w, h } | { kind: 'convexPolygon', vertices /* local, CCW */ }, angle /* fixed, rad */, position, velocity }`. Rotation is locked: the angle is constant. Keep the field anyway so rotation can be added later.
- `statics[]`: `{ id, kind: 'halfPlane', point, normal, material } | { id, kind: 'convexPolygon', vertices /* world, CCW */, material }`
- `material: { muS, muK, restitution }`, plus `pairOverrides[]: { a, b, muS?, muK?, restitution? }`. The friction of a body–support pair defaults to the support's material.
- `pulleys[]`: `{ id, center, radius }`. Fixed, massless and frictionless in Phase 0.
- `strings[]`: `{ id, symbol?, route, restLength? }`.
  - `restLength` defaults to the initial geometric length, i.e. taut at t = 0.
  - `route` is `[end, …via, end]`. An end is `{ kind: 'body', body, anchor /* local */ } | { kind: 'fixed', point }`. A via is `{ kind: 'pulley', pulley, wrap: 'cw' | 'ccw' }`.
- `appliedForces[]`: `{ id, body, force: Vec2 }` (constant in Phase 0).
- `options: { horizon, rtol?, atol?, maxEvents? }`

### 2. Compiler (`compileModel(spec) → { model, diagnostics }`)
- **DOF layout:** x and y for each body, kept in a DOF index map that can later grow by θ per body and φ per massive pulley. Mass vector. Iterate in stable id order.
- **Constraint instances, all unilateral in Phase 0.** Each has `value`, `jacobianRow` (sparse), `curvature` (the J̇v plus time terms), a `linear` flag, and `provenance { elementId, kind, symbol }`.
  - **String:** one constraint per string, `g = L₀ − L(q) ≥ 0`. λ is the tension.
  - **Contact candidates:** one per (body, support face) pair, with id `c:<body>:<static>:<faceIndex>`.
    - A face has outward normal n and offset d.
    - `g = n·p − d − h(−n)`, where `h(u) = max over vertices of u·(R·v_local)` is the **support function** of the body's fixed-orientation shape. g is linear in p because the angle is fixed.
    - The tangent is `t = perp(n)`, with its orientation documented.
    - **Validity domain:** the contact exists only while the body's support feature (the support vertex or edge in direction −n) overlaps the face's extent. Half-planes are infinite. A rotation-locked box stays supported until its whole bottom face has left the edge. Expose a function that evaluates the overlap; prompt 03 turns it into a guard.
- **Diagnostics:** `{ code, severity: 'error' | 'warning' | 'info', elementIds, params, message /* English, for developers */ }`. The UI will localize by `code`. Initial codes:
  - `BODY_PENETRATES_STATIC` (gap < −tol at t₀)
  - `STRING_ROUTE_INVALID`
  - `STRING_SEGMENT_DEGENERATE`
  - `PULLEY_WRAP_INVALID`
  - `UNKNOWN_REFERENCE`

### 3. String geometry (`src/constraints/string.ts`), the delicate part
- Tangent constructions:
  - point to point;
  - point to circle, choosing the tangent by wrap side;
  - circle to circle: external tangent for the same wrap side, internal (crossing) tangent for opposite sides;
  - circle to point.
- On each pulley, the wrap angle is measured in its wrap direction from the incoming to the outgoing tangent point, in [0, 2π).
- `L(q) = Σ straight segment lengths + Σ R·wrap angle`.
- **Gradient:** for a body endpoint, `∂L/∂p` is the unit vector of its segment pointing **away** from the neighbouring tangent point. This holds even when R > 0, because the change in wrapped arc cancels the motion of the tangent point; put a short proof in a comment. Since rotation is locked, a constant anchor offset gives the same gradient for the body's (x, y). Then `J = −∂L/∂q`.
- **Curvature:** for every straight segment with at least one moving endpoint, `d/dt(∂L/∂q)·v` contributes `|Δv⊥|²/ℓ`, where Δv is the relative velocity of the endpoints and ⊥ means perpendicular to the segment. Fixed pulleys contribute no endpoint velocity. The sign follows from `g = L₀ − L`; verify it numerically.
- Export `stringGeometry(model, stringId, q)` returning segments and arcs. The UI will draw strings with it, so the drawing matches the physics exactly.
- **Degeneracies:** a segment length below ε, or a wrap angle reaching 0 or 2π, gives a diagnostic. Prompt 04 turns these into terminal events.

### 4. Modes and the instantaneous solve (`src/solve.ts`)
- **Mode:** `{ active: string[] /* constraint ids */, friction: Record<contactId, 'stick' | 'slipPos' | 'slipNeg'> }`. Only active contacts have a friction state. Sorted and serializable.
- **`solveAccelerations(model, mode, t, q, v)`** builds and solves
  ```
  [ M  −J_Aᵀ ] [a]   [ f ]
  [ J_A  0   ] [λ] = [ −curvature ]
  ```
  where f is gravity times mass plus applied forces.
  - **Sliding friction:** replace the contact's column `J_nᵀ` with `(J_n − μk·s·J_t)ᵀ`, where s = +1 for `slipPos` (relative motion along +t, friction along −t). This puts friction into the same multiplier λ_n. Document the convention and test it in both directions.
  - **Static friction:** add the row `J_t a = −(J̇_t v)` with its own multiplier λ_t (signed static friction).
  - Solve with LU on the full augmented matrix (prompt 01 showed it handles zero-mass blocks).
  - **Rank check (DESIGN §3.6):** QR on J_A when it is rank-deficient, emit `STATICALLY_INDETERMINATE` naming the involved constraints. Still return accelerations, plus `indeterminate: string[]` so the UI never shows those λ as exact. If the whole KKT matrix is singular, emit `MOTION_UNDETERMINED`.
- **Output:** `{ a, lambda: Record<id, number>, frictionLambda: Record<contactId, number>, forces: ForceContribution[], diagnostics }`. Each `ForceContribution` is `{ body, kind: 'gravity' | 'normal' | 'friction' | 'tension' | 'applied', sourceId, symbol, vector, point }`. `point` is the application point for drawing: the support point on the face for contacts, the anchor for strings. The breakdown comes from J_iᵀλ_i per body, split into the normal and friction parts of each contact.

### 5. Scenes
In `tests/scenes/engine/`, write ModelSpec JSON for `t01_atwood`, `t02_table` (2a/2b/2c become small overrides applied in the test), `t03_load_hits_floor` and `t14_two_strings`, matching `expected.json`.
- Geometry must be textbook-exact: string segments exactly horizontal or vertical, blocks exactly on their faces (gap = 0). **Assert this in the tests.**

## Tests
- **Finite differences**, central differences with Richardson extrapolation to about 1e-9, for value, gradient and curvature of strings. Random configurations: no pulley; 1 pulley cw/ccw; 2 pulleys with the same side and with opposite sides; R = 0 and R > 0; string body to body; string fixed point to body. Do the same for contact gaps of boxes and convex polygons at several fixed angles.
- **Instantaneous solves** in an explicitly given mode, checked against `expected.json` at relative 1e-12:
  - t01: a and T.
  - t02a/b (slip mode): a, T, N, F_fr.
  - t02c (stick mode): F_fr = mg = 9.8 and T = 9.8, and assert |F_fr| ≤ μs·N.
  - t14: T₃₀ and T₆₀.
- **Indeterminacy:** the same block on three taut strings gives `STATICALLY_INDETERMINATE` with all three ids.
- **Statics sanity:** a block resting on the ground in stick mode has N = mg and a = 0.
- **Determinism:** two identical calls give bit-identical outputs.

## Out of scope
Time integration, events, mode selection, impacts, massive pulleys, springs, UI.

## Definition of done
- [ ] Tests, typecheck and lint are green.
- [ ] The README documents ModelSpec with an annotated example, all sign conventions (n, t, slip direction, meaning of each λ), the constraint interface, `solveAccelerations` and `stringGeometry`.
- [ ] PROGRESS.md entry.
- [ ] Commit: `feat(engine): model spec, string and contact constraints, instantaneous KKT solve`
