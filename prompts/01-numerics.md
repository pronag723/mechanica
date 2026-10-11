# Prompt 01: Numerical foundations (linear algebra, DOPRI5 with dense output, event location)

> Phase 0 · depends on 00 · high effort · plan mode first

## Context
Read `CLAUDE.md` and DESIGN §3.2 (solve), §3.3 (integrator) and §3.4 (event location). This prompt builds **only generic numerics** in `packages/engine/src/numeric/`. There is no physics yet. Everything later is built on these modules, so correctness and clear APIs matter more than cleverness.

## Goal
Three tested modules:
1. small dense linear algebra;
2. a Dormand–Prince 5(4) integrator with dense output that the caller drives step by step;
3. root finding and event location on the dense output.

## Build
### 1. `numeric/linalg`
- A matrix type: row-major `Float64Array` with `rows` and `cols`, plus small helpers (create, get/set, matVec, matTVec, norms, copy).
- **LU with partial pivoting.**
  - `luFactor(A)` returns `{ lu, piv, singular, minPivotRatio }`.
  - `luSolve(f, b, out)` reuses the factorization for many right-hand sides.
- **Householder QR with column pivoting.**
  - `qrFactor(A)`, `rank(A, tol?)` with a documented default tolerance (`max(m,n)·eps·|R₁₁|`), and `leastSquaresMinNorm(A, b)`.
  - `nullSpace(A)` (needed later for display).
- **Saddle-point systems.** The engine will solve
  ```
  [ M  −Jᵀ ]
  [ J   0  ]
  ```
  where M may contain **zero diagonal entries** (massless elements) while the whole matrix is nonsingular. Make sure LU with partial pivoting handles this. Write tests specifically for it.

### 2. `numeric/dopri5`
- Port Dormand–Prince 5(4) from Hairer & Wanner's `dopri5`, citing it in comments. It needs:
  - the FSAL property;
  - an embedded error estimate with mixed tolerance `atol + rtol·|y|` (scalar or per-component atol);
  - a PI step-size controller (Hairer's β = 0.04, safety 0.9, facmin 0.2, facmax 10);
  - `hmax`, a minimum step that fails with a clear error, and `maxSteps`;
  - Hairer's initial step size heuristic.
- **Dense output:** Hairer's 4th-order continuous extension (the `contd5` coefficients). For each accepted step, store `t0`, `h` and the 5 coefficient vectors.
  - `evalDense(step, t, out)` evaluates at any t inside the step.
  - `evalDenseDerivative(step, t, out)` is optional, but useful for extremum guards.
- **Caller-driven API:**
  - `createDopri5(f, t0, y0, opts)` returns a stepper.
  - `stepper.step()` returns `{ ok: true, step: AcceptedStep } | { ok: false, reason }`.
  - `stepper.restart(t, y)` drops FSAL and resets the step size (with a hint).
  - The hybrid simulator will call `step()`, check guards on the dense output, and possibly restart at an event time with a modified state.
- `f(t, y, dydt)` writes into a preallocated output. Do not allocate inside the stepping loop.
- **No wrong-direction steps:** a `tEnd` option clamps the last step exactly to `tEnd`.

### 3. `numeric/events`
- `findRoot(g, ta, tb, ga, gb, opts)` using Illinois (modified regula falsi) or Brent.
  - Absolute time tolerance `1e-13·max(1,|t|)`, at most 80 iterations.
  - Returns the root and the bracket.
- `locateEvents(step, guards, opts)`:
  - Each guard is `{ id, direction: 'rising' | 'falling' | 'any', armed: boolean, fn(t, yDense) }`.
  - On each accepted step, evaluate armed guards at both ends and at `k` interior points of the dense output (default k = 4) to catch two sign changes inside one step.
  - Find the **earliest** crossing.
  - Return it together with **all** guards that cross within `εt = 1e-12·max(1,|t|)` of it (simultaneous events).
- Guards evaluate only on the dense output. They never call `f` themselves (a guard's own `fn` may do anything it likes).

## Tests (Vitest, in `numeric/*.test.ts`)
Use a seeded PRNG that lives in the test helpers only.
- **LU:** random well-conditioned systems n = 2…60 give residual ≤ 1e-12·‖A‖‖x‖. Singular matrices are flagged. Saddle-point systems with a zero block in M but a nonsingular whole are solved to 1e-12. Repeated solves reuse the factorization.
- **QR:** rank of constructed rank-deficient matrices (including exact duplicate rows, like two identical string constraints); the minimum-norm least-squares solution; the null space is orthonormal and AᴺN ≈ 0.
- **DOPRI5:**
  - `y' = −y` to t = 10 with rtol 1e-10: relative error ≤ 1e-9.
  - Harmonic oscillator over 100 periods: phase error and energy drift < 1e-8.
  - **Constant acceleration** `x'' = a`: x and v are exact to ≤ 1e-13 relative at every dense-output point. This is the property the textbook-exactness promise relies on.
  - Arenstorf orbit (Hairer's classic test, period T = 17.0652165601579625588917206249): it returns to the initial point. Record the achieved error in PROGRESS.md.
  - Dense output at mid-step on `y' = −y` is within 10·rtol.
- **Events:**
  - A projectile `y(t) = h + v₀t − gt²/2` integrated by DOPRI5 hits the ground at the analytic time within 1e-12 relative.
  - Two guards that cross simultaneously (a symmetric case) are reported together.
  - Direction filtering works.
  - A double root inside one step is caught by the interior samples.
  - A disarmed guard never fires.
- **Performance:** 100 oscillator periods take < 50 ms in Node. Log the time and put it in PROGRESS.md.

## Out of scope
Anything physical: bodies, constraints, KKT assembly, modes.

## Definition of done
- [ ] All tests are green; typecheck and lint are green.
- [ ] `packages/engine/README.md` documents the numeric API with short examples.
- [ ] PROGRESS.md has a new entry with performance numbers and the Arenstorf error.
- [ ] Commit: `feat(engine): numerics (LU/QR, DOPRI5 with dense output, event location)`
