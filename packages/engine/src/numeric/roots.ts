/**
 * Bracketed scalar root finding: Brent's method (R. P. Brent, "Algorithms for Minimization without
 * Derivatives", 1973, ch. 4; the zeroin/zbrent formulation). It combines inverse quadratic
 * interpolation, secant steps and bisection, and keeps a sign-changing bracket at every iteration.
 * Simple roots converge superlinearly (≲ 10 evaluations). Roots of odd multiplicity ≥ 3 converge
 * only linearly, at about 3× the bisection count, and may hit the iteration cap: the result then
 * says converged = false and still carries a valid bracket. Such roots are ill-determined anyway:
 * with rounding noise δ in g, a root of multiplicity m is only known to about δ^(1/m).
 */
import { EPS } from './matrix';

export interface RootOptions {
  /** Time tolerance factor: the final bracket is ≤ tol·max(1, |t|) wide (default 1e-13). */
  tol?: number;
  /** Iteration cap (default 80). */
  maxIterations?: number;
}

export interface RootResult {
  /** Best estimate: the bracket end with the smaller |g|. */
  readonly t: number;
  /** Bracket in time order; g(lo) and g(hi) have opposite signs or one of them is 0. */
  readonly lo: number;
  readonly hi: number;
  readonly gLo: number;
  readonly gHi: number;
  readonly iterations: number;
  /** False if maxIterations ran out first; the bracket is still valid. */
  readonly converged: boolean;
}

/**
 * Finds a root of g in the bracket [ta, tb] (either order), given ga = g(ta) and gb = g(tb) of
 * opposite signs (or one of them zero). Throws if there is no sign change.
 */
export function findRoot(
  g: (t: number) => number,
  ta: number,
  tb: number,
  ga: number,
  gb: number,
  opts?: RootOptions,
): RootResult {
  const tol = opts?.tol ?? 1e-13;
  const maxIterations = opts?.maxIterations ?? 80;
  if (ga === 0) return exact(ta, 0);
  if (gb === 0) return exact(tb, 0);
  if (!((ga < 0 && gb > 0) || (ga > 0 && gb < 0))) {
    throw new RangeError(`findRoot: no sign change on [${ta}, ${tb}] (g = ${ga}, ${gb})`);
  }

  // b: best estimate; c: the other end of the bracket (sign of g(c) ≠ sign of g(b)); a: previous b.
  let a = ta;
  let fa = ga;
  let b = tb;
  let fb = gb;
  let c = b;
  let fc = fb;
  let d = b - a;
  let e = d;
  for (let iter = 0; ; iter++) {
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    // Half the target width, floored at the rounding level of b so each step still moves b.
    const tol1 = Math.max(0.5 * tol * Math.max(1, Math.abs(b)), 2 * EPS * Math.abs(b));
    const xm = 0.5 * (c - b);
    if (fb === 0) return exact(b, iter);
    if (Math.abs(xm) <= tol1 || iter >= maxIterations) {
      const converged = Math.abs(xm) <= tol1;
      return b < c
        ? { t: b, lo: b, hi: c, gLo: fb, gHi: fc, iterations: iter, converged }
        : { t: b, lo: c, hi: b, gLo: fc, gHi: fb, iterations: iter, converged };
    }

    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      // Interpolation: secant if only two distinct points, else inverse quadratic.
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qa = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qa * (qa - r) - (b - a) * (r - 1));
        q = (qa - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      else p = -p;
      // Accept the interpolated step only if it stays well inside the bracket and shrinks fast.
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm; // bisection
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
    fb = g(b);
    if (Number.isNaN(fb)) throw new Error(`findRoot: g(${b}) is NaN`);
  }
}

function exact(t: number, iterations: number): RootResult {
  return { t, lo: t, hi: t, gLo: 0, gHi: 0, iterations, converged: true };
}
