import { describe, expect, it } from 'vitest';
import { createRng, randomMatrix, randomVector } from '../../tests/helpers/prng';
import { luFactor, luSolve } from './lu';
import {
  type Matrix,
  createMatrix,
  getEntry,
  identity,
  matMul,
  matTVec,
  matVec,
  matrixFromRows,
  normFro,
  transpose,
  vecNorm2,
} from './matrix';
import { extractR, formQ, leastSquaresMinNorm, nullSpace, qrFactor, qrRank, rank } from './qr';

function maxAbsDiff(A: Matrix, B: Matrix): number {
  let d = 0;
  for (let k = 0; k < A.data.length; k++) d = Math.max(d, Math.abs(A.data[k] - B.data[k]));
  return d;
}

/** A·P: column j is column perm[j] of A. */
function permuteColumns(A: Matrix, perm: Int32Array): Matrix {
  const B = createMatrix(A.rows, A.cols);
  for (let i = 0; i < A.rows; i++) {
    for (let j = 0; j < A.cols; j++) B.data[i * A.cols + j] = A.data[i * A.cols + perm[j]];
  }
  return B;
}

/** Random m×n matrix of rank r: (m×r)·(r×n). */
function rankDeficient(seed: number, m: number, n: number, r: number): Matrix {
  const rng = createRng(seed);
  return matMul(randomMatrix(rng, m, r), randomMatrix(rng, r, n));
}

const SHAPES: [number, number][] = [
  [1, 1],
  [5, 5],
  [12, 7],
  [7, 12],
  [30, 30],
  [60, 40],
  [40, 60],
];

describe('qrFactor (column pivoting)', () => {
  it.each(SHAPES)('A·P = Q·R, QᵀQ = I, |r_kk| non-increasing (%i×%i)', (m, n) => {
    const A = randomMatrix(createRng(m * 100 + n), m, n);
    const f = qrFactor(A);
    const Q = formQ(f);
    const R = extractR(f);
    expect(maxAbsDiff(matMul(Q, R), permuteColumns(A, f.perm))).toBeLessThanOrEqual(
      1e-13 * normFro(A),
    );
    const p = Math.min(m, n);
    expect(maxAbsDiff(matMul(transpose(Q), Q), identity(p))).toBeLessThanOrEqual(1e-14 * p);
    for (let k = 1; k < p; k++) {
      expect(Math.abs(getEntry(R, k, k))).toBeLessThanOrEqual(Math.abs(getEntry(R, k - 1, k - 1)));
    }
    expect([...f.perm].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, j) => j));
  });

  it('without pivoting keeps the column order', () => {
    const A = randomMatrix(createRng(9), 6, 4);
    const f = qrFactor(A, { pivoting: false });
    expect(Array.from(f.perm)).toEqual([0, 1, 2, 3]);
    expect(maxAbsDiff(matMul(formQ(f), extractR(f)), A)).toBeLessThanOrEqual(1e-14);
  });
});

describe('rank', () => {
  it('full-rank random matrices', () => {
    for (const [m, n] of SHAPES) {
      expect(rank(randomMatrix(createRng(m + 7 * n), m, n))).toBe(Math.min(m, n));
    }
  });

  it('constructed rank-deficient matrices (m×r)·(r×n)', () => {
    const cases: [number, number, number][] = [
      [5, 5, 1],
      [5, 5, 4],
      [10, 6, 3],
      [6, 10, 3],
      [30, 30, 29],
      [60, 60, 30],
      [60, 40, 39],
      [40, 60, 1],
    ];
    cases.forEach(([m, n, r], i) => expect(rank(rankDeficient(i + 1, m, n, r))).toBe(r));
  });

  it('exact duplicate rows: two identical string constraints', () => {
    // String rows on two bodies (x₁, y₁, x₂, y₂): unit vector e = (0.6, −0.8) on body 1, −e on body 2.
    const J = matrixFromRows([
      [0.6, -0.8, -0.6, 0.8],
      [0, 1, 0, 0],
      [0.6, -0.8, -0.6, 0.8],
    ]);
    expect(rank(J)).toBe(2);
    expect(rank(transpose(J))).toBe(2);
  });

  it('zero, identity, rank-one and empty matrices', () => {
    expect(rank(createMatrix(4, 3))).toBe(0);
    expect(rank(identity(5))).toBe(5);
    expect(
      rank(
        matrixFromRows([
          [1, 2, 3],
          [2, 4, 6],
          [-1, -2, -3],
        ]),
      ),
    ).toBe(1);
    expect(rank(createMatrix(0, 3))).toBe(0);
    expect(rank(createMatrix(3, 0))).toBe(0);
  });

  it('honours an explicit tolerance', () => {
    const A = matrixFromRows([
      [1, 0],
      [0, 1e-9],
    ]);
    expect(rank(A)).toBe(2);
    expect(rank(A, { tol: 1e-6 })).toBe(1);
    expect(qrRank(qrFactor(A), { tol: 1e-12 })).toBe(2);
  });
});

