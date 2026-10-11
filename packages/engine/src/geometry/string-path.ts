/**
 * The path of a string over fixed pulleys: straight tangent segments joined by arcs.
 *
 * Every node of the route is a circle with a signed radius ρ: ends are points (ρ = 0); a pulley
 * of radius r has ρ = +r for a ccw wrap and ρ = −r for cw. With n(d) = (−d_y, d_x), the left
 * normal of a direction d, a ccw wrap keeps the centre on the left of the direction of travel, so
 * the string touches the circle at
 *   T = c − ρ·n(d).
 *
 * Common tangent of nodes A → B (one formula for all four cases: point–point, point–circle,
 * circle–point, circle–circle on the same side (external tangent) or on opposite sides
 * (internal, crossing tangent)). With D = c_B − c_A and Δρ = ρ_B − ρ_A, the tangent points satisfy
 *   T_B − T_A = D − Δρ·n(d) = ℓ·d,  ℓ > 0,
 * i.e. D = ℓ·d + Δρ·n(d): in the orthonormal frame (d, n(d)), D has components (ℓ, Δρ). Hence
 *   ℓ = √(|D|² − Δρ²)   (the tangent exists iff |D| > |Δρ|),
 *   d = (ℓ·D − Δρ·n(D)) / |D|²
 * (check: ℓ·d + Δρ·n(d) = (ℓ²·D + Δρ²·D)/|D|² = D, using n(n(D)) = −D).
 *
 * Wrap angle at a pulley: the turning angle of the direction from the incoming to the outgoing
 * segment, measured in the wrap sense, in [0, 2π). The radius vector T − c = −ρ·n(d) turns with d,
 * so this is also the angle from the incoming to the outgoing tangent point. It stays meaningful
 * for R = 0, where both tangent points are the centre.
 *
 * Length: L = Σ segment lengths + Σ R·wrap angle.
 *
 * The core (`traceString`) writes into preallocated typed arrays and does not allocate, so the
 * constraint evaluation can call it inside the ODE right-hand side; `stringPath` wraps the same
 * core in plain objects for drawing, so the drawing matches the physics exactly.
 */
import type { Vec2, Wrap } from '../spec';

const TWO_PI = 2 * Math.PI;

export interface StringTrace {
  readonly capacity: number;
  /** Number of nodes in use (≥ 2). */
  n: number;
  /** Inputs per node: centre and signed radius (ends: the point and 0). */
  readonly cx: Float64Array;
  readonly cy: Float64Array;
  readonly rho: Float64Array;
  /** Wrap sense per node: +1 ccw, −1 cw, 0 at the ends (kept apart from ρ for R = 0). */
  readonly sense: Int8Array;
  /** Outputs per segment s (node s → node s + 1): tangent points A, B, unit direction d, length. */
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly bx: Float64Array;
  readonly by: Float64Array;
  readonly dx: Float64Array;
  readonly dy: Float64Array;
  readonly len: Float64Array;
  /** Output per node: wrap angle in [0, 2π) at pulleys, 0 at the ends. */
  readonly wrap: Float64Array;
  /** Output: Σ len + Σ |ρ|·wrap. */
  length: number;
  /** −1 after a successful trace; otherwise the first segment whose tangent does not exist. */
  failSegment: number;
}

export function createStringTrace(capacity: number): StringTrace {
  const f = (): Float64Array => new Float64Array(capacity);
  return {
    capacity,
    n: 0,
    cx: f(),
    cy: f(),
    rho: f(),
    sense: new Int8Array(capacity),
    ax: f(),
    ay: f(),
    bx: f(),
    by: f(),
    dx: f(),
    dy: f(),
    len: f(),
    wrap: f(),
    length: NaN,
    failSegment: -1,
  };
}

/** Sets node i of a trace. */
export function setTraceNode(
  tr: StringTrace,
  i: number,
  x: number,
  y: number,
  radius: number,
  sense: -1 | 0 | 1,
): void {
  tr.cx[i] = x;
  tr.cy[i] = y;
  tr.rho[i] = sense * radius;
  tr.sense[i] = sense;
}

/**
 * Computes tangent segments, wrap angles and the length from the node inputs. Returns false (and
 * sets failSegment, length = NaN) when a tangent does not exist: an end inside a pulley, or two
 * pulleys too close for the requested tangent.
 */
