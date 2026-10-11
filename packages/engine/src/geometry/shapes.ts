/**
 * Convex shapes with a fixed orientation. Rotation is locked until Phase 6, so a body's vertices
 * relative to its position, R(angle)·v_local, are constants computed once by the compiler.
 */
import type { ShapeSpec, Vec2 } from '../spec';

/** Local vertices of a shape, counter-clockwise. A box w × h is centred on the origin. */
export function shapeVertices(shape: ShapeSpec): Vec2[] {
  if (shape.kind === 'box') {
    const hw = shape.w / 2;
    const hh = shape.h / 2;
    return [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ];
  }
  return shape.vertices.map((v) => ({ x: v.x, y: v.y }));
}

/** R(angle)·v for each vertex. angle = 0 returns the vertices bit-exactly. */
export function rotateVertices(vertices: readonly Vec2[], angle: number): Vec2[] {
  if (angle === 0) return vertices.map((v) => ({ x: v.x, y: v.y }));
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return vertices.map((v) => ({ x: c * v.x - s * v.y, y: s * v.x + c * v.y }));
}

export type PolygonProblem = 'tooFewVertices' | 'notFinite' | 'notCounterClockwise' | 'notConvex';

/**
 * Checks that a polygon is finite, counter-clockwise and strictly convex: every turn
 * cross(e_i, e_{i+1}) is positive beyond rounding. Collinear vertices are rejected, because two
 * collinear faces would make a body sliding across their junction doubly supported.
 */
export function polygonProblem(vertices: readonly Vec2[]): PolygonProblem | null {
  const n = vertices.length;
  if (n < 3) return 'tooFewVertices';
  if (!vertices.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))) return 'notFinite';
  let area2 = 0;
  let scale = 0;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    area2 += a.x * b.y - b.x * a.y;
    scale = Math.max(scale, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }
  if (!(area2 > 0)) return 'notCounterClockwise';
  const tol = 1e-12 * scale * scale;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const c = vertices[(i + 2) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (!(cross > tol)) return 'notConvex';
  }
  return null;
}

/** Outward unit normal of the edge a → b of a counter-clockwise polygon: (e_y, −e_x)/|e|. */
export function outwardNormal(a: Vec2, b: Vec2): Vec2 {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len = Math.sqrt(ex * ex + ey * ey);
  return { x: ey / len, y: (0 - ex) / len }; // 0 − x rather than −x: no −0 in the data
}

/** Tangent of a face with outward normal n: n turned clockwise, t = (n_y, −n_x), so (t, n) is right-handed like (x̂, ŷ). */
export function faceTangent(n: Vec2): Vec2 {
  return { x: n.y, y: 0 - n.x }; // 0 − x rather than −x: no −0 in the data
}

/**
 * The support feature of a convex vertex set (offsets from the body's position) in direction −n:
 * the vertices of least n·v. `depth` = min n·v, so a face with normal n and offset d sees the gap
 * n·p + depth − d. `lo`/`hi` bound the feature's extent along t = faceTangent(n), relative to p:
 * a single vertex gives lo = hi, an edge parallel to the face gives its two ends.
 * Vertices within 1e-9·(shape size) of the minimum count as part of the feature, so a box placed
 * face-aligned on an incline keeps its whole edge despite rounding in sin and cos.
 */
export function supportFeature(
  offsets: readonly Vec2[],
  n: Vec2,
): { depth: number; lo: number; hi: number } {
  const t = faceTangent(n);
  let depth = Infinity;
  let size = 0;
  for (const v of offsets) {
    depth = Math.min(depth, n.x * v.x + n.y * v.y);
    size = Math.max(size, Math.abs(v.x), Math.abs(v.y));
  }
  const tol = 1e-9 * size;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of offsets) {
    if (n.x * v.x + n.y * v.y <= depth + tol) {
      const s = t.x * v.x + t.y * v.y;
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
  }
  return { depth, lo, hi };
}
