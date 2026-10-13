/**
 * One phase of the hybrid simulation: a fixed mode, its KKT solver, its guards and their arming
 * states, and the dense output collected so far.
 *
 * Re-trigger protection (DESIGN §3.4, "the classic bug"): right after an event the quantity that
 * fired is still ≈ 0 (the gap after lift-off, v_t after sticking), and so may be any other guard.
 * 1. The event's state is snapped: positions onto g_A = 0, velocities onto J_A·v = 0 (v_t = 0
 *    exactly for a new stick, the gap 0 for a new resting contact).
 * 2. A guard whose value at the phase start lies within its ε-band is *pending*: it is armed only
 *    from the first sample time (locateEvents' grid) at which it is beyond the band on its home
 *    side. While pending, a mode guard still fires if it crosses the band's far edge (−band on the
 *    home axis): the new mode is then wrong at higher order, and the guard's state is forbidden in
 *    the next mode selection, so the loop cannot repeat. Queries never fire from pending.
 * 3. The direction is also decided by the event itself: the state a guard fired from is forbidden
 *    in the mode selection at that instant (slack ⇒ the string is inactive, stopOrReverse ⇒ not
 *    the old slip direction, breakLoose ⇒ not stick), so the new mode moves away from the boundary.
 * 4. A touchdown guard outside its face's extent (overlap ≤ εpos) is *dormant*: it fires only after
 *    it has been beyond its band on the home side (the body came back above the face plane).
 */
import { contactOverlap } from '../constraints';
import type { Model } from '../model/types';
import type { Mode } from '../mode';
import { type AcceptedStep, evalDense } from '../numeric/dense';
import { type Guard, eventSampleTimes } from '../numeric/events';
import type { QuerySpec } from '../spec';
import { type GuardDef, type QueryContext, buildGuards } from './guards';
import { type PhaseEval, createPhaseEval } from './phase-eval';
import type { PhaseSolver } from './phase-solver';
import { projectPositions, projectVelocities } from './projection';
import { type StepBuilder, createStepBuilder, evalStoredStep, finishSteps } from './steps';
import type { SimTolerances } from './tolerances';
import type { TrajectoryPhase } from './types';

export type GuardStatus = 'armed' | 'pending' | 'dormant';

export interface Phase {
  readonly index: number;
  readonly tStart: number;
  readonly mode: Mode;
  readonly y0: Float64Array;
  readonly solver: PhaseSolver;
  readonly ev: PhaseEval;
  readonly guards: readonly GuardDef[];
  readonly status: GuardStatus[];
  readonly builder: StepBuilder;
}

export function openPhase(
  model: Model,
  index: number,
  t: number,
  y: Float64Array,
  mode: Mode,
  solver: PhaseSolver,
  tol: SimTolerances,
  queries: readonly QuerySpec[],
  qc: QueryContext,
): Phase {
  const ev = createPhaseEval(model, mode, solver);
  const guards = buildGuards(ev, tol, t, y, queries, qc);
  ev.bump();
  const status = guards.map((g): GuardStatus => {
    if (g.kind === 'touchdown') {
      const c = model.constraints[model.constraintIndex.get(g.subject) ?? -1];
      if (c.kind === 'contact' && !(contactOverlap(c, y) > tol.pos)) return 'dormant';
    }
    const v = g.fn(t, y);
    return Math.abs(v) <= g.band ? 'pending' : 'armed';
  });
  return {
    index,
    tStart: t,
    mode,
    y0: Float64Array.from(y),
    solver,
    ev,
    guards,
    status,
    builder: createStepBuilder(y.length),
  };
}

function cleared(g: GuardDef, v: number): boolean {
  return g.home === 0 ? Math.abs(v) > g.band : g.home * v > g.band;
}

/**
 * The locateEvents guard list for one accepted step. Pending and dormant guards are scanned on
 * the sample grid first: one that clears its band at sample τ is armed from τ on (and its status
 * becomes 'armed'); before τ, a pending mode guard watches the far edge of its band instead.
 * `owner[i]` is the index in phase.guards of locate guard i.
 */
