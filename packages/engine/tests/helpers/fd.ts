/**
 * Finite differences with Richardson extrapolation (test-only). A central difference D(h) has an
 * error expansion in even powers of h, so with h_k = h0/2^k the tableau
 *   R[j][k] = R[j−1][k] + (R[j−1][k] − R[j−1][k−1]) / (4^j − 1)
 * removes the h², h⁴, … terms one column at a time.
 */

export interface Extrapolated {
  value: number;
  /** |difference between the last two diagonal entries|: a rough error estimate. */
  error: number;
}

export function richardson(D: (h: number) => number, h0: number, levels: number): Extrapolated {
  const R: number[][] = [];
  for (let k = 0; k < levels; k++) {
    R.push([D(h0 / 2 ** k)]);
    for (let j = 1; j <= k; j++) {
      const f = 4 ** j;
      R[k].push(R[k][j - 1] + (R[k][j - 1] - R[k - 1][j - 1]) / (f - 1));
    }
  }
  const last = R[levels - 1][levels - 1];
  const prev = R[levels - 2][levels - 2];
  return { value: last, error: Math.abs(last - prev) };
}

/** d/ds f(x + s·dir) at s = 0. */
export function directionalDerivative(
  f: (x: Float64Array) => number,
  x: ArrayLike<number>,
  dir: ArrayLike<number>,
  h0 = 1e-2,
  levels = 4,
): Extrapolated {
  const xp = Float64Array.from(x);
  const at = (s: number): number => {
    for (let i = 0; i < xp.length; i++) xp[i] = x[i] + s * dir[i];
    return f(xp);
  };
  return richardson((h) => (at(h) - at(-h)) / (2 * h), h0, levels);
}

/** d²/ds² f(x + s·dir) at s = 0. */
export function secondDirectionalDerivative(
  f: (x: Float64Array) => number,
  x: ArrayLike<number>,
  dir: ArrayLike<number>,
  h0 = 4e-2,
  levels = 4,
): Extrapolated {
  const xp = Float64Array.from(x);
  const at = (s: number): number => {
    for (let i = 0; i < xp.length; i++) xp[i] = x[i] + s * dir[i];
    return f(xp);
  };
  const f0 = at(0);
  return richardson((h) => (at(h) - 2 * f0 + at(-h)) / (h * h), h0, levels);
}

/** Unit vector e_i of length n. */
export function unit(n: number, i: number): Float64Array {
  const e = new Float64Array(n);
  e[i] = 1;
  return e;
}
