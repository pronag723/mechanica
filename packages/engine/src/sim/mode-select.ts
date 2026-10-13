/**
 * Mode selection by enumeration (DESIGN §3.4; Baraff 1994 for the acceleration-level problem),
 * written over an abstract problem so it can be tested with synthetic data.
 *
 * Each candidate (a unilateral constraint with gap ≈ 0 and gap rate ≈ 0) takes one of its allowed
 * states. For a combination, `solve` solves the equalities only (active rows, stick rows); the
 * core then validates:
 * - active (string or contact):  λ ≥ −εF;
 * - inactive:                    g̈ = J·a + J̇v ≥ −εa;
 * - stick:                       |λ_t| ≤ μs·λ_n + εF  (two linear inequalities);
 * - slipPos / slipNeg, for a contact at rest tangentially (v_t ≈ 0): s·a_t ≥ −εa (the slip has the
 *   sign it assumes; kinetic friction μk·λ_n opposing it is built into the solve).
 * A statically indeterminate solve gives λ = λ_p + Z·w; the λ conditions must then hold for some w
 * (see feasibility.ts), not for the minimum-norm λ_p.
 *
 * Order: candidates' states are listed most preferred first (the caller puts the current state
 * first, then stick > slip > inactive for contacts, active > inactive for strings). Combinations
 * are enumerated by distance from that first choice — the current mode, then single flips, then
 * pairs, … — lexicographically within a distance. All combinations are evaluated, so zero or
 * several valid modes are detected.
 *
 * Choice among the valid modes:
 * 1. Coulomb's law: a contact sticks if sticking is consistent. A valid mode is dropped if another
 *    valid mode has the same states except stick where it slips.
 * 2. If the remaining modes all give the same accelerations (within εa), the motion is unique:
 *    pick the most preferred (most active, then most sticking, then enumeration order). More than
 *    one such mode, or a check passed only within its ε, is a "boundary case" (info).
 * 3. Different motions: MODE_NOT_UNIQUE (warning); the first in enumeration order is chosen
 *    (rule `closestToCurrent`).
 * Checks of `involved` candidates (those of the event being handled) are not reported as boundary
 * cases: their value is 0 by construction, and the event's crossing direction already decided
 * them (the caller removes the state the guard fired from).
 */
import type { Diagnostic } from '../diagnostics';
import { linearFeasible } from './feasibility';

export type CandidateState = 'inactive' | 'active' | 'stick' | 'slipPos' | 'slipNeg';

export interface ModeCandidate {
  readonly id: string;
  /** Allowed states, most preferred first. 'active' is for strings; contacts use stick/slip. */
  readonly states: readonly CandidateState[];
  /** Static friction coefficient (contacts; unused for strings). */
  readonly muS: number;
  /** v_t ≈ 0: a slip state must be checked against the sign of the tangential acceleration. */
  readonly slipFromRest: boolean;
}

export interface NullDirection {
  readonly lambda: ArrayLike<number>;
  readonly lambdaT: ArrayLike<number>;
}

export interface ModeSolve {
  readonly status: 'unique' | 'indeterminate' | 'undetermined';
  /** Accelerations per DOF (compared between modes). */
  readonly a: ArrayLike<number>;
  /** Per candidate: λ (tension or normal force) when active. */
  readonly lambda: ArrayLike<number>;
  /** Per candidate: λ_t (signed static friction along +t) when sticking. */
  readonly lambdaT: ArrayLike<number>;
  /** Per candidate: g̈ when inactive. */
  readonly gapAcc: ArrayLike<number>;
  /** Per candidate: a_t = t·a of the body when slipping. */
  readonly tangentAcc: ArrayLike<number>;
  /** For `indeterminate`: a basis of the multiplier null space, restricted to the candidates. */
  readonly nullDirections?: readonly NullDirection[];
  readonly diagnostics?: readonly Diagnostic[];
}

