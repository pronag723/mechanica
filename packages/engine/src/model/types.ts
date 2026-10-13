/**
 * The compiled mechanical model (DESIGN §3.1–3.2): degrees of freedom, masses and constraint
 * instances. Plain data (typed arrays, Maps), structured-clone safe; behaviour lives in pure
 * functions (constraints/, kkt/, solve.ts).
 */
import type { Material, QuerySpec, SimulationOptions, Vec2, Wrap } from '../spec';

/**
 * Scene scales, defined once and used for every tolerance.
 * - `length` L*: diagonal of the bounding box of all geometry at t₀ (body vertices, pulley discs,
 *   fixed string points, polygon supports, half-plane points); at least 1e-3 m.
 * - `gravity`: |g|.
 * - `velocity` V*: max(√(|g|·L*), max |v₀|); 1 m/s if both are 0.
 * - `force` F*: max(Σ m·|g|, max |F_applied|); 1 N if both are 0.
 * - `time`: L* / V*.
 */
export interface Scales {
  readonly length: number;
  readonly gravity: number;
  readonly velocity: number;
  readonly force: number;
  readonly time: number;
}

/** One coordinate of q. Phase 6 adds θ per body, Phase 2 φ per massive pulley. */
export interface DofInfo {
  readonly kind: 'x' | 'y';
  readonly body: string;
}

export interface ModelBody {
  readonly id: string;
  /** Position in `model.bodies` (sorted by id). */
  readonly index: number;
  readonly symbol: string | undefined;
  readonly mass: number;
  /** Fixed orientation (rad). */
  readonly angle: number;
  readonly dofX: number;
  readonly dofY: number;
  /** World-oriented vertex offsets R(angle)·v_local from the position, counter-clockwise. */
  readonly offsets: readonly Vec2[];
}

export interface ModelPulley {
  readonly id: string;
  readonly center: Vec2;
  readonly radius: number;
}

export interface ModelAppliedForce {
  readonly id: string;
  readonly symbol: string;
  readonly body: string;
  readonly dofX: number;
  readonly dofY: number;
  readonly force: Vec2;
}

/** A node of a compiled string route. Body anchors are world-oriented offsets R(angle)·a_local. */
export type ModelStringNode =
  | {
      readonly kind: 'body';
      readonly body: string;
      readonly dofX: number;
      readonly dofY: number;
      readonly anchor: Vec2;
    }
  | { readonly kind: 'fixed'; readonly point: Vec2 }
  | {
      readonly kind: 'pulley';
      readonly pulley: string;
      readonly center: Vec2;
      readonly radius: number;
      readonly wrap: Wrap;
    };

/** Which element a constraint or force comes from, and its textbook symbol (CLAUDE.md rule 8). */
export interface Provenance {
  readonly elementId: string;
  readonly kind: 'string' | 'contact';
  readonly symbol: string;
}

interface ConstraintBase {
  readonly id: string;
  /** Position in `model.constraints` (sorted by id). */
  readonly index: number;
  /** Phase 0: every constraint is unilateral, g(q) ≥ 0 with multiplier λ ≥ 0. */
  readonly sided: 'unilateral';
  /** g is linear in q (so J is constant and J̇v = 0). */
  readonly linear: boolean;
  readonly provenance: Provenance;
  /** Spec elements involved, for diagnostics. */
  readonly elementIds: readonly string[];
}

/** g = L₀ − L(q) ≥ 0; λ is the tension in N. */
export interface StringConstraint extends ConstraintBase {
  readonly kind: 'string';
  readonly restLength: number;
  readonly nodes: readonly ModelStringNode[];
}

/**
 * Body on a face of a static support: g = n·p + depth − offset ≥ 0, λ is the normal force in N.
 * The face is the line n·x = offset with outward unit normal n and tangent t = (n_y, −n_x).
 * `depth` = min over the body's vertex offsets of n·(R·v), i.e. −h(−n) with h the support function.
 */
export interface ContactConstraint extends ConstraintBase {
  readonly kind: 'contact';
  readonly body: string;
  readonly dofX: number;
  readonly dofY: number;
  readonly staticId: string;
  readonly face: number;
  readonly normal: Vec2;
  readonly tangent: Vec2;
  readonly offset: number;
  readonly depth: number;
  /** Extent along t of the body's support feature in direction −n, relative to t·p. */
  readonly supportLo: number;
  readonly supportHi: number;
  /** Extent of the face along t; ±Infinity for a half-plane. */
  readonly faceLo: number;
  readonly faceHi: number;
  readonly material: Material;
}

export type Constraint = StringConstraint | ContactConstraint;

export interface Model {
  readonly gravity: Vec2;
  readonly scales: Scales;
  /** Sorted by id. */
  readonly bodies: readonly ModelBody[];
  readonly bodyIndex: ReadonlyMap<string, number>;
  readonly pulleys: readonly ModelPulley[];
  readonly appliedForces: readonly ModelAppliedForce[];
  /** Strings and contact candidates, sorted by id. */
  readonly constraints: readonly Constraint[];
  readonly constraintIndex: ReadonlyMap<string, number>;
  readonly nDof: number;
  readonly dofs: readonly DofInfo[];
  /** Diagonal of M per DOF (kg). */
  readonly mass: Float64Array;
  readonly q0: Float64Array;
  readonly v0: Float64Array;
  /** Largest route length over all strings (sizes scratch traces). */
  readonly maxRouteNodes: number;
  /** Event queries, sorted by id (references checked by the compiler). */
  readonly queries: readonly QuerySpec[];
  readonly options: SimulationOptions;
}
