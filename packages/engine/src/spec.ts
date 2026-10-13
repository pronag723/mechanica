/**
 * ModelSpec: the engine's input. Plain JSON-serializable data in world coordinates, SI units,
 * angles in radians, y axis up (CLAUDE.md, physics rule 1). The scene package compiles user
 * documents into it; tests write it by hand (tests/scenes/engine/*.json).
 *
 * Ids are unique across all element arrays, non-empty, and contain no ':' (derived ids such as
 * contact ids `c:<body>:<static>:<face>` use it as a separator).
 */

/** A point or vector in world (or body-local) coordinates. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Coulomb friction coefficients and Newton's restitution coefficient of a contact pair. */
export interface Material {
  /** Static friction coefficient μs ≥ 0. */
  readonly muS: number;
  /** Kinetic friction coefficient μk ≥ 0. */
  readonly muK: number;
  /** Restitution e ∈ [0, 1] (used from prompt 04). */
  readonly restitution: number;
}

/**
 * A body's shape in its local frame; the body's `position` is the local origin.
 * - `box`: w × h, centred on the origin.
 * - `convexPolygon`: vertices in counter-clockwise order, strictly convex, about the origin.
 */
export type ShapeSpec =
  | { readonly kind: 'box'; readonly w: number; readonly h: number }
  | { readonly kind: 'convexPolygon'; readonly vertices: readonly Vec2[] };

export interface BodySpec {
  readonly id: string;
  /** Textbook symbol for display ("A", "m₁"); optional. */
  readonly symbol?: string;
  /** Mass in kg, ≥ 0. */
  readonly mass: number;
  readonly shape: ShapeSpec;
  /**
   * Orientation in radians (default 0): world vertex = position + R(angle)·local vertex.
   * Rotation is locked until Phase 6, so the angle stays constant during a run.
   */
  readonly angle?: number;
  /** Position of the local origin at t₀. */
  readonly position: Vec2;
  /** Velocity at t₀ (default 0). */
  readonly velocity?: Vec2;
}

/**
 * A fixed support. Its faces are the contact candidates for every body.
 * - `halfPlane`: the solid is { x : normal·(x − point) ≤ 0 }; `normal` points out of the solid
 *   (it is normalized by the compiler). One face, index 0, of infinite extent.
 * - `convexPolygon`: world vertices in counter-clockwise order, strictly convex. Face i runs from
 *   vertex i to vertex i + 1 (mod n); its outward normal is the edge direction turned clockwise.
 */
export type StaticSpec =
  | {
      readonly id: string;
      readonly kind: 'halfPlane';
      readonly point: Vec2;
      readonly normal: Vec2;
      readonly material: Material;
    }
  | {
      readonly id: string;
      readonly kind: 'convexPolygon';
      readonly vertices: readonly Vec2[];
      readonly material: Material;
    };

/** Per-pair material override; `a` and `b` are a body and a static in either order. */
export interface PairOverride {
  readonly a: string;
  readonly b: string;
  readonly muS?: number;
  readonly muK?: number;
  readonly restitution?: number;
}

/** A fixed, massless, frictionless pulley (Phase 0). `radius` may be 0 (a point pulley). */
export interface PulleySpec {
  readonly id: string;
  readonly center: Vec2;
  readonly radius: number;
}

/**
 * Sense in which the string turns around a pulley when its route is traversed from the first end
 * to the last: `ccw` keeps the pulley's centre on the left of the direction of travel, `cw` on the
 * right.
 */
export type Wrap = 'cw' | 'ccw';

export type StringEnd =
  | { readonly kind: 'body'; readonly body: string; readonly anchor: Vec2 /* body-local */ }
  | { readonly kind: 'fixed'; readonly point: Vec2 /* world */ };

export interface StringVia {
  readonly kind: 'pulley';
  readonly pulley: string;
  readonly wrap: Wrap;
}

export type RouteNode = StringEnd | StringVia;

