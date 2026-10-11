# Prompt 03: Hybrid simulator (phases, guards, mode selection, probes, queries, Trajectory)

> Phase 0 · depends on 02 · high effort · plan mode first

## Context
Read `CLAUDE.md`, DESIGN §1.3, §3.3, §3.4 and §4.1–4.3, and the engine README (numerics, ModelSpec, `solveAccelerations`). This is the heart of the engine: an **event-driven hybrid simulation**. Each phase has a fixed mode and a smooth right-hand side. Every non-smoothness is a located event followed by a new mode selection. Impacts (velocity jumps) are **not** in this prompt; touchdown and re-tensioning are detected but end the run for now (prompt 04 completes them).

## Goal
`simulate(model, opts?) → Trajectory`, plus the sampling, probe and query APIs the app will use.

## Build
### 1. State and scales
- The state is `y = [q, v]`.
- Define scene scales once and use them for every tolerance; document each tolerance: length `L*` (geometry extent), `V* = √(g·L*)`, force `F*` (total weight, or the largest applied force if larger).

### 2. Phase loop (`src/sim/simulate.ts`)
1. **Initialization.**
   - Candidates are unilateral constraints with |gap| ≤ εpos and |gap rate| ≤ εvel.
   - Contacts among them with |v_t| ≤ εvel are friction candidates.
   - Run mode selection (step 3).
   - If the initial velocities violate the active constraints (J_A v ≠ 0), project v in the M-metric and emit `INITIAL_VELOCITY_PROJECTED`, listing what changed.
2. **Integration.**
   - The RHS uses `solveAccelerations` in the phase mode.
   - If all active constraints are `linear`, factor the KKT matrix **once per phase**. Otherwise re-assemble it on every call.
3. **Projection.** After each accepted step, if any active constraint is nonlinear:
   - project q onto `g_A(q) = 0` with mass-weighted Gauss–Newton (≤ 3 iterations, tolerance 1e-12·L*);
   - project v onto `J_A v = 0`;
   - record the projection magnitudes in stats.
4. **Guards** on the step's dense output (prompt 01's `locateEvents`):

   | State | Guard | Event |
   |---|---|---|
   | active unilateral | λᵢ crossing 0 downward | `separation` (contact) or `slack` (string) |
   | inactive unilateral | gap crossing 0 downward | `touchdown` or `taut`; prompt 04 adds the impact, here end with `endReason: 'impactNotImplemented'` |
   | sliding contact | v_t crossing 0 | `stopOrReverse` |
   | sticking contact | λ_t − μs·λ_n or −λ_t − μs·λ_n crossing 0 upward | `breakLoose` |
   | contact validity | support feature leaves the face extent | `leftSurface` (the contact is removed from the candidates) |
   | string geometry | segment length → 0, wrap angle → 0 | `terminal` (prompt 04 adds messages) |
   | user query | see §5 | `query` (mode unchanged) |
   | time | t = horizon | `horizon` |

   λ-based guards evaluate `solveAccelerations` at dense-output states; this is cheap.
5. **At an event:**
   - Integrate exactly to t* and take `y = dense(t*)`.
   - Apply the "snap": set v_t exactly to 0 for stick candidates by velocity projection, and the gap exactly to 0 for new resting contacts.
   - Run mode selection and start a new phase.
   - **Simultaneous events** (all guards within εt) are handled together.
6. **Re-trigger protection.** This is the classic bug: right after lift-off the gap is still 0, and right after sticking v_t is still 0.
   - A guard involved in an event is **disarmed** until its value leaves an ε-band on its allowed side.
   - Alternatively, decide its initial sign from the new mode's derivatives (for example, a positive gap acceleration after lift-off).
   - Document the scheme and test it.
7. **End conditions:** horizon; `NO_CONSISTENT_MODE` (an error, stop); terminal geometry; the `maxEvents` cap (default 10 000, emits `EVENT_LIMIT`, for chatter or Zeno behavior).
8. **At-rest flag.** When all velocities are exactly 0 and the mode's accelerations are 0, record `atRestFrom = t` and let the phase run cheaply to the horizon. Don't end it, because the timeline still needs a span.

### 3. Mode selection (`src/sim/modeSelect.ts`), see DESIGN §3.4
- Write the core over an **abstract problem** (candidate list plus a callback that solves a given mode) so it can be unit-tested with synthetic matrices.
- **Enumerate** in a smart order: current mode, then single flips, then pairs, and so on. For each candidate combination, solve with equalities only, then validate:
  - active ⇒ λ ≥ −εF;
  - inactive ⇒ gap acceleration ≥ −εa;
  - stick ⇒ |λ_t| ≤ μs·λ_n + εF;
  - slipPos/slipNeg ⇒ the tangential acceleration has the slip's sign, with friction = μk·λ_n opposing it.