describe('leastSquaresMinNorm', () => {
  it('hand examples', () => {
    expect(Array.from(leastSquaresMinNorm(matrixFromRows([[1, 1]]), [2]))).toEqual([
      expect.closeTo(1, 15),
      expect.closeTo(1, 15),
    ]);
    // Duplicate rows with inconsistent data: x₁ + 2x₂ = 2 (the mean), minimum norm → x = 2·(1, 2)/5.
    const x = leastSquaresMinNorm(
      matrixFromRows([
        [1, 2],
        [1, 2],
      ]),
      [1, 3],
    );
    expect(x[0]).toBeCloseTo(0.4, 15);
    expect(x[1]).toBeCloseTo(0.8, 15);
    expect(Array.from(leastSquaresMinNorm(createMatrix(2, 3), [1, 2]))).toEqual([0, 0, 0]);
  });

  it('square nonsingular: agrees with LU', () => {
    const rng = createRng(21);
    const A = randomMatrix(rng, 20, 20);
    const b = randomVector(rng, 20);
    const xl = luSolve(luFactor(A), b);
    const xq = leastSquaresMinNorm(A, b);
    for (let i = 0; i < 20; i++) expect(Math.abs(xq[i] - xl[i])).toBeLessThanOrEqual(1e-11);
  });

  it('overdetermined full rank: satisfies the normal equations', () => {
    const rng = createRng(22);
    const A = randomMatrix(rng, 40, 15);
    const b = randomVector(rng, 40);
    const x = leastSquaresMinNorm(A, b);
    const r = matVec(A, x).map((v, i) => v - b[i]);
    expect(vecNorm2(matTVec(A, r))).toBeLessThanOrEqual(1e-13 * normFro(A) ** 2 * vecNorm2(x));
  });

  it('underdetermined full row rank: equals Aᵀ(AAᵀ)⁻¹b', () => {
    const rng = createRng(23);
    const A = randomMatrix(rng, 8, 20);
    const b = randomVector(rng, 8);
    const x = leastSquaresMinNorm(A, b);
    const w = luSolve(luFactor(matMul(A, transpose(A))), b);
    const expected = matTVec(A, w);
    for (let i = 0; i < 20; i++) expect(Math.abs(x[i] - expected[i])).toBeLessThanOrEqual(1e-12);
  });

  it('rank-deficient: a least-squares solution orthogonal to the null space', () => {
    for (const [m, n, r] of [
      [10, 10, 6],
      [30, 12, 5],
      [12, 30, 9],
    ] as const) {
      const A = rankDeficient(m + n + r, m, n, r);
      const b = randomVector(createRng(r), m);
      const x = leastSquaresMinNorm(A, b);
      const res = matVec(A, x).map((v, i) => v - b[i]);
      const scale = normFro(A) * (normFro(A) * vecNorm2(x) + vecNorm2(b));
      expect(vecNorm2(matTVec(A, res))).toBeLessThanOrEqual(1e-13 * scale);
      // Minimum norm ⇔ x ∈ range(Aᵀ) ⇔ Nᵀx = 0.
      const N = nullSpace(A);
      expect(N.cols).toBe(n - r);
      expect(vecNorm2(matTVec(N, x))).toBeLessThanOrEqual(1e-13 * vecNorm2(x));
    }
  });
});

describe('nullSpace', () => {
  it('is orthonormal with A·N ≈ 0 and dimension n − rank', () => {
    const cases: [number, number, number][] = [
      [5, 8, 5],
      [8, 8, 3],
      [20, 12, 7],
      [3, 40, 2],
      [60, 60, 45],
    ];
    for (const [m, n, r] of cases) {
      const A = rankDeficient(17 * m + n, m, n, r);
      const N = nullSpace(A);
      expect(N.rows).toBe(n);
      expect(N.cols).toBe(n - r);
      expect(maxAbsDiff(matMul(transpose(N), N), identity(n - r))).toBeLessThanOrEqual(1e-14 * n);
      expect(normFro(matMul(A, N))).toBeLessThanOrEqual(1e-13 * normFro(A));
    }
  });

  it('two identical string rows leave a 2-dimensional null space in 4 coordinates', () => {
    const J = matrixFromRows([
      [0.6, -0.8, -0.6, 0.8],
      [0.6, -0.8, -0.6, 0.8],
    ]);
    const N = nullSpace(J);
    expect(N.cols).toBe(3);
    expect(normFro(matMul(J, N))).toBeLessThanOrEqual(1e-15);
  });

  it('full column rank → n×0; zero matrix → whole space', () => {
    expect(nullSpace(randomMatrix(createRng(5), 6, 4)).cols).toBe(0);
    const N = nullSpace(createMatrix(2, 3));
    expect(maxAbsDiff(matMul(transpose(N), N), identity(3))).toBe(0);
  });
});
