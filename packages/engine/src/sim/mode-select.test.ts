import { describe, expect, it } from 'vitest';
import { luFactor, luSolve } from '../numeric/lu';
import { matrixFromRows } from '../numeric/matrix';
import { linearFeasible } from './feasibility';
import {
  type CandidateState,
  type ModeProblem,
  type ModeSolve,
  enumerateCombinations,
  selectMode,
} from './mode-select';

const TOL = { force: 1e-9, acc: 1e-9 };
const NAN2 = [NaN];

/**
 * A block of mass m on a floor, pushed by F along +t (the textbook x02 problem), solved by hand
 * for each state of its one contact candidate. g = 9.8, N = m·g.
 */
function pushedBlock(F: number, muS: number, muK: number, m = 1): ModeProblem {
  const g = 9.8;
  const N = m * g;
  return {
    candidates: [
      { id: 'c', states: ['stick', 'slipPos', 'slipNeg', 'inactive'], muS, slipFromRest: true },
    ],
    tol: TOL,
    solve([s]): ModeSolve {
      if (s === 'inactive') {
        return {
          status: 'unique',
          a: [F / m, -g],
          lambda: NAN2,
          lambdaT: NAN2,
          gapAcc: [-g],
          tangentAcc: NAN2,
        };
      }
      if (s === 'stick') {
        return {
          status: 'unique',
          a: [0, 0],
          lambda: [N],
          lambdaT: [-F],
          gapAcc: NAN2,
          tangentAcc: NAN2,
        };
      }
      const sgn = s === 'slipPos' ? 1 : -1;
      const at = (F - sgn * muK * N) / m;
      return {
        status: 'unique',
        a: [at, 0],
        lambda: [N],
        lambdaT: NAN2,
        gapAcc: NAN2,
        tangentAcc: [at],
      };
    },
  };
}

/**
 * A synthetic frictionless LCP over candidates with gap accelerations g̈ = A·λ + b (the Delassus
 * form). A mode with active set S solves A_SS·λ_S = −b_S; the "motion" reported is g̈ itself.
 */
function lcp(A: number[][], b: number[]): ModeProblem {
  const k = b.length;
  return {
    candidates: b.map((_, i) => ({
      id: `s${i}`,
      states: ['active', 'inactive'],
      muS: 0,
      slipFromRest: false,
    })),
    tol: TOL,
    solve(states: readonly CandidateState[]): ModeSolve {
      const S = states.flatMap((s, i) => (s === 'active' ? [i] : []));
      const lam = new Array<number>(k).fill(0);
      if (S.length > 0) {
        const f = luFactor(matrixFromRows(S.map((i) => S.map((j) => A[i][j]))));
        const x = luSolve(
          f,
          S.map((i) => -b[i]),
        );
        S.forEach((i, r) => (lam[i] = x[r]));
      }
      const gdd = b.map((bi, i) => bi + A[i].reduce((s, aij, j) => s + aij * lam[j], 0));
      return {
        status: 'unique',
        a: gdd.map((x, i) => (states[i] === 'active' ? 0 : x)).concat(lam),
        lambda: states.map((s, i) => (s === 'active' ? lam[i] : NaN)),
        lambdaT: new Array<number>(k).fill(NaN),
        gapAcc: gdd,
        tangentAcc: new Array<number>(k).fill(NaN),
      };
    },
  };
}

describe('enumeration order', () => {
  it('goes by distance from the preferred states, then lexicographically', () => {
    expect(enumerateCombinations([2, 3])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 2],
      [1, 1],
      [1, 2],
    ]);
    expect(enumerateCombinations([1, 2, 1])).toEqual([
      [0, 0, 0],
      [0, 1, 0],
    ]);
    expect(enumerateCombinations([4, 4, 2, 2]).length).toBe(64);
  });
});

