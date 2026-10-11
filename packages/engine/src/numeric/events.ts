/**
 * Event location on the dense output of one accepted step (DESIGN §3.4).
 *
 * A guard is a scalar function g(t, y(t)); an event is a sign change of g in the guard's
 * direction. Crossing rules, for consecutive samples g_a = g(t_a), g_b = g(t_b):
 *   rising:  g_a < 0 and g_b ≥ 0        falling:  g_a > 0 and g_b ≤ 0        any: either
 * So a guard that starts a step at exactly 0 and moves away does not fire (no re-triggering
 * right after an event), and a crossing that lands exactly on a sample fires once.
 *
 * Each armed guard is sampled at both ends of the step and at k interior points, so two sign
 * changes inside one step are not missed when a sample falls between them. A tangency (a double
 * root with no sign change) is invisible to any sign test; the simulator bounds hmax instead.
 * Guards see only the dense output; they never cause RHS evaluations themselves.
 */
import { type AcceptedStep, evalDense } from './dense';
import { findRoot } from './roots';

export type GuardDirection = 'rising' | 'falling' | 'any';

export interface Guard {
  readonly id: string;
  readonly direction: GuardDirection;
  /** Disarmed guards are skipped entirely (fn is not called). */
  readonly armed: boolean;
  /** Guard value at time t; `y` is the dense state at t, a scratch buffer valid only during the call. */
  fn(t: number, y: Float64Array): number;
}

export interface EventHit {
  readonly id: string;
  /** Index of the guard in the array passed to locateEvents. */
  readonly index: number;
  /** Crossing time (best estimate of the root on the dense output). */
  readonly t: number;
  /** Root bracket in time order: g changes sign on [lo, hi], hi − lo ≤ rootTol·max(1, |t|). */
  readonly lo: number;
  readonly hi: number;
  readonly crossing: 'rising' | 'falling';
  readonly converged: boolean;
}

export interface EventResult {
  /** Time of the earliest crossing in the direction of integration. */
  readonly t: number;
  /** Every guard whose first crossing is within εt of t, sorted by id (then index). */
  readonly hits: readonly EventHit[];
}

export interface LocateOptions {
  /** Interior sample points per step (default 4). */
  samples?: number;
  /** Simultaneity: hits within εt = simultaneityTol·max(1, |t|) of the earliest (default 1e-12). */
  simultaneityTol?: number;
  /** Root tolerance factor, see findRoot (default 1e-13). */
  rootTol?: number;
  /** Root finder iteration cap (default 80). */
  maxIterations?: number;
  /** Work vector of length ≥ n for dense states; allocated if omitted. */
  scratch?: Float64Array;
}

/** The earliest guard crossing(s) inside `step`, or null if no armed guard crosses. */
export function locateEvents(
  step: AcceptedStep,
  guards: readonly Guard[],
  opts?: LocateOptions,
): EventResult | null {
  const k = opts?.samples ?? 4;
  const rootTol = opts?.rootTol ?? 1e-13;
  const maxIterations = opts?.maxIterations ?? 80;
  const y = opts?.scratch ?? new Float64Array(step.n);
  const { t0, t1 } = step;
  const m = k + 2;

  const armed: number[] = [];
  for (let i = 0; i < guards.length; i++) if (guards[i].armed) armed.push(i);
  if (armed.length === 0) return null;

  // Sample all armed guards; the dense state at each sample time is shared by the guards.
  const times: number[] = [];
  for (let j = 0; j < m; j++) times.push(j === m - 1 ? t1 : t0 + (j / (k + 1)) * (t1 - t0));
  const values: number[] = new Array<number>(armed.length * m);
  for (let j = 0; j < m; j++) {
    evalDense(step, times[j], y);
    for (let a = 0; a < armed.length; a++) {
      values[a * m + j] = evaluate(guards[armed[a]], times[j], y);
    }
  }

  // First qualifying sample interval of each guard, in time order.
  const candidates: { a: number; j: number }[] = [];
  for (let a = 0; a < armed.length; a++) {
    const dir = guards[armed[a]].direction;
    for (let j = 0; j < m - 1; j++) {
      if (crosses(dir, values[a * m + j], values[a * m + j + 1])) {
        candidates.push({ a, j });
        break;
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((p, q) => p.j - q.j || p.a - q.a);

  // Integration order: later = further along h's sign.
  const sgn = step.h >= 0 ? 1 : -1;
  const eps = (t: number) => (opts?.simultaneityTol ?? 1e-12) * Math.max(1, Math.abs(t));
  const hits: EventHit[] = [];
  let best = Infinity; // sgn·t of the earliest root so far
  for (const { a, j } of candidates) {
    // Roots in this interval are no earlier than its start; past best + εt nothing can join.
    if (best !== Infinity && sgn * times[j] > best + eps(best)) break;
    const index = armed[a];
    const guard = guards[index];
    const ga = values[a * m + j];
    const gb = values[a * m + j + 1];
    const root = findRoot(
      (t) => evaluate(guard, t, evalDense(step, t, y)),
      times[j],
      times[j + 1],
      ga,
      gb,
      {
        tol: rootTol,
        maxIterations,
      },
    );
    hits.push({
      id: guard.id,
      index,
      t: root.t,
      lo: root.lo,
      hi: root.hi,
      crossing: ga < 0 ? 'rising' : 'falling',
      converged: root.converged,
    });
    best = Math.min(best, sgn * root.t);
  }

  const tFirst = sgn * best;
  const simultaneous = hits.filter((hit) => Math.abs(hit.t - tFirst) <= eps(tFirst));
  // Their times differ by rounding noise only, so order by id: deterministic under rounding.
  simultaneous.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : p.index - q.index));
  return { t: tFirst, hits: simultaneous };
}

function crosses(dir: GuardDirection, ga: number, gb: number): boolean {
  const rising = ga < 0 && gb >= 0;
  const falling = ga > 0 && gb <= 0;
  return dir === 'rising' ? rising : dir === 'falling' ? falling : rising || falling;
}

function evaluate(guard: Guard, t: number, y: Float64Array): number {
  const g = guard.fn(t, y);
  if (Number.isNaN(g)) {
    throw new Error(`locateEvents: guard "${guard.id}" returned NaN at t = ${t}`);
  }
  return g;
}