export function traceString(tr: StringTrace): boolean {
  const { n, cx, cy, rho } = tr;
  let length = 0;
  for (let s = 0; s < n - 1; s++) {
    const Dx = cx[s + 1] - cx[s];
    const Dy = cy[s + 1] - cy[s];
    const dRho = rho[s + 1] - rho[s];
    const D2 = Dx * Dx + Dy * Dy;
    // ℓ² = |D|² − Δρ². Computed directly, it is exact for dyadic scene coordinates, which keeps
    // axis-aligned textbook segments exactly axis-aligned. (The factored (|D| − |Δρ|)(|D| + |Δρ|)
    // is no better conditioned: |D| itself is rounded.)
    const disc = D2 - dRho * dRho;
    if (!(disc > 0)) {
      tr.failSegment = s;
      tr.length = NaN;
      return false;
    }
    const l = Math.sqrt(disc);
    // d = (ℓ·D − Δρ·n(D))/|D|², n(D) = (−D_y, D_x); for Δρ = 0 simply D/ℓ.
    const dx = dRho === 0 ? Dx / l : (l * Dx + dRho * Dy) / D2;
    const dy = dRho === 0 ? Dy / l : (l * Dy - dRho * Dx) / D2;
    tr.dx[s] = dx;
    tr.dy[s] = dy;
    tr.len[s] = l;
    // T = c − ρ·n(d) = (c_x + ρ·d_y, c_y − ρ·d_x).
    tr.ax[s] = cx[s] + rho[s] * dy;
    tr.ay[s] = cy[s] - rho[s] * dx;
    tr.bx[s] = cx[s + 1] + rho[s + 1] * dy;
    tr.by[s] = cy[s + 1] - rho[s + 1] * dx;
    length += l;
  }
  tr.wrap[0] = 0;
  tr.wrap[n - 1] = 0;
  for (let i = 1; i < n - 1; i++) {
    const w = turnAngle(tr.dx[i - 1], tr.dy[i - 1], tr.dx[i], tr.dy[i], tr.sense[i]);
    tr.wrap[i] = w;
    length += Math.abs(rho[i]) * w;
  }
  tr.length = length;
  tr.failSegment = -1;
  return true;
}

/**
 * Angle from direction (ux, uy) to (vx, vy) measured in the given sense (+1 ccw, −1 cw), in
 * [0, 2π).
 */
export function turnAngle(ux: number, uy: number, vx: number, vy: number, sense: number): number {
  const theta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); // ccw angle in (−π, π]
  const w = sense > 0 ? theta : -theta;
  return w < 0 ? w + TWO_PI : w;
}

// ---------------------------------------------------------------------------------------------
// Plain-object API for drawing and inspection.

export interface PathPulley {
  readonly id?: string;
  readonly center: Vec2;
  readonly radius: number;
  readonly wrap: Wrap;
}

export interface StringSegment {
  readonly from: Vec2;
  readonly to: Vec2;
  /** Unit vector from `from` to `to`. */
  readonly direction: Vec2;
  readonly length: number;
}

export interface StringArc {
  readonly pulley?: string;
  readonly center: Vec2;
  readonly radius: number;
  readonly wrap: Wrap;
  /** Incoming and outgoing tangent points (both the centre when radius = 0). */
  readonly from: Vec2;
  readonly to: Vec2;
  /** Polar angles (atan2, rad) of the radius directions at `from` and `to`. */
  readonly startAngle: number;
  readonly endAngle: number;
  /** Swept angle in the wrap sense, in [0, 2π). */
  readonly angle: number;
}

export type StringPath =
  | {
      readonly ok: true;
      readonly length: number;
      readonly segments: readonly StringSegment[];
      readonly arcs: readonly StringArc[];
    }
  | { readonly ok: false; readonly segment: number; readonly reason: 'tangentMissing' };

/** Loads `start → vias → end` into a trace (capacity ≥ vias.length + 2). */
export function loadTrace(
  tr: StringTrace,
  start: Vec2,
  vias: readonly PathPulley[],
  end: Vec2,
): void {
  tr.n = vias.length + 2;
  setTraceNode(tr, 0, start.x, start.y, 0, 0);
  vias.forEach((p, k) =>
    setTraceNode(tr, k + 1, p.center.x, p.center.y, p.radius, p.wrap === 'ccw' ? 1 : -1),
  );
  setTraceNode(tr, tr.n - 1, end.x, end.y, 0, 0);
}

/** The geometry of a string from `start` over `vias` to `end`, as plain objects. */
export function stringPath(start: Vec2, vias: readonly PathPulley[], end: Vec2): StringPath {
  const tr = createStringTrace(vias.length + 2);
  loadTrace(tr, start, vias, end);
  if (!traceString(tr)) return { ok: false, segment: tr.failSegment, reason: 'tangentMissing' };
  return traceToPath(tr, vias);
}

/** Converts a successful trace into plain objects; `vias` supply ids and wraps for the arcs. */
export function traceToPath(tr: StringTrace, vias: readonly PathPulley[]): StringPath {
  const segments: StringSegment[] = [];
  for (let s = 0; s < tr.n - 1; s++) {
    segments.push({
      from: { x: tr.ax[s], y: tr.ay[s] },
      to: { x: tr.bx[s], y: tr.by[s] },
      direction: { x: tr.dx[s], y: tr.dy[s] },
      length: tr.len[s],
    });
  }
  const arcs: StringArc[] = vias.map((p, k) => {
    const i = k + 1;
    const sense = tr.sense[i];
    // Radius direction u = −sense·n(d) = sense·(d_y, −d_x): the tangent point is c + R·u.
    const startAngle = Math.atan2(-sense * tr.dx[i - 1], sense * tr.dy[i - 1]);
    const endAngle = Math.atan2(-sense * tr.dx[i], sense * tr.dy[i]);
    const arc: StringArc = {
      center: { x: tr.cx[i], y: tr.cy[i] },
      radius: Math.abs(tr.rho[i]),
      wrap: p.wrap,
      from: { x: tr.bx[i - 1], y: tr.by[i - 1] },
      to: { x: tr.ax[i], y: tr.ay[i] },
      startAngle,
      endAngle,
      angle: tr.wrap[i],
    };
    return p.id === undefined ? arc : { pulley: p.id, ...arc };
  });
  return { ok: true, length: tr.length, segments, arcs };
}
