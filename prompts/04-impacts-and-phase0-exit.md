# Prompt 04: Impacts, slack/taut, Zeno handling, terminal events, CLI (Phase 0 exit)

> Phase 0 · depends on 03 · high effort · plan mode first

## Context
Read `CLAUDE.md`, DESIGN §1.2 items 7–8, §3.5, §3.6 and §9 (Phase 0 exit), the engine README and PROGRESS.md. After this prompt the engine handles the full slice problem: a hanging load hits the floor, the string goes slack, and the block slides to a stop.

## Goal
Velocity jumps (impacts), re-tensioning of strings, Zeno handling, terminal geometric events with messages, an honest diagnostic for unsupported body–body contact, a table-driven regression harness, and a small CLI for inspecting runs. Then verify the Phase 0 exit criterion.

## Build
### 1. Impact solver (`src/sim/impact.ts`)
- **Trigger:** `touchdown` (a contact gap closing) or `taut` (an inactive string's gap closing) with a closing rate below −εvel.
- **Velocity-level problem:** `M·Δv = J_Cᵀ·Λ`.
  - The set C contains the closing constraints, all currently active unilateral constraints (taut strings and resting contacts), and any bilateral ones.
  - For each unilateral i in C the Newton restitution law applies:
    - `post_rate_i + e_i·min(pre_rate_i, 0) ≥ 0`, with `Λ_i ≥ 0`;
    - complementarity between those two.
- Solve by **enumeration**, as mode selection does, and emit a diagnostic for zero or multiple solutions.
- **Restitution:** `e` comes from the pair's material. A string jerking taut uses `e = 0`.
- Impacts are frictionless in Phase 0. Document this in the README and add a follow-up for impulsive friction.
- **Output:** post-impact velocities, impulses per constraint, and the kinetic energy lost. These go into the event's `data` so the UI can say "inelastic impact, 1.96 J lost".
- **After the impact:** constraints with post rate ≈ 0 become resting candidates, then mode selection runs. Remove the `impactNotImplemented` placeholder.
- **This propagates impulses correctly through taut strings.** Example: a load hits the floor while the string is taut. The string must **not** jerk the other block, because a string can't push. The complementarity conditions give that result automatically; test it.

### 2. Zeno handling
- If an impact's closing speed is below `vZeno = 1e-7·V*`, treat the contact as resting: no bounce, straight to mode selection.
- If more than N impacts happen within a window Δt, emit `ZENO_SUSPECTED` and force resting.
- Document both thresholds.

### 3. Terminal geometric events
Each ends the run with an end reason and a diagnostic carrying params, so the UI can say "m₁ reached the pulley at t = 1.43 s":
- `BODY_REACHED_PULLEY`: a string segment between a body and a pulley tangent point has length → 0.
- `STRING_UNWRAPPED`: a wrap angle → 0.
- `STRING_SEGMENT_DEGENERATE`: any other segment → 0.

### 4. Unsupported body–body contact
- Bodies don't collide with each other until Phase 4. Add a guard on the separating-axis gap between every pair of body shapes, using fixed orientations.
- When two bodies would interpenetrate, stop at first touch with the error `BODY_CONTACT_UNSUPPORTED`. **Never let bodies pass through each other silently.**
- Pulleys are not solid for bodies in Phase 0. If a body overlaps a pulley disk, emit the warning `BODY_OVERLAPS_PULLEY`.

### 5. Regression harness (`tests/regression.test.ts`)
- Table-driven from `tests/scenes/engine/*.json` plus `expected.json`.
- Each scene file may contain an `"expect"` block mapping an expected key to an extractor. Possible extractors:
  - a probe at a time, or a probe constant over a phase;
  - a query hit time or value;
  - an event time by kind and id;
  - an end reason;
  - `atRestFrom`.
- The tolerance comes from the class in `expected.json` (`exact` → 1e-9 relative, `ode` → 1e-7 relative). Use an absolute floor of 1e-12 for values near zero.
- A failure message prints the expected value, the actual value, the relative error and the scene id.

### 6. CLI for humans (`packages/engine/scripts/sim.ts`, run with `tsx`)
`pnpm --filter @mech/engine sim <scene.json> [--csv out.csv] [--html out.html] [--probes ...]`
- **Console output:** a phase table (t₀, t₁, mode description, uniform?, constant a and λ values), the event log, diagnostics, stats and wall time.
- `--csv`: sampled probes.
- `--html`: one standalone file, no dependencies, with inline SVG line plots of the chosen probes over time, vertical event lines and a phase legend. This is the Phase 0 demo artifact.

### 7. Scenes to add
`t03_load_hits_floor`, `t19c_bouncing_block`, `x04_slides_off_table`, plus one scene that triggers each of `BODY_REACHED_PULLEY` and `BODY_CONTACT_UNSUPPORTED`.

## Tests (all through the harness, plus unit tests for the impact solver)
- **t03, the full slice:**
  - phase 1 has a = 1.96 and T = 15.68;
  - the `touchdown` of m₂ happens at 0.714285… with impact speed 1.4 and e = 0;
  - the string goes slack at the same instant;
  - A decelerates at μg and sticks at 1.428571…;
  - A's total path is 1.000;
  - T = 0 in phase 2;
  - m₁ receives no impulse at the impact.
- **x04:** the block leaves the table when its trailing edge passes the edge; the fall time is 0.404061…; the landing x matches; afterwards it slides at 2.0 m/s.
- **t19c:** the block comes to rest within 1e-6 s of 4.06578…; the run terminates, `ZENO_SUSPECTED` or a clean rest; no `EVENT_LIMIT`.
- **Phase 0 scenes:** t01, t02a–c, t14, x01–x03 still pass.
- **Impact solver unit tests:** an elastic and an inelastic 1-D case with a known outcome; an impulse through a taut string (a block hanging from a pulley struck from below); a string can't push; energy is never gained.
- **Fuzz test:** at least 200 random valid scenes built from boxes, supports, one or two pulleys and strings, with a seeded generator. Each one must terminate with a stated `endReason`, never hang, never produce NaN, and keep constraint residuals below 1e-9 in every phase.

## Phase 0 exit check (write the result into PROGRESS.md)
- DESIGN §8 tests 1, 2a–c and 3 pass at 1e-9.
- The extra scenes pass.
- Performance: the full run of each Phase 0 scene, with numbers.
- Open the HTML plot for t03, describe it briefly, and make sure the phases look right.
- List the engine API the app will rely on: `compileModel`, `simulate`, `stateAt`, `forcesAt`, `probeValue`, `sampleProbe`, `stringGeometry`, diagnostics codes.

## Definition of done
- [ ] Tests (including regression and fuzz), typecheck and lint are green.
- [ ] README updated: impacts, Zeno thresholds, terminal events, diagnostic codes table, CLI usage.
- [ ] PROGRESS.md: Phase 0 marked complete, with the exit-check results.
- [ ] Commit: `feat(engine): impacts, slack/taut, Zeno handling, terminal events, regression harness, CLI (Phase 0 exit)`
