/**
 * Dense output of DOPRI5: Hairer's 4th-order continuous extension (dopri5.f, CONTD5).
 * With θ = (t − t₀)/h ∈ [0, 1] and θ' = 1 − θ:
 *   y(θ) = r₁ + θ·(r₂ + θ'·(r₃ + θ·(r₄ + θ'·r₅)))
 *   r₁ = y₀,  r₂ = y₁ − y₀,  r₃ = h·k₁ − r₂,  r₄ = r₂ − h·k₇ − r₃,  r₅ = h·Σ d_i·k_i
 * It matches y₀, y₁ and the derivatives k₁ = f(t₀, y₀), k₇ = f(t₁, y₁) at both ends, so the
 * interpolant is C¹ across steps. It reproduces polynomial solutions of degree ≤ 4 exactly (up to
 * rounding), in particular every uniformly accelerated motion.
 */

// Shampine's (1986) coefficients d_i of the continuous extension, as in dopri5.f (CDOPRI).
const D1 = -12715105075 / 11282082432;
const D3 = 87487479700 / 32700410799;
const D4 = -10690763975 / 1880347072;
const D5 = 701980252875 / 199316789632;
const D6 = -1453857185 / 822651844;
const D7 = 69997945 / 29380423;

/** d over the 7 stages (d₂ = 0). */
export const DOPRI5_DENSE_D = [D1, 0, D3, D4, D5, D6, D7] as const;

/** One accepted step: everything needed to evaluate the solution anywhere in [t₀, t₁]. */
export interface AcceptedStep {
  /** State dimension. */
  readonly n: number;
  readonly t0: number;
  /** End time. Equals tEnd exactly when the step was clamped to it, otherwise t0 + h. */
  readonly t1: number;
  /** Signed step size used for the stages (negative when integrating backwards). */
  readonly h: number;
  /**
   * Storage, possibly shared with other steps (the stepper hands out slices of larger chunks,
   * because allocating a typed array per step dominated the run time). This step owns
   * data[offset, offset + 6n): the coefficient vectors r₁ (= y₀) … r₅, then y₁.
   * Read states with evalDense, which returns y₀ and y₁ exactly at t₀ and t₁.
   */
  readonly data: Float64Array;
  readonly offset: number;
}

/** Doubles of storage per step. */
export function stepStorageLength(n: number): number {
  return 6 * n;
}

/** A step record with its own storage (the stepper itself allocates from chunks). */
export function createStep(
  n: number,
  t0: number,
  t1: number,
  h: number,
  data: Float64Array = new Float64Array(stepStorageLength(n)),
  offset = 0,
): AcceptedStep {
  return { n, t0, t1, h, data, offset };
}

/** Fills r₁…r₅ and y₁ of `step` from the stage derivatives (stage 2 has no weight here). */
export function fillDense(
  step: AcceptedStep,
  y0: Float64Array,
  y1: Float64Array,
  k1: Float64Array,
  k3: Float64Array,
  k4: Float64Array,
  k5: Float64Array,
  k6: Float64Array,
  k7: Float64Array,
): void {
  const { n, h, data } = step;
  const o = step.offset;
  for (let i = 0; i < n; i++) {
    const ydiff = y1[i] - y0[i];
    const bspl = h * k1[i] - ydiff;
    data[o + i] = y0[i];
    data[o + n + i] = ydiff;
    data[o + 2 * n + i] = bspl;
    data[o + 3 * n + i] = ydiff - h * k7[i] - bspl;
    data[o + 4 * n + i] =
      h * (D1 * k1[i] + D3 * k3[i] + D4 * k4[i] + D5 * k5[i] + D6 * k6[i] + D7 * k7[i]);
    data[o + 5 * n + i] = y1[i];
  }
}

/**
 * Writes y(t) into `out` (length ≥ n) and returns it. t should lie in [t0, t1]; outside the step
 * the polynomial is extrapolated. At t0 and t1 it returns y₀ and y₁ exactly.
 */
export function evalDense(step: AcceptedStep, t: number, out: Float64Array): Float64Array {
  const { n, data } = step;
  const o = step.offset;
  if (t === step.t1) {
    for (let i = 0; i < n; i++) out[i] = data[o + 5 * n + i];
    return out;
  }
  const s = (t - step.t0) / step.h;
  const s1 = 1 - s;
  for (let i = 0; i < n; i++) {
    const j = o + i;
    out[i] =
      data[j] +
      s * (data[j + n] + s1 * (data[j + 2 * n] + s * (data[j + 3 * n] + s1 * data[j + 4 * n])));
  }
  return out;
}

/**
 * Writes dy/dt(t) of the interpolant into `out`. Exact (up to rounding) at the step ends, where it
 * equals k₁ and k₇; in between its local error is O(h⁴) (one order below the interpolant's O(h⁵)).
 */
export function evalDenseDerivative(
  step: AcceptedStep,
  t: number,
  out: Float64Array,
): Float64Array {
  const { n, data, h } = step;
  const o = step.offset;
  const s = (t - step.t0) / h;
  const s1 = 1 - s;
  for (let i = 0; i < n; i++) {
    const j = o + i;
    const r5 = data[j + 4 * n];
    // Nested form P = r₁ + θ·Q, Q = r₂ + θ'·R, R = r₃ + θ·S, S = r₄ + θ'·r₅, differentiated in θ.
    const S = data[j + 3 * n] + s1 * r5;
    const R = data[j + 2 * n] + s * S;
    const dR = S - s * r5;
    const Q = data[j + n] + s1 * R;
    const dQ = s1 * dR - R;
    out[i] = (Q + s * dQ) / h;
  }
  return out;
}
