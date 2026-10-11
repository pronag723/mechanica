import { describe, expect, it } from 'vitest';
import { createRng, randomMatrix, randomVector } from '../../tests/helpers/prng';
import { DEFAULT_SINGULAR_TOL, createLU, luFactor, luFactorInto, luSolve } from './lu';
import {
  type Matrix,
  copyMatrix,
  createMatrix,
  matMul,
  matVec,
  matrixFromRows,
  normInf,
  setEntry,
  vecNormInf,
} from './matrix';
import { leastSquaresMinNorm } from './qr';

/** ‖A·x − b‖∞ / (‖A‖∞·‖x‖∞): the normwise backward error of a computed solution. */
function relResidual(A: Matrix, x: Float64Array, b: ArrayLike<number>): number {
  const r = matVec(A, x);
  for (let i = 0; i < r.length; i++) r[i] -= b[i];
  return vecNormInf(r) / (normInf(A) * vecNormInf(x));
}

/**
 * KKT saddle-point matrix [M −Jᵀ; J 0] for diagonal M (zeros allowed) and a k×n Jacobian J.
 */
function saddle(masses: readonly number[], J: Matrix): Matrix {
  const n = masses.length;
  const k = J.rows;
  const K = createMatrix(n + k, n + k);
  for (let i = 0; i < n; i++) setEntry(K, i, i, masses[i]);
  for (let r = 0; r < k; r++) {
    for (let j = 0; j < n; j++) {
      const v = J.data[r * n + j];
      setEntry(K, j, n + r, -v);
      setEntry(K, n + r, j, v);
    }
  }
  return K;
}

describe('luFactor / luSolve', () => {
  it('solves a small system exactly', () => {
    // x = (1, −2, 3)
    const A = matrixFromRows([
      [2, 1, -1],
      [-3, -1, 2],
      [-2, 1, 2],
    ]);
    const f = luFactor(A);
    expect(f.singular).toBe(false);
    const x = luSolve(f, [-3, 5, 2]);
    expect(Array.from(x).map((v) => Math.round(v * 1e12) / 1e12)).toEqual([1, -2, 3]);
  });

  it('pivots past a zero diagonal entry', () => {
    const A = matrixFromRows([
      [0, 1],
      [1, 0],
    ]);
    const f = luFactor(A);
    expect(f.singular).toBe(false);
    expect(Array.from(luSolve(f, [3, 5]))).toEqual([5, 3]);
  });

  it('random well-conditioned systems n = 2…60: backward error ≤ 1e-12', () => {
    const rng = createRng(1);
    for (let n = 2; n <= 60; n++) {
      const A = randomMatrix(rng, n, n);
      const b = randomVector(rng, n);
      const f = luFactor(A);
      expect(f.singular).toBe(false);
      expect(relResidual(A, luSolve(f, b), b)).toBeLessThanOrEqual(1e-12);
    }
  });

  it('reuses one factorization for many right-hand sides, in place or not', () => {
    const rng = createRng(2);
    const n = 25;
    const A = randomMatrix(rng, n, n);
    const f = luFactor(A);
    const snapshot = Float64Array.from(f.lu);
    const out = new Float64Array(n);
    for (let trial = 0; trial < 10; trial++) {
      const b = randomVector(rng, n);
      const x = luSolve(f, b, out);
      expect(x).toBe(out);
      expect(relResidual(A, x, b)).toBeLessThanOrEqual(1e-12);
      const inPlace = Float64Array.from(b);
      luSolve(f, inPlace, inPlace);
      expect(inPlace).toEqual(x);
    }
    expect(f.lu).toEqual(snapshot);
  });

  it('luFactorInto refactors into the same storage', () => {
    const rng = createRng(3);
    const f = createLU(8);
    for (let trial = 0; trial < 3; trial++) {
      const A = randomMatrix(rng, 8, 8);
      expect(luFactorInto(A, f)).toBe(f);
      const b = randomVector(rng, 8);
      expect(relResidual(A, luSolve(f, b), b)).toBeLessThanOrEqual(1e-12);
    }
    expect(() => luFactorInto(randomMatrix(rng, 7, 7), f)).toThrow(RangeError);
  });

  describe('flags singular matrices', () => {
    const cases: [string, Matrix][] = [
      ['zero matrix', createMatrix(4, 4)],
      [
        'duplicate rows',
        matrixFromRows([
          [1, 2, 3],
          [4, 5, 6],
          [1, 2, 3],
        ]),
      ],
      [
        'zero column',
        matrixFromRows([
          [1, 0, 3],
          [4, 0, 6],
          [7, 0, 8],
        ]),
      ],
      [
        'row 3 = row 1 + row 2',
        matrixFromRows([
          [2, -1, 4, 1],
          [3, 5, -2, 7],
          [5, 4, 2, 8],
          [1, 1, 1, -3],
        ]),
      ],
      [
        'two identical string rows in a KKT matrix',
        saddle(
          [1, 1, 2, 2],
          matrixFromRows([
            [0.6, -0.8, -0.6, 0.8],
            [0.6, -0.8, -0.6, 0.8],
          ]),
        ),
      ],
    ];
    it.each(cases)('%s', (_name, A) => {
      const f = luFactor(A);
      expect(f.singular).toBe(true);
      expect(() => luSolve(f, new Float64Array(A.rows))).toThrow(/singular/);
    });

    it('rank-deficient products B·C (n = 3…60; rank n − 1, n/2 and 1)', () => {
      // The default threshold must sit well above rounding-level pivots: require a 10× margin.
      const rng = createRng(4);
      let worst = 0;
      for (let n = 3; n <= 60; n++) {
        for (let rep = 0; rep < 10; rep++) {
          for (const r of [n - 1, Math.floor(n / 2), 1]) {
            const A = matMul(randomMatrix(rng, n, r), randomMatrix(rng, r, n));
            worst = Math.max(worst, luFactor(A).minPivotRatio);
          }
        }
      }
      expect(worst).toBeLessThanOrEqual(DEFAULT_SINGULAR_TOL / 10);
    });
  });

  it('a 10⁵ kg body next to a 1 g body is not singular (scale-invariant ratio)', () => {
    const rng = createRng(6);
    let worst = 1;
    for (let trial = 0; trial < 500; trial++) {
      const nq = rng.int(2, 30);
      const masses = Array.from({ length: nq }, () => 10 ** rng.uniform(-3, 5));
      const K = saddle(masses, randomMatrix(rng, rng.int(1, nq), nq));
      const b = randomVector(rng, K.rows);
      const f = luFactor(K);
      worst = Math.min(worst, f.minPivotRatio);
      expect(relResidual(K, luSolve(f, b), b)).toBeLessThanOrEqual(1e-12);
    }
    expect(worst).toBeGreaterThanOrEqual(DEFAULT_SINGULAR_TOL * 10);
  });

  it('minPivotRatio is unchanged by power-of-two column scaling', () => {
    const rng = createRng(7);
    const A = randomMatrix(rng, 12, 12);
    const S = copyMatrix(A);
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) S.data[i * 12 + j] *= 2 ** (3 * j - 15);
    }
    expect(luFactor(S).minPivotRatio).toBe(luFactor(A).minPivotRatio);
  });

  it('rejects non-square matrices', () => {
    expect(() => luFactor(createMatrix(2, 3))).toThrow(RangeError);
  });
});