export function stepGuards(
  phase: Phase,
  step: AcceptedStep,
  scratch: Float64Array,
): { guards: Guard[]; owner: number[] } {
  const guards: Guard[] = [];
  const owner: number[] = [];
  let times: number[] | null = null;
  const y0 = evalDense(step, step.t0, scratch);
  for (const g of phase.guards) g.refresh?.(step.t0, y0);
  phase.guards.forEach((g, i) => {
    const st = phase.status[i];
    if (st === 'armed') {
      guards.push({ id: g.id, direction: g.direction, armed: true, fn: g.fn });
      owner.push(i);
      return;
    }
    times ??= eventSampleTimes(step);
    let from: number | undefined;
    for (const t of times) {
      if (cleared(g, g.fn(t, evalDense(step, t, scratch)))) {
        from = t;
        break;
      }
    }
    if (st === 'pending' && g.fallback && g.home !== 0) {
      const edge = g.home * g.band;
      guards.push({
        id: g.id,
        direction: g.direction,
        armed: true,
        fn: (t, y) => g.fn(t, y) + edge,
        to: from,
      });
      owner.push(i);
    }
    if (from !== undefined) {
      phase.status[i] = 'armed';
      guards.push({ id: g.id, direction: g.direction, armed: true, fn: g.fn, from });
      owner.push(i);
    }
  });
  return { guards, owner };
}

export interface StepEndProjection {
  /** ‖Δq‖∞ and ‖Δv‖∞ applied (0, 0: nothing changed). */
  readonly dq: number;
  readonly dv: number;
  /** Armed guards that changed sign across the projection jump: events at t1. */
  readonly hits: number[];
}

/**
 * Drift projection at the end of an accepted step of a nonlinear phase (y = the step's end, in
 * place): positions by Gauss–Newton to tol.project, then velocities. A guard sitting at 0 could
 * change sign in the (tiny) jump and be missed by both steps' sign tests, so armed guards are
 * compared before and after: a change of sign is an event at t1.
 */
export function projectStepEnd(
  model: Model,
  phase: Phase,
  t1: number,
  y: Float64Array,
  tol: SimTolerances,
): StepEndProjection {
  const n = model.nDof;
  const before = Float64Array.from(y);
  const q = y.subarray(0, n);
  const pq = projectPositions(model, phase.mode, q, tol.project);
  const pv = projectVelocities(
    model,
    phase.mode,
    q,
    y.subarray(n),
    pq.delta > 0 ? -1 : tol.projectV,
  );
  const hits: number[] = [];
  if (pq.delta === 0 && pv.delta === 0) return { dq: 0, dv: 0, hits };
  phase.guards.forEach((g, i) => {
    if (phase.status[i] !== 'armed' || g.direction === 'any') return;
    phase.ev.bump();
    const a = g.fn(t1, before);
    phase.ev.bump();
    const b = g.fn(t1, y);
    if (g.direction === 'falling' ? a > 0 && b <= 0 : a < 0 && b >= 0) hits.push(i);
  });
  return { dq: pq.delta, dv: pv.delta, hits };
}

/** Closes a phase at tEnd: the stored steps and the uniformity check. */
export function closePhase(phase: Phase, tEnd: number, tol: SimTolerances): TrajectoryPhase {
  const steps = finishSteps(phase.builder);
  const dim = phase.y0.length;
  const y = new Float64Array(dim);
  const at = (t: number): Float64Array => {
    if (steps.t0.length === 0) return phase.y0;
    let k = 0;
    while (k + 1 < steps.t0.length && steps.t0[k + 1] <= t) k++;
    return evalStoredStep(steps, dim, k, t, y);
  };
  return {
    index: phase.index,
    tStart: phase.tStart,
    tEnd,
    mode: phase.mode,
    y0: phase.y0,
    steps,
    uniform: isUniform(phase, [phase.tStart, (phase.tStart + tEnd) / 2, tEnd], at, tol),
    indeterminate: phase.solver.status === 'indeterminate',
  };
}

/** a and the determined λ agree at the given times to tol.uniform (relative to A* and F*). */
function isUniform(
  phase: Phase,
  times: readonly number[],
  at: (t: number) => Float64Array,
  tol: SimTolerances,
): boolean {
  const { solver, ev } = phase;
  const n = solver.layout.nDof;
  let a0: Float64Array | null = null;
  let l0: Float64Array | null = null;
  for (const t of times) {
    ev.bump();
    if (!ev.at(t, at(t))) return false;
    if (!a0 || !l0) {
      a0 = Float64Array.from(solver.a);
      l0 = Float64Array.from(solver.lambda);
      continue;
    }
    for (let i = 0; i < n; i++) {
      if (!(Math.abs(solver.a[i] - a0[i]) <= tol.uniform * Math.max(Math.abs(a0[i]), tol.accScale)))
        return false;
    }
    for (let j = 0; j < l0.length; j++) {
      if (!solver.determined[j]) continue;
      const scale = Math.max(Math.abs(l0[j]), tol.scales.force);
      if (!(Math.abs(solver.lambda[j] - l0[j]) <= tol.uniform * scale)) return false;
    }
  }
  return true;
}
