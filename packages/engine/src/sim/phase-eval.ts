/**
 * The evaluation context of a phase shared by its guards, probes and the uniformity check: the
 * phase's KKT solve at a dense state, cached per (t, generation) because locateEvents evaluates
 * every guard at the same sample times, and the multipliers by constraint id.
 */
import type { ContactConstraint, Model } from '../model/types';
import type { Mode } from '../mode';
import type { PhaseSolver } from './phase-solver';
import type { ProbeForces } from './probes';

/** Shared evaluation context of a phase: the KKT solve at dense states, cached per (t, y). */
export interface PhaseEval {
  readonly model: Model;
  readonly mode: Mode;
  readonly solver: PhaseSolver;
  readonly q: Float64Array;
  readonly v: Float64Array;
  /** Loads q, v from y and solves (cached while t and the generation are unchanged). */
  at(t: number, y: Float64Array): boolean;
  /** Invalidates the cache (call before each locateEvents). */
  bump(): void;
  readonly forces: ProbeForces;
}

export function createPhaseEval(model: Model, mode: Mode, solver: PhaseSolver): PhaseEval {
  const n = model.nDof;
  const q = new Float64Array(n);
  const v = new Float64Array(n);
  let lastT = NaN;
  let gen = 0;
  let lastGen = -1;
  let ok = false;
  const pos = new Map<string, number>();
  solver.layout.active.forEach((ci, j) => pos.set(model.constraints[ci].id, j));
  const stickPos = new Map<number, number>();
  solver.layout.stick.forEach((j, k) => stickPos.set(j, solver.layout.active.length + k));
  const ev: PhaseEval = {
    model,
    mode,
    solver,
    q,
    v,
    at(t, y) {
      if (t === lastT && gen === lastGen) return ok;
      for (let i = 0; i < n; i++) {
        q[i] = y[i];
        v[i] = y[n + i];
      }
      ok = solver.solve(t, q, v);
      lastT = t;
      lastGen = gen;
      return ok;
    },
    bump() {
      gen++;
    },
    forces: {
      get a() {
        return solver.a;
      },
      lambda(id) {
        const j = pos.get(id);
        return j === undefined ? NaN : solver.lambda[j];
      },
      friction(id) {
        const j = pos.get(id);
        if (j === undefined) return NaN;
        const s = solver.layout.slip[j];
        if (s === 0) return solver.lambda[stickPos.get(j) ?? -1];
        const c = model.constraints[solver.layout.active[j]] as ContactConstraint;
        return 0 - c.material.muK * s * solver.lambda[j];
      },
    },
  };
  return ev;
}
