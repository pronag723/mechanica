/**
 * Reading a Trajectory: free functions over the model and the plain-data trajectory, so they work
 * on a structured clone (e.g. in the UI thread after postMessage).
 *
 * Side convention at an event time t_e (a phase boundary): 'after' (the default) reads the phase
 * that starts at t_e — after the snap and the new mode; 'before' reads the phase that ends there.
 * Inside a phase, a query restart is also a step boundary; both sides agree there up to rounding.
 */
import type { Model } from '../model/types';
import type { ProbeRef } from '../spec';
import { type AccelerationSolution, solveAccelerations } from '../solve';
import { pathLengthIn } from './path-length';
import { type ProbeForces, evalProbe } from './probes';
import { evalStoredStep, findStep } from './steps';
import type { Trajectory, TrajectoryPhase } from './types';

export type Side = 'before' | 'after';

export interface TrajectoryState {
  readonly t: number;
  readonly phase: number;
  /** Index of the stored step within the phase (−1 for a phase without steps). */
  readonly step: number;
  readonly q: Float64Array;
  readonly v: Float64Array;
}

function checkTime(traj: Trajectory, t: number): void {
  if (traj.phases.length === 0) throw new RangeError('trajectory has no phases');
  if (!(t >= 0 && t <= traj.tEnd))
    throw new RangeError(`t = ${t} is outside the trajectory [0, ${traj.tEnd}]`);
}

/** Index of the phase in effect at t (see the side convention). */
export function phaseAt(traj: Trajectory, t: number, side: Side = 'after'): number {
  checkTime(traj, t);
  const ps = traj.phases;
  if (side === 'after') {
    let k = 0;
    for (let i = 0; i < ps.length; i++) if (ps[i].tStart <= t) k = i;
    return k;
  }
  for (let i = 0; i < ps.length; i++) if (ps[i].tEnd >= t) return i;
  return ps.length - 1;
}

/** The state y = [q, v] at t. */
export function stateAt(traj: Trajectory, t: number, side: Side = 'after'): TrajectoryState {
  const p = phaseAt(traj, t, side);
  const ph: TrajectoryPhase = traj.phases[p];
  const n = traj.nDof;
  const y = new Float64Array(traj.dim);
  let k: number;
  if (ph.steps.t0.length === 0 || (side === 'after' && t === ph.tStart)) {
    y.set(ph.y0);
    k = ph.steps.t0.length === 0 ? -1 : 0;
  } else {
    k = findStep(ph.steps, t, side);
    evalStoredStep(ph.steps, traj.dim, k, t, y);
  }
  return { t, phase: p, step: k, q: y.slice(0, n), v: y.slice(n) };
}

/**
 * Accelerations, multipliers and the force breakdown at t: one KKT solve in the phase's mode
 * (statically indeterminate forces are flagged, see solveAccelerations).
 */
export function forcesAt(
  model: Model,
  traj: Trajectory,
  t: number,
  side: Side = 'after',
): AccelerationSolution {
  const s = stateAt(traj, t, side);
  return solveAccelerations(model, traj.phases[s.phase].mode, t, s.q, s.v);
}

/** The value of a probe at t. */
export function probeValue(
  model: Model,
  traj: Trajectory,
  probe: ProbeRef,
  t: number,
  side: Side = 'after',
): number {
  const s = stateAt(traj, t, side);
  const mode = traj.phases[s.phase].mode;
  let sol: AccelerationSolution | null = null;
  const forces = (): ProbeForces => {
    sol ??= solveAccelerations(model, mode, t, s.q, s.v);
    const solved = sol;
    return {
      a: solved.a,
      lambda: (id) => (solved.indeterminate.includes(id) ? NaN : (solved.lambda[id] ?? NaN)),
      friction: (id) =>
        solved.indeterminateFriction.includes(id) ? NaN : (solved.frictionLambda[id] ?? NaN),
    };
  };
  return evalProbe(model, probe, {
    q: s.q,
    v: s.v,
    mode,
    qRef: traj.phases[0].y0.subarray(0, traj.nDof),
    forces,
    path: (b) => pathLengthIn(traj, b, s.phase, Math.max(0, s.step), t),
  });
}

export interface ProbeSamples {
  readonly t: Float64Array;
  readonly values: Float64Array;
}

/**
 * Samples a probe at the given times, or at n equally spaced times over [0, tEnd] (both ends
 * included). Event times read the 'after' side.
 */
export function sampleProbe(
  model: Model,
  traj: Trajectory,
  probe: ProbeRef,
  times: ArrayLike<number> | number,
): ProbeSamples {
  let ts: Float64Array;
  if (typeof times === 'number') {
    const count = Math.max(2, Math.floor(times));
    ts = Float64Array.from({ length: count }, (_, i) =>
      i === count - 1 ? traj.tEnd : (traj.tEnd * i) / (count - 1),
    );
  } else ts = Float64Array.from(times);
  const values = new Float64Array(ts.length);
  for (let i = 0; i < ts.length; i++) values[i] = probeValue(model, traj, probe, ts[i]);
  return { t: ts, values };
}