/** A massless inextensible string. It can only pull. */
export interface StringSpec {
  readonly id: string;
  /** Textbook symbol of its tension ("T₁"); default "T". */
  readonly symbol?: string;
  /** `[end, …vias, end]`: at least two ends, pulleys in between. */
  readonly route: readonly RouteNode[];
  /** Natural length in m; default: the geometric length at t₀ (taut). */
  readonly restLength?: number;
}

/** A constant force applied at the body's reference point (Phase 0). */
export interface AppliedForceSpec {
  readonly id: string;
  readonly symbol?: string;
  readonly body: string;
  readonly force: Vec2;
}

export interface SimulationOptions {
  /** End time of the run in s, > 0. */
  readonly horizon: number;
  readonly rtol?: number;
  readonly atol?: number;
  readonly maxEvents?: number;
}

/**
 * A quantity that can be read off a trajectory (probes, graphs, queries). Vectors are taken in
 * world axes; `axis` may name a world axis or give a direction (normalized by the engine).
 * - `bodyDisplacement`: p(t) − p(0) (p(0) after the initial projection); its component along
 *   `axis`, or its length |p(t) − p(0)| when `axis` is omitted.
 * - `bodyPathLength`: ∫|v| dt from 0.
 * - Energies: of one body, or summed over all bodies when `body` is omitted. The potential energy
 *   is gravity's, −m·g·p, zero at the world origin.
 * - `stringTension`, `contactNormal`: the multiplier λ ≥ 0 (0 while inactive).
 * - `contactFriction`: the signed friction force along the face tangent +t (0 while inactive).
 * - `contactRegime`: a numeric code, see CONTACT_REGIME in the simulator.
 */
export type Axis = 'x' | 'y' | Vec2;

export type ProbeRef =
  | { readonly kind: 'bodyPosition'; readonly body: string; readonly component: 'x' | 'y' }
  | { readonly kind: 'bodyDisplacement'; readonly body: string; readonly axis?: Axis }
  | { readonly kind: 'bodyVelocity'; readonly body: string; readonly component: 'x' | 'y' }
  | { readonly kind: 'bodySpeed'; readonly body: string }
  | { readonly kind: 'bodyAcceleration'; readonly body: string; readonly component: 'x' | 'y' }
  | { readonly kind: 'bodyPathLength'; readonly body: string }
  | { readonly kind: 'kineticEnergy'; readonly body?: string }
  | { readonly kind: 'potentialEnergy'; readonly body?: string }
  | { readonly kind: 'totalEnergy'; readonly body?: string }
  | { readonly kind: 'stringTension'; readonly string: string }
  | { readonly kind: 'contactNormal'; readonly contact: string }
  | { readonly kind: 'contactFriction'; readonly contact: string }
  | { readonly kind: 'contactRegime'; readonly contact: string };

/**
 * When the probe equals `value` (optionally only while rising or falling), or when it has a local
 * maximum or minimum. Queries are guards: they record hits and never change the motion.
 */
export type QueryCondition =
  | {
      readonly kind: 'equals';
      readonly value: number;
      readonly direction?: 'rising' | 'falling' | 'any';
    }
  | { readonly kind: 'max' }
  | { readonly kind: 'min' };

export interface QuerySpec {
  readonly id: string;
  readonly probe: ProbeRef;
  readonly condition: QueryCondition;
}

export interface ModelSpec {
  /** Gravitational acceleration, usually { x: 0, y: −9.8 }. */
  readonly gravity: Vec2;
  readonly bodies: readonly BodySpec[];
  readonly statics: readonly StaticSpec[];
  readonly pairOverrides?: readonly PairOverride[];
  readonly pulleys: readonly PulleySpec[];
  readonly strings: readonly StringSpec[];
  readonly appliedForces?: readonly AppliedForceSpec[];
  /** Event queries, evaluated by simulate() (prompt 03). */
  readonly queries?: readonly QuerySpec[];
  readonly options: SimulationOptions;
}
