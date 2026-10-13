/**
 * The KKT solve inside the ODE right-hand side and the λ guards of one phase (DESIGN §3.2–3.3).
 *
 * The rank analysis (`solveKkt`, pivoted QR) runs once, when the phase starts. Then:
 * - every active row linear (contacts, stick rows): J and C are constant, J̇v = 0, so K is
 *   factored once per phase; each call only rebuilds the right-hand side [f; 0] and solves;
 * - otherwise (strings): K is re-assembled and refactored on every call, without allocating.
 * A statically indeterminate mode has a singular K, but its motion is unique. We then keep a
 * maximal subset S of the multipliers whose reduced system is regular (greedy, in layout order):
 * the dropped force columns are combinations of the kept ones, so the reduced system gives the same
 * accelerations. The dropped multipliers read NaN; their values are one admissible split and come
 * from `solveAccelerations` (forcesAt), flagged as indeterminate.
 */
import {
  type KktLayout,
  type KktSystem,
  assembleKkt,
  createKktSystem,
  kktLayout,
} from '../kkt/assemble';
import { solveKkt } from '../kkt/solve-system';
import { generalizedForces } from '../model/forces';
import type { Model } from '../model/types';
import type { Mode } from '../mode';
import { createLU, luFactorInto, luSolve } from '../numeric/lu';
import { type Matrix, createMatrix } from '../numeric/matrix';
import { rank } from '../numeric/qr';

export interface PhaseSolver {
  readonly layout: KktLayout;
  readonly status: 'unique' | 'indeterminate';
  readonly linear: boolean;
  /** Per multiplier (layout order): 1 if the equations determine it. */
  readonly determined: Uint8Array;
  /** Accelerations of the last solve. */
  readonly a: Float64Array;
  /** Multipliers of the last solve (layout order); NaN where not kept. */
  readonly lambda: Float64Array;
  /** Solves at (t, q, v); false if the configuration is outside a constraint's domain (then NaN). */
  solve(t: number, q: ArrayLike<number>, v: ArrayLike<number>): boolean;
  /** Number of solves so far. */
  calls: number;
}

export type PhaseSolverResult =
  | { readonly ok: true; readonly solver: PhaseSolver }
  | { readonly ok: false; readonly reason: 'domain' | 'undetermined' };

export function createPhaseSolver(
  model: Model,
  mode: Mode,
  t: number,
  q: ArrayLike<number>,
  v: ArrayLike<number>,
): PhaseSolverResult {
  const layout = kktLayout(model, mode);
  const sys = createKktSystem(model, layout);
  if (!assembleKkt(model, sys, t, q, v)) return { ok: false, reason: 'domain' };
  const sol = solveKkt(sys);
  if (sol.status === 'undetermined') return { ok: false, reason: 'undetermined' };

  const n = layout.nDof;
  const m = layout.nMult;
  const determined = new Uint8Array(m).fill(1);
  for (const j of sol.indeterminate) determined[j] = 0;
  const keep = sol.status === 'unique' ? range(m) : regularSubset(sys);
  const nr = n + keep.length;
  const Kr = createMatrix(nr, nr);
  const rhs = new Float64Array(nr);
  const x = new Float64Array(nr);
  const lu = createLU(nr);
  const linear = Array.from(layout.active).every((ci) => model.constraints[ci].linear);
  const a = new Float64Array(n);
  const lambda = new Float64Array(m).fill(NaN);

  if (linear) {
    extract(sys, keep, Kr);
    luFactorInto(Kr, lu);
  }
  const solver: PhaseSolver = {
    layout,
    status: sol.status,
    linear,
    determined,
    a,
    lambda,
    calls: 0,
    solve(tt, qq, vv) {
      solver.calls++;
      if (linear) {
        // J constant, J̇v = 0 and the stick rows' J̇_t·v = 0: only f changes.
        generalizedForces(model, tt, qq, vv, sys.f);
        for (let i = 0; i < n; i++) rhs[i] = sys.f[i];
        for (let k = 0; k < keep.length; k++) rhs[n + k] = 0;
      } else {
        if (!assembleKkt(model, sys, tt, qq, vv)) {
          a.fill(NaN);
          lambda.fill(NaN);
          return false;
        }
        extract(sys, keep, Kr);
        luFactorInto(Kr, lu);
        for (let i = 0; i < n; i++) rhs[i] = sys.rhs[i];
        for (let k = 0; k < keep.length; k++) rhs[n + k] = sys.rhs[n + keep[k]];
      }
      if (lu.singular) {
        a.fill(NaN);
        lambda.fill(NaN);
        return false;
      }
      luSolve(lu, rhs, x);
      for (let i = 0; i < n; i++) a[i] = x[i];
      for (let k = 0; k < keep.length; k++) lambda[keep[k]] = x[n + k];
      return true;
    },
  };
  return { ok: true, solver };
}

function range(m: number): number[] {
  return Array.from({ length: m }, (_, j) => j);
}

/** Copies the rows and columns [0, n) ∪ (n + keep) of sys.K into Kr. */
function extract(sys: KktSystem, keep: readonly number[], Kr: Matrix): void {
  const n = sys.layout.nDof;
  const N = sys.layout.size;
  const nr = Kr.rows;
  const idx = (r: number): number => (r < n ? r : n + keep[r - n]);
  for (let r = 0; r < nr; r++) {
    const kr = idx(r) * N;
    for (let c = 0; c < nr; c++) Kr.data[r * nr + c] = sys.K.data[kr + idx(c)];
  }
}

/**
 * Greedy maximal set of multipliers (layout order) whose force columns C and rows J are linearly
 * independent. With the motion unique, the reduced K is then regular (checked by the caller's LU).
 */
function regularSubset(sys: KktSystem): number[] {
  const keep: number[] = [];
  const { nDof: n, nMult: m } = sys.layout;
  for (let j = 0; j < m; j++) {
    const trial = [...keep, j];
    const Cs = createMatrix(n, trial.length);
    const Js = createMatrix(trial.length, n);
    trial.forEach((jj, k) => {
      for (let i = 0; i < n; i++) {
        Cs.data[i * trial.length + k] = sys.C.data[i * m + jj];
        Js.data[k * n + i] = sys.J.data[jj * n + i];
      }
    });
    if (rank(Cs) === trial.length && rank(Js) === trial.length) keep.push(j);
  }
  return keep;
}
