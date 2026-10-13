/**
 * The Trajectory: the simulator's output. Plain data (numbers, strings, arrays, typed arrays, plain
 * objects): no classes, no closures, no Maps, so it survives structuredClone and postMessage.
 */
import type { Diagnostic } from '../diagnostics';
import type { Mode } from '../mode';

/**
 * Event kinds (DESIGN §3.4):
 * - `separation`: an active contact's normal force λ_n crossed 0 downward (lift-off);
 * - `slack`: an active string's tension crossed 0 downward;
 * - `touchdown` / `taut`: an inactive contact's / string's gap closed (prompt 04: impact);
 * - `stopOrReverse`: a sliding contact's tangential velocity crossed 0;
 * - `breakLoose`: a sticking contact's static friction reached μs·λ_n;
 * - `leftSurface`: the body's support feature left the face's extent;
 * - `terminal`: a string segment length or a wrap angle reached 0;
 * - `query`: a user query hit (the mode is unchanged).
 * The horizon is not an event record: it is `endReason: 'horizon'`.
 */
export type EventKind =
  | 'separation'
  | 'slack'
  | 'touchdown'
  | 'taut'
  | 'stopOrReverse'
  | 'breakLoose'
  | 'leftSurface'
  | 'terminal'
  | 'query';

export type EndReason =
  | 'horizon'
  | 'impactNotImplemented'
  | 'noConsistentMode'
  | 'tooManyCandidates'
  | 'terminal'
  | 'eventLimit'
  | 'indeterminateRegimeChange'
  | 'integrationFailed';

export type EventData = Readonly<Record<string, number | string | boolean>>;

export interface SimEvent {
  readonly t: number;
  readonly kind: EventKind;
  /** Constraint, query or string ids involved (the guard's subject first). */
  readonly ids: readonly string[];
  /** Index of the phase that ends (or contains a query hit). */
  readonly phaseBefore: number;
  /** Index of the phase that starts; equals phaseBefore for queries; −1 when the run ends. */
  readonly phaseAfter: number;
  readonly data: EventData;
}

/**
 * Dense output of a phase: step k covers [t0[k], t0[k+1]) (the last one up to the phase's tEnd)
 * and evaluates, with θ = (t − t0[k])/h[k] and θ' = 1 − θ,
 *   y(θ) = r₁ + θ·(r₂ + θ'·(r₃ + θ·(r₄ + θ'·r₅))),   r_i = coeffs[(5k + i − 1)·dim … + dim).
 * A step cut short by an event keeps its h; it is just evaluated for θ < 1.
 */
export interface PhaseSteps {
  readonly t0: Float64Array;
  readonly h: Float64Array;
  readonly coeffs: Float64Array;
}

export interface TrajectoryPhase {
  readonly index: number;
  readonly tStart: number;
  readonly tEnd: number;
  readonly mode: Mode;
  /** State y = [q, v] at tStart, after the event's projection. */
  readonly y0: Float64Array;
  readonly steps: PhaseSteps;
  /** Accelerations and λ constant to 1e-12 relative (checked at start, middle and end). */
  readonly uniform: boolean;
  /** STATICALLY_INDETERMINATE in this mode: some forces are one admissible split. */
  readonly indeterminate: boolean;
}

export interface QueryHit {
  readonly t: number;
  readonly value: number;
}

export interface SimStats {
  /** Accepted integration steps. */
  steps: number;
  rejected: number;
  /** ODE right-hand-side evaluations (each one KKT solve). */
  rhsEvals: number;
  events: number;
  /** Phases started. */
  phases: number;
  /** Largest position correction ‖Δq‖∞ (m) of the drift projection. */
  maxProjection: number;
  /** Largest velocity correction ‖Δv‖∞ (m/s) of the drift projection. */
  maxVelocityProjection: number;
  /** Wall time in ms; set by the caller (the engine cannot read clocks). */
  wallMs?: number;
}

export interface Trajectory {
  /** State dimension, 2·nDof: y = [q, v]. */
  readonly dim: number;
  readonly nDof: number;
  readonly tEnd: number;
  readonly phases: readonly TrajectoryPhase[];
  readonly events: readonly SimEvent[];
  readonly queries: Readonly<Record<string, readonly QueryHit[]>>;
  readonly diagnostics: readonly Diagnostic[];
  readonly endReason: EndReason;
  /** Start of the final at-rest span (all v = 0 and a = 0 exactly), if any. */
  readonly atRestFrom?: number;
  readonly stats: SimStats;
}

export interface SimulateOptions {
  /** Default: the spec's options.horizon. */
  readonly horizon?: number;
  /** Default: options.maxEvents, else 10 000. */
  readonly maxEvents?: number;
  /** Default: options.rtol, else 1e-10. */
  readonly rtol?: number;
  /** Scalar atol; default: options.atol, else 1e-12·L* (positions) and 1e-12·V* (velocities). */
  readonly atol?: number;
  /** Largest step; default T* = L* / V*. */
  readonly hmax?: number;
}