export interface ModeProblem {
  readonly candidates: readonly ModeCandidate[];
  solve(states: readonly CandidateState[]): ModeSolve;
  readonly tol: { readonly force: number; readonly acc: number };
  /** Indices of candidates whose zero values are explained by the current event. */
  readonly involved?: ReadonlySet<number>;
  /** Default 10 (beyond: a Lemke solver, DESIGN §3.4). */
  readonly maxCandidates?: number;
  /** Default 65 536 combinations. */
  readonly maxCombinations?: number;
}

export interface ValidMode {
  readonly states: readonly CandidateState[];
  readonly solve: ModeSolve;
  /** Some (non-involved) check passed only within its ε. */
  readonly boundary: boolean;
}

export type SelectionStatus = 'unique' | 'notUnique' | 'none' | 'tooManyCandidates';

export interface ModeSelection {
  readonly status: SelectionStatus;
  readonly chosen: ValidMode | null;
  /** Every valid combination, in enumeration order. */
  readonly valid: readonly ValidMode[];
  /** After the Coulomb (stick-first) rule. */
  readonly admissible: readonly ValidMode[];
  /** unique: a tie (several admissible modes with one motion) or a check within ε. */
  readonly boundary: boolean;
  readonly rule: 'preferred' | 'closestToCurrent';
  readonly evaluated: number;
  /** Diagnostics of combinations whose solve was undetermined (the first few). */
  readonly undetermined: readonly Diagnostic[];
}

/** Combinations in enumeration order: by number of non-first states, then lexicographic. */
export function enumerateCombinations(counts: readonly number[]): number[][] {
  const n = counts.length;
  const out: number[][] = [];
  const pick: number[] = new Array<number>(n).fill(0);
  const positions: number[] = [];
  const fill = (k: number): void => {
    if (k === positions.length) {
      out.push([...pick]);
      return;
    }
    const i = positions[k];
    for (let s = 1; s < counts[i]; s++) {
      pick[i] = s;
      fill(k + 1);
    }
    pick[i] = 0;
  };
  const choose = (start: number, d: number): void => {
    if (positions.length === d) {
      fill(0);
      return;
    }
    for (let i = start; i < n; i++) {
      if (counts[i] < 2) continue;
      positions.push(i);
      choose(i + 1, d);
      positions.pop();
    }
  };
  for (let d = 0; d <= n; d++) choose(0, d);
  return out;
}

export function selectMode(problem: ModeProblem): ModeSelection {
  const cands = problem.candidates;
  const maxC = problem.maxCandidates ?? 10;
  const maxComb = problem.maxCombinations ?? 65_536;
  const combos = cands.reduce((p, c) => p * c.states.length, 1);
  const empty = (status: SelectionStatus): ModeSelection => ({
    status,
    chosen: null,
    valid: [],
    admissible: [],
    boundary: false,
    rule: 'preferred',
    evaluated: 0,
    undetermined: [],
  });
  if (cands.length > maxC || combos > maxComb) return empty('tooManyCandidates');
  if (cands.some((c) => c.states.length === 0)) return empty('none');

  const valid: ValidMode[] = [];
  const undetermined: Diagnostic[] = [];
  let evaluated = 0;
  for (const pick of enumerateCombinations(cands.map((c) => c.states.length))) {
    const states = pick.map((s, i) => cands[i].states[s]);
    const solve = problem.solve(states);
    evaluated++;
    if (solve.status === 'undetermined') {
      if (undetermined.length < 4) undetermined.push(...(solve.diagnostics ?? []));
      continue;
    }
    const check = validate(problem, states, solve);
    if (check.valid) valid.push({ states, solve, boundary: check.boundary });
  }
  if (valid.length === 0) return { ...empty('none'), evaluated, undetermined };

  // 1. Coulomb: drop a mode if another valid one sticks where it slips (and agrees elsewhere).
  const stickier = (x: readonly CandidateState[], y: readonly CandidateState[]): boolean => {
    let strict = false;
    for (let i = 0; i < x.length; i++) {
      if (x[i] === y[i]) continue;
      if (x[i] === 'stick' && (y[i] === 'slipPos' || y[i] === 'slipNeg')) strict = true;
      else return false;
    }
    return strict;
  };
  const admissible = valid.filter((y) => !valid.some((x) => stickier(x.states, y.states)));

  // 2./3. One motion or several.
  const first = admissible[0];
  const sameMotion = admissible.every((m) => sameAcc(m.solve.a, first.solve.a, problem.tol.acc));
  if (sameMotion) {
    const score = (m: ValidMode): number[] => [
      -m.states.filter((s) => s !== 'inactive').length,
      -m.states.filter((s) => s === 'stick').length,
    ];
    let chosen = first;
    for (const m of admissible) {
      const [a1, s1] = score(m);
      const [a0, s0] = score(chosen);
      if (a1 < a0 || (a1 === a0 && s1 < s0)) chosen = m;
    }
    return {
      status: 'unique',
      chosen,
      valid,
      admissible,
      boundary: admissible.length > 1 || chosen.boundary,
      rule: 'preferred',
      evaluated,
      undetermined,
    };
  }
  return {
    status: 'notUnique',
    chosen: first,
    valid,
    admissible,
    boundary: first.boundary,
    rule: 'closestToCurrent',
    evaluated,
    undetermined,
  };
}