- **Ties:** prefer stick over slip, and active over inactive. Mark ties as "boundary case" (info diagnostic).
- **No valid mode** → `NO_CONSISTENT_MODE`. **Several valid modes** → `MODE_NOT_UNIQUE` warning naming the rule used.
- More than 10 candidates → `TOO_MANY_CANDIDATES` (a future Lemke solver).

### 4. Trajectory: plain data that survives structured clone, with no classes and no closures
- `phases[]`: `{ index, tStart, tEnd, mode, steps: { t0: Float64Array, h: Float64Array, coeffs: Float64Array /* 5 × dim × nSteps */ }, uniform: boolean }`.
  - `uniform` is true when accelerations and λ are constant to 1e-12 relative, checked at the phase's start, middle and end. It powers "constant on [t₀, t₁]" answers.
- `events[]`: `{ t, kind, ids, phaseBefore, phaseAfter, data }`
- `diagnostics[]`, `endReason`, `atRestFrom?`, `stats { steps, rhsEvals, events, maxProjection, wallMs? }`. `wallMs` is set by the caller, because the engine can't read clocks.
- **Free functions** taking the model and the trajectory:
  - `stateAt(traj, t, side?: 'before' | 'after')`: at an event time the default side is `after`.
  - `phaseAt(traj, t, side?)`
  - `forcesAt(model, traj, t, side?)`: re-solves in the phase's mode and includes the force breakdown.
  - `sampleProbe(model, traj, probe, ts | n)`

### 5. Probes and queries
- **`ProbeRef`** (a union):
  - `bodyPosition {body, component}`, `bodyDisplacement {body, axis?}`, `bodyVelocity`, `bodySpeed`, `bodyAcceleration`, `bodyPathLength`;
  - `kineticEnergy`, `potentialEnergy`, `totalEnergy`;
  - `stringTension {string}`;
  - `contactNormal {contact}`, `contactFriction {contact}` (signed along t) and `contactRegime`.
- **`probeValue(model, traj, probe, t, side?)`**.
- **Path length** must **not** be an ODE state, because |v| is non-smooth.
  - Compute it after the fact from the dense output.
  - Split each step at the zeros of the velocity components, then apply Gauss–Legendre on each sub-interval.
  - Cache cumulative values per step.
- **Queries** are listed in `ModelSpec.queries[]`:
  - `{ id, probe, condition: { kind: 'equals', value, direction? } | { kind: 'max' } | { kind: 'min' } }`.
  - They are implemented as guards. `max` and `min` use the probe's analytic time derivative: for position use velocity; for velocity use acceleration. Other probes report `QUERY_UNSUPPORTED` for max/min in Phase 0.
  - Query hits are listed in `traj.queries[id] = [{ t, value }]` and recorded as `query` events.

## Tests (scenes in `tests/scenes/engine/`, values from `expected.json`)
- **t01:** the query "m₁ displacement = −1 m along y" hits at 1.0101525… s within 1e-9 relative, and the speed there matches. Tension is constant, `uniform` is true, and positions at 50 random dense times match the analytic quadratic within 1e-12.
- **t02b:** a, T, N and F_fr at several times. Choose the horizon so A doesn't reach the pulley.
- **t02c:** stays at rest; F_fr = 9.8; `atRestFrom = 0`.
- **x01:** a `stopOrReverse` event, then stick at t = 1.020408… with path 1.020408…; at rest afterwards with no further events.
- **x02a / x02b:** initial mode selection gives stick (F_fr = −1.5) and slip at t = 0 with a = 1.52, respectively.
- **x03:** a string to a fixed point, i.e. a nonlinear constraint. Check that:
  - the `slack` event occurs at the angle where cos φ = −0.557823…;
  - the speed there is 2.33809… (class `ode`);
  - the constraint residual stays below 1e-10 before the event;
  - after slack the body flies freely until the `taut` guard ends the run with `impactNotImplemented`.
- **Re-trigger:** in x01 and x03 the event counts are exactly as expected. No duplicate events within 1e-9 s.
- **Mode selection** with synthetic cases: unique, none (`NO_CONSISTENT_MODE`), several (`MODE_NOT_UNIQUE`), and a tie exactly at the static-friction limit (applied force = μs·N).
- **Serialization:** `structuredClone(traj)` deep-equals the original, and the sampling functions work on the clone.
- **Determinism:** identical runs give bit-identical trajectories.
- **Performance:** t01 and x01 each run under 20 ms in Node. Log the numbers.

## Out of scope
Impacts and velocity jumps, Zeno handling, terminal-event messages, the CLI, UI.

## Definition of done
- [ ] Tests, typecheck and lint are green.
- [ ] The README documents `simulate`, the Trajectory format, events, probes, queries, the tolerances and the re-trigger scheme.
- [ ] PROGRESS.md entry with performance numbers.
- [ ] Commit: `feat(engine): event-driven hybrid simulator with mode selection, probes and queries`