describe('selectMode on synthetic problems', () => {
  it('unique: a pushed block slips when F > μs·N (x02b: a = 1.52)', () => {
    const sel = selectMode(pushedBlock(2.5, 0.2, 0.1));
    expect(sel.status).toBe('unique');
    expect(sel.chosen?.states).toEqual(['slipPos']);
    expect(sel.chosen?.solve.a[0]).toBeCloseTo(1.52, 14);
    expect(sel.boundary).toBe(false);
    expect(sel.evaluated).toBe(4);
  });

  it('Coulomb: stick wins over a consistent slip when it can hold (x02a), with no warning', () => {
    const sel = selectMode(pushedBlock(1.5, 0.2, 0.1));
    expect(sel.valid.map((m) => m.states[0])).toEqual(['stick', 'slipPos']);
    expect(sel.admissible.map((m) => m.states[0])).toEqual(['stick']);
    expect(sel.status).toBe('unique');
    expect(sel.boundary).toBe(false);
    expect(sel.chosen?.solve.lambdaT[0]).toBe(-1.5);
  });

  it('tie exactly at the static-friction limit (F = μs·N): stick, flagged as a boundary case', () => {
    const muS = 0.2;
    const sel = selectMode(pushedBlock(muS * 9.8, muS, muS));
    expect(sel.valid.map((m) => m.states[0])).toEqual(['stick', 'slipPos']);
    expect(sel.status).toBe('unique');
    expect(sel.chosen?.states).toEqual(['stick']);
    expect(sel.chosen?.boundary).toBe(true);
    expect(sel.boundary).toBe(true);
  });

  it('a boundary value of an event-involved candidate is not reported as a tie', () => {
    const muS = 0.2;
    const sel = selectMode({ ...pushedBlock(muS * 9.8, muS, muS), involved: new Set([0]) });
    expect(sel.status).toBe('unique');
    expect(sel.boundary).toBe(false);
  });

  it('none: μk > μs with μs·N < F < μk·N has no consistent mode (NO_CONSISTENT_MODE)', () => {
    const sel = selectMode(pushedBlock(2, 0.1, 0.3));
    expect(sel.status).toBe('none');
    expect(sel.chosen).toBeNull();
    expect(sel.evaluated).toBe(4);
  });

  it('several motions: a non-P LCP has three solutions (MODE_NOT_UNIQUE, closest to current)', () => {
    const sel = selectMode(
      lcp(
        [
          [1, 2],
          [2, 1],
        ],
        [-1, -1],
      ),
    );
    expect(sel.valid.map((m) => m.states)).toEqual([
      ['active', 'active'],
      ['inactive', 'active'],
      ['active', 'inactive'],
    ]);
    expect(sel.status).toBe('notUnique');
    expect(sel.rule).toBe('closestToCurrent');
    expect(sel.chosen?.states).toEqual(['active', 'active']);
    for (const l of Array.from(sel.chosen?.solve.lambda ?? [])) expect(l).toBeCloseTo(1 / 3, 15);
  });

  it('unique for a positive definite LCP, whatever the preferred order', () => {
    const p = lcp(
      [
        [2, 1],
        [1, 2],
      ],
      [-1, 1],
    );
    const flipped: ModeProblem = {
      ...p,
      candidates: p.candidates.map((c) => ({ ...c, states: ['inactive', 'active'] })),
    };
    for (const prob of [p, flipped]) {
      const sel = selectMode(prob);
      expect(sel.status).toBe('unique');
      expect(sel.valid.length).toBe(1);
      expect(sel.chosen?.states).toEqual(['active', 'inactive']);
      expect(sel.chosen?.solve.lambda[0]).toBe(0.5);
    }
  });

  it('same motion in several modes (a redundant support) is a tie: most active wins', () => {
    // Two coincident supports sharing a load of 2: active-active (indeterminate split),
    // either one alone, all with g̈ = 0 for the inactive one.
    const sel = selectMode({
      candidates: ['s0', 's1'].map((id) => ({
        id,
        states: ['inactive', 'active'],
        muS: 0,
        slipFromRest: false,
      })),
      tol: TOL,
      solve(states) {
        const nAct = states.filter((s) => s === 'active').length;
        if (nAct === 0)
          return {
            status: 'unique',
            a: [-1],
            lambda: [NaN, NaN],
            lambdaT: [NaN, NaN],
            gapAcc: [-1, -1],
            tangentAcc: [NaN, NaN],
          };
        if (nAct === 1)
          return {
            status: 'unique',
            a: [0],
            lambda: states.map((s) => (s === 'active' ? 2 : NaN)),
            lambdaT: [NaN, NaN],
            gapAcc: [0, 0],
            tangentAcc: [NaN, NaN],
          };
        // Minimum-norm split (1, 1) plus the null direction (1, −1)/√2.
        return {
          status: 'indeterminate',
          a: [0],
          lambda: [1, 1],
          lambdaT: [NaN, NaN],
          gapAcc: [NaN, NaN],
          tangentAcc: [NaN, NaN],
          nullDirections: [{ lambda: [Math.SQRT1_2, -Math.SQRT1_2], lambdaT: [0, 0] }],
        };
      },
    });
    expect(sel.valid.length).toBe(3);
    expect(sel.status).toBe('unique');
    expect(sel.boundary).toBe(true);
    expect(sel.chosen?.states).toEqual(['active', 'active']);
  });

  it('an indeterminate mode is valid when some split is admissible, not only the min-norm one', () => {
    const base: ModeSolve = {
      status: 'indeterminate',
      a: [0],
      lambda: [-1, 3],
      lambdaT: [NaN, NaN],
      gapAcc: [NaN, NaN],
      tangentAcc: [NaN, NaN],
      nullDirections: [{ lambda: [1, -1], lambdaT: [0, 0] }],
    };
    const prob = (solve: ModeSolve): ModeProblem => ({
      candidates: ['s0', 's1'].map((id) => ({
        id,
        states: ['active'],
        muS: 0,
        slipFromRest: false,
      })),
      tol: TOL,
      solve: () => solve,
    });
    expect(selectMode(prob(base)).status).toBe('unique');
    expect(selectMode(prob({ ...base, lambda: [-1, -1] })).status).toBe('none');
  });

  it('too many candidates', () => {
    const p = lcp(
      Array.from({ length: 11 }, (_, i) => Array.from({ length: 11 }, (_, j) => (i === j ? 1 : 0))),
      new Array<number>(11).fill(-1),
    );
    expect(selectMode(p).status).toBe('tooManyCandidates');
    expect(selectMode({ ...p, maxCandidates: 11, maxCombinations: 1000 }).status).toBe(
      'tooManyCandidates',
    );
  });
});

describe('linearFeasible', () => {
  it('finds a vertex when w = 0 fails, and rejects empty polyhedra', () => {
    // λ = (−1 + w, 3 − w) ≥ 0 ⇔ 1 ≤ w ≤ 3.
    expect(linearFeasible([[1], [-1]], [-1, 3], [0, 0])).toBe(true);
    // λ = (−1 + w, −1 − w): empty.
    expect(linearFeasible([[1], [-1]], [-1, -1], [0, 0])).toBe(false);
    // Rank-deficient A (a line of solutions in w-space): w₁ + w₂ ≥ 1, −w₁ − w₂ ≥ −2.
    expect(
      linearFeasible(
        [
          [1, 1],
          [-1, -1],
        ],
        [-1, 2],
        [0, 0],
      ),
    ).toBe(true);
    expect(
      linearFeasible(
        [
          [1, 1],
          [-1, -1],
        ],
        [-3, 2],
        [0, 0],
      ),
    ).toBe(false);
    // Tolerance: −1e-12 passes with ε = 1e-9.
    expect(linearFeasible([[0]], [-1e-12], [1e-9])).toBe(true);
  });
});