function sameAcc(a: ArrayLike<number>, b: ArrayLike<number>, tol: number): boolean {
  for (let i = 0; i < a.length; i++) if (!(Math.abs(a[i] - b[i]) <= tol)) return false;
  return true;
}

/** Validates one solved combination; `boundary` if a non-involved check holds only within ε. */
function validate(
  problem: ModeProblem,
  states: readonly CandidateState[],
  solve: ModeSolve,
): { valid: boolean; boundary: boolean } {
  const { force: epsF, acc: epsA } = problem.tol;
  const involved = problem.involved;
  let boundary = false;
  const near = (i: number, x: number, eps: number): void => {
    if (x <= eps && !involved?.has(i)) boundary = true;
  };

  // λ conditions as rows b + A·w ≥ −ε over the null-space coordinates w (k = 0 if unique).
  const Z = solve.status === 'indeterminate' ? (solve.nullDirections ?? []) : [];
  const A: number[][] = [];
  const b: number[] = [];
  const eps: number[] = [];
  const row = (i: number, cl: number, ct: number): void => {
    // cl·λ_i + ct·λ_t,i
    b.push(cl * solve.lambda[i] + (ct !== 0 ? ct * solve.lambdaT[i] : 0));
    A.push(Z.map((z) => cl * z.lambda[i] + (ct !== 0 ? ct * z.lambdaT[i] : 0)));
    eps.push(epsF);
  };

  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const c = problem.candidates[i];
    if (s === 'inactive') {
      const g = solve.gapAcc[i];
      if (!(g >= -epsA)) return { valid: false, boundary };
      near(i, g, epsA);
      continue;
    }
    row(i, 1, 0); // λ ≥ 0
    if (s === 'stick') {
      row(i, c.muS, -1); // μs·λ_n − λ_t ≥ 0
      row(i, c.muS, 1); // μs·λ_n + λ_t ≥ 0
    } else if ((s === 'slipPos' || s === 'slipNeg') && c.slipFromRest) {
      const at = (s === 'slipPos' ? 1 : -1) * solve.tangentAcc[i];
      if (!(at >= -epsA)) return { valid: false, boundary };
      near(i, at, epsA);
    }
  }

  if (Z.length === 0) {
    let r = 0;
    for (let i = 0; i < states.length; i++) {
      if (states[i] === 'inactive') continue;
      const rows = states[i] === 'stick' ? 3 : 1;
      for (let k = 0; k < rows; k++, r++) {
        if (!(b[r] >= -eps[r])) return { valid: false, boundary };
        near(i, b[r], eps[r]);
      }
    }
    return { valid: true, boundary };
  }
  return { valid: linearFeasible(A, b, eps), boundary };
}