describe('saddle-point systems [M −Jᵀ; J 0] with massless coordinates', () => {
  it('massless knot held by two strings, a mass hanging below it', () => {
    // Knot K (massless) at the origin; strings to anchors 30° up-left and 60° up-right; a third
    // string from K down to a 2 kg body B. Unknowns (a_Kx, a_Ky, a_Bx, a_By, λ1, λ2, λ3).
    // Each string row is J_i = ∂g_i/∂q for g_i = ℓ_i − |length|, so λ_i is the tension.
    const c30 = Math.sqrt(3) / 2;
    const J = matrixFromRows([
      [-c30, 0.5, 0, 0], // anchor up-left: g₁ gradient on K is −e₁, e₁ = (cos30°, −sin30°)
      [0.5, c30, 0, 0], // anchor up-right: −e₂, e₂ = (−cos60°, −sin60°)
      [0, -1, 0, 1], // K–B: +e₃ on K, −e₃ on B, e₃ = (0, −1)
    ]);
    const K = saddle([0, 0, 2, 2], J);
    const rhs = [0, 0, 0, -2 * 9.8, 0, 0, 0];
    const f = luFactor(K);
    expect(f.singular).toBe(false);
    const x = luSolve(f, rhs);
    expect(relResidual(K, x, rhs)).toBeLessThanOrEqual(1e-14);
    // Statics: T₃ = mg = 19.6, T₃₀ = mg/2 = 9.8, T₆₀ = mg·√3/2 = 16.974… (oracle scene t14).
    const expected = [0, 0, 0, 0, 9.8, 9.8 * Math.sqrt(3), 19.6];
    for (let i = 0; i < 7; i++) expect(Math.abs(x[i] - expected[i])).toBeLessThanOrEqual(1e-13);
  });

  it('random saddle systems with zero masses are solved to 1e-12', () => {
    const rng = createRng(5);
    for (let trial = 0; trial < 200; trial++) {
      const nq = rng.int(2, 30);
      const k = rng.int(1, nq); // constraint rows
      const massless = rng.int(1, k); // zero diagonal entries, at most k for a nonsingular whole
      const masses = Array.from({ length: nq }, () => rng.uniform(0.1, 10));
      for (let z = 0; z < massless; z++) masses[rng.int(0, nq - 1)] = 0;
      const K = saddle(masses, randomMatrix(rng, k, nq));
      const b = randomVector(rng, nq + k);
      const f = luFactor(K);
      expect(f.singular).toBe(false);
      const x = luSolve(f, b);
      expect(relResidual(K, x, b)).toBeLessThanOrEqual(1e-12);
      // Cross-check against an independent method (pivoted QR).
      const xq = leastSquaresMinNorm(K, b);
      let diff = 0;
      for (let i = 0; i < x.length; i++) diff = Math.max(diff, Math.abs(x[i] - xq[i]));
      expect(diff / vecNormInf(x)).toBeLessThanOrEqual(1e-8);
    }
  });
});
