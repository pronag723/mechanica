/**
 * Simulation tolerances, all derived once from the scene scales (Scales in model/types.ts):
 * L* (length), V* = max(√(g·L*), max|v₀|), F* = max(Σm·g, max|F|), T* = L* / V*, and the
 * acceleration scale A* = V*²/L* (= g when V* = √(g·L*)).
 *
 * | name      | value          | used for                                                           |
 * |-----------|----------------|--------------------------------------------------------------------|
 * | pos       | 1e-9·L*        | candidate gap |g| ≤ εpos; contact overlap > εpos; guard bands     |
 * | vel       | 1e-9·V*        | candidate gap rate, stick candidates |v_t| ≤ εvel; guard bands      |
 * | acc       | 1e-9·A*        | mode validation: inactive g̈ ≥ −εa, slip a_t·s ≥ −εa; same motion  |
 * | force     | 1e-9·F*        | mode validation: λ ≥ −εF, |λ_t| ≤ μs·λ_n + εF; guard bands         |
 * | angle     | 1e-9 rad       | the wrap-angle guard's band                                        |
 * | project   | 1e-12·L*       | Gauss–Newton position projection target                            |
 * | projectV  | 1e-13·V*       | velocity projection is skipped below this |J·v|                    |
 * | reportV   | 1e-12·V*       | INITIAL_VELOCITY_PROJECTED lists components changed by more        |
 * | uniform   | 1e-12 relative | `uniform` phases: a and λ agree at start, middle and end           |
 * | time      | 1e-12·max(1,|t|) | simultaneous events (locateEvents' simultaneityTol)              |
 *
 * The 1e-9 family sits far above rounding (λ, a are computed to ~1e-15 relative) and far below
 * any physical difference in a textbook scene. Integration: rtol from the spec (default 1e-10),
 * atol 1e-12·L* on positions and 1e-12·V* on velocities unless the spec gives a scalar atol;
 * hmax = T* so that a guard is sampled at least every T* / 5 (4 interior samples per step).
 */
import type { Scales } from '../model/types';

export interface SimTolerances {
  readonly pos: number;
  readonly vel: number;
  readonly acc: number;
  readonly force: number;
  readonly angle: number;
  readonly project: number;
  readonly projectV: number;
  readonly reportV: number;
  readonly uniform: number;
  readonly simultaneity: number;
  readonly hmax: number;
  /** Scales again, for scale-relative comparisons. */
  readonly scales: Scales;
  readonly accScale: number;
}

export function simTolerances(scales: Scales): SimTolerances {
  const accScale = (scales.velocity * scales.velocity) / scales.length;
  return {
    pos: 1e-9 * scales.length,
    vel: 1e-9 * scales.velocity,
    acc: 1e-9 * accScale,
    force: 1e-9 * scales.force,
    angle: 1e-9,
    project: 1e-12 * scales.length,
    projectV: 1e-13 * scales.velocity,
    reportV: 1e-12 * scales.velocity,
    uniform: 1e-12,
    simultaneity: 1e-12,
    hmax: scales.time,
    scales,
    accScale,
  };
}
