/**
 * Path length s(t) = ∫₀ᵗ |v| dt, computed after the fact from the dense output. It is not an ODE
 * state: |v| is not smooth where v = 0, and the RHS must be smooth within a phase.
 *
 * On a stored step, each velocity component is a quartic in θ (the CONTD5 polynomial). |v| is
 * smooth except where a component changes sign, so each step is split at the sign changes of v_x
 * and v_y (found by sampling 32 sub-intervals and Brent's method), and each piece is integrated
 * with 8-point Gauss–Legendre. For 1-D motion |v| is then a polynomial of degree 4 on each piece,
 * which the rule integrates exactly; in 2-D the integrand is smooth and the rule's error is far
 * below the integration tolerance. Cumulative values per step are cached per trajectory.
 */
import type { ModelBody } from '../model/types';
import { findRoot } from '../numeric/roots';
import type { PhaseSteps, Trajectory } from './types';

// 8-point Gauss–Legendre nodes and weights on [−1, 1] (Abramowitz & Stegun 25.4.30).
const GL_X = [
  -0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498,
  0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363,
];
const GL_W = [
  0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362,
  0.3137066458778873, 0.2223810344533745, 0.1012285362903763,
];
const SPLIT_SAMPLES = 32;

/** Component `i` of the stored step's polynomial at θ. */
function poly(c: Float64Array, o: number, dim: number, i: number, s: number): number {
  const j = o + i;
  const s1 = 1 - s;
  return (
    c[j] + s * (c[j + dim] + s1 * (c[j + 2 * dim] + s * (c[j + 3 * dim] + s1 * c[j + 4 * dim])))
  );
}

/**
 * ∫|v| dt of a body over [ta, tb] inside stored step k (ta ≤ tb). `nDof` locates the velocity
 * block: v_x is component nDof + dofX of y.
 */
export function stepSpeedIntegral(
  steps: PhaseSteps,
  dim: number,
  nDof: number,
  k: number,
  b: ModelBody,
  ta: number,
  tb: number,
): number {
  if (!(tb > ta)) return 0;
  const c = steps.coeffs;
  const o = k * 5 * dim;
  const t0 = steps.t0[k];
  const h = steps.h[k];
  const ix = nDof + b.dofX;
  const iy = nDof + b.dofY;
  const sa = (ta - t0) / h;
  const sb = (tb - t0) / h;

  // Break points: sign changes of v_x and v_y in (sa, sb).
  const breaks = [sa, sb];
  for (const i of [ix, iy]) {
    const f = (s: number): number => poly(c, o, dim, i, s);
    let prevS = sa;
    let prevF = f(sa);
    for (let j = 1; j <= SPLIT_SAMPLES; j++) {
      const s = sa + ((sb - sa) * j) / SPLIT_SAMPLES;
      const fs = f(s);
      if ((prevF < 0 && fs > 0) || (prevF > 0 && fs < 0)) {
        breaks.push(findRoot(f, prevS, s, prevF, fs, { tol: 1e-15 }).t);
      }
      prevS = s;
      prevF = fs;
    }
  }
  breaks.sort((p, q) => p - q);

  let total = 0;
  for (let p = 0; p + 1 < breaks.length; p++) {
    const lo = breaks[p];
    const hi = breaks[p + 1];
    if (!(hi > lo)) continue;
    const mid = (lo + hi) / 2;
    const half = (hi - lo) / 2;
    let sum = 0;
    for (let g = 0; g < GL_X.length; g++) {
      const s = mid + half * GL_X[g];
      sum += GL_W[g] * Math.hypot(poly(c, o, dim, ix, s), poly(c, o, dim, iy, s));
    }
    total += sum * half;
  }
  return total * Math.abs(h);
}

/** Per phase: cumulative path length at the start of each step (and at the phase end). */
type PathCache = Map<string, Float64Array[]>;
const caches = new WeakMap<Trajectory, PathCache>();

function stepEnd(traj: Trajectory, p: number, k: number): number {
  const ph = traj.phases[p];
  return k + 1 < ph.steps.t0.length ? ph.steps.t0[k + 1] : ph.tEnd;
}

/** Cumulative path at each step start of every phase, plus the phase's final value. */
export function cumulativePath(traj: Trajectory, b: ModelBody): Float64Array[] {
  let cache = caches.get(traj);
  if (!cache) {
    cache = new Map();
    caches.set(traj, cache);
  }
  const hit = cache.get(b.id);
  if (hit) return hit;
  const out: Float64Array[] = [];
  let acc = 0;
  traj.phases.forEach((ph, p) => {
    const n = ph.steps.t0.length;
    const cum = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) {
      cum[k] = acc;
      acc += stepSpeedIntegral(
        ph.steps,
        traj.dim,
        traj.nDof,
        k,
        b,
        ph.steps.t0[k],
        stepEnd(traj, p, k),
      );
    }
    cum[n] = acc;
    out.push(cum);
  });
  cache.set(b.id, out);
  return out;
}

/** Path length of body b from 0 to t, given the phase and step that contain t. */
export function pathLengthIn(
  traj: Trajectory,
  b: ModelBody,
  phase: number,
  step: number,
  t: number,
): number {
  const cum = cumulativePath(traj, b)[phase];
  const ph = traj.phases[phase];
  if (ph.steps.t0.length === 0) return cum[0];
  return (
    cum[step] + stepSpeedIntegral(ph.steps, traj.dim, traj.nDof, step, b, ph.steps.t0[step], t)
  );
}
