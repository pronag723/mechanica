/**
 * One Dormand–Prince 5(4) step: the coefficients, the stage formulas and the error norm of
 * Hairer's dopri5.f. The step size controller and the stepping API are in dopri5.ts.
 */
import type { OdeRhs } from './dopri5';
import { DOPRI5_DENSE_D } from './dense';

/*
 * Coefficients as in dopri5.f (CDOPRI). Dormand & Prince, J. Comput. Appl. Math. 6 (1980) 19–26;
 * Hairer, Nørsett, Wanner, "Solving ODEs I", Table II.5.2. Stage 7 is evaluated at (t + h, y₁),
 * so a7j = b_j: the method is FSAL. e_i = b_i − b̂_i, with b̂ the embedded 4th-order weights.
 */
const C2 = 1 / 5;
const C3 = 3 / 10;
const C4 = 4 / 5;
const C5 = 8 / 9;
const A21 = 1 / 5;
const A31 = 3 / 40;
const A32 = 9 / 40;
const A41 = 44 / 45;
const A42 = -56 / 15;
const A43 = 32 / 9;
const A51 = 19372 / 6561;
const A52 = -25360 / 2187;
const A53 = 64448 / 6561;
const A54 = -212 / 729;
const A61 = 9017 / 3168;
const A62 = -355 / 33;
const A63 = 46732 / 5247;
const A64 = 49 / 176;
const A65 = -5103 / 18656;
const A71 = 35 / 384; // a7j = b_j, the 5th-order weights (b2 = b7 = 0)
const A73 = 500 / 1113;
const A74 = 125 / 192;
const A75 = -2187 / 6784;
const A76 = 11 / 84;
const E1 = 71 / 57600;
const E3 = -71 / 16695;
const E4 = 71 / 1920;
const E5 = -17253 / 339200;
const E6 = 22 / 525;
const E7 = -1 / 40;

/** The coefficients as arrays over the 7 stages (index 0 = stage 1), for tests and tooling. */
export const DOPRI5_TABLEAU = {
  c: [0, C2, C3, C4, C5, 1, 1],
  a: [
    [0, 0, 0, 0, 0, 0, 0],
    [A21, 0, 0, 0, 0, 0, 0],
    [A31, A32, 0, 0, 0, 0, 0],
    [A41, A42, A43, 0, 0, 0, 0],
    [A51, A52, A53, A54, 0, 0, 0],
    [A61, A62, A63, A64, A65, 0, 0],
    [A71, 0, A73, A74, A75, A76, 0],
  ],
  b: [A71, 0, A73, A74, A75, A76, 0],
  e: [E1, 0, E3, E4, E5, E6, E7],
  d: DOPRI5_DENSE_D,
} as const;

/*
 * The two hot loops are module-level functions with everything passed in: arguments live in
 * registers in every JIT tier, whereas the stepper's closure variables are context slots.
 */

/** Stages 2…7 of a step of size h from (t, y), given k1; ynew ← the 5th-order solution y₁. */
export function stages(
  f: OdeRhs,
  n: number,
  t: number,
  h: number,
  tph: number,
  y: Float64Array,
  k1: Float64Array,
  k2: Float64Array,
  k3: Float64Array,
  k4: Float64Array,
  k5: Float64Array,
  k6: Float64Array,
  k7: Float64Array,
  ys: Float64Array,
  ynew: Float64Array,
): void {
  for (let i = 0; i < n; i++) ys[i] = y[i] + h * A21 * k1[i];
  f(t + C2 * h, ys, k2);
  for (let i = 0; i < n; i++) ys[i] = y[i] + h * (A31 * k1[i] + A32 * k2[i]);
  f(t + C3 * h, ys, k3);
  for (let i = 0; i < n; i++) ys[i] = y[i] + h * (A41 * k1[i] + A42 * k2[i] + A43 * k3[i]);
  f(t + C4 * h, ys, k4);
  for (let i = 0; i < n; i++) {
    ys[i] = y[i] + h * (A51 * k1[i] + A52 * k2[i] + A53 * k3[i] + A54 * k4[i]);
  }
  f(t + C5 * h, ys, k5);
  for (let i = 0; i < n; i++) {
    ys[i] = y[i] + h * (A61 * k1[i] + A62 * k2[i] + A63 * k3[i] + A64 * k4[i] + A65 * k5[i]);
  }
  f(tph, ys, k6);
  for (let i = 0; i < n; i++) {
    ynew[i] = y[i] + h * (A71 * k1[i] + A73 * k3[i] + A74 * k4[i] + A75 * k5[i] + A76 * k6[i]);
  }
  f(tph, ynew, k7);
}

/**
 * Hairer's error norm: RMS over i of (y₁ − ŷ₁)_i / (atol_i + rtol·max(|y₀_i|, |y₁_i|)).
 * NaN if y₁ is not finite (an infinite y₁ would otherwise inflate the scale and hide the error).
 */
export function errorNorm(
  n: number,
  h: number,
  y: Float64Array,
  ynew: Float64Array,
  k1: Float64Array,
  k3: Float64Array,
  k4: Float64Array,
  k5: Float64Array,
  k6: Float64Array,
  k7: Float64Array,
  atol: Float64Array,
  rtol: number,
): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(ynew[i])) return NaN;
    const e = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
    const q = e / (atol[i] + rtol * Math.max(Math.abs(y[i]), Math.abs(ynew[i])));
    sum += q * q;
  }
  return Math.sqrt(sum / n);
}
