/** Scene scales (see `Scales` in types.ts for the definitions). */
import type { ModelSpec, Vec2 } from '../spec';
import type { ModelBody, Scales } from './types';

const MIN_LENGTH = 1e-3;

export function computeScales(
  spec: ModelSpec,
  bodies: readonly ModelBody[],
  q0: Float64Array,
): Scales {
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  const add = (x: number, y: number, r = 0): void => {
    xmin = Math.min(xmin, x - r);
    xmax = Math.max(xmax, x + r);
    ymin = Math.min(ymin, y - r);
    ymax = Math.max(ymax, y + r);
  };
  for (const b of bodies) {
    for (const o of b.offsets) add(q0[b.dofX] + o.x, q0[b.dofY] + o.y);
  }
  for (const p of spec.pulleys) add(p.center.x, p.center.y, p.radius);
  for (const s of spec.strings) {
    for (const node of s.route) if (node.kind === 'fixed') add(node.point.x, node.point.y);
  }
  for (const s of spec.statics) {
    const points: readonly Vec2[] = s.kind === 'halfPlane' ? [s.point] : s.vertices;
    for (const p of points) add(p.x, p.y);
  }
  const diag = xmin <= xmax ? Math.hypot(xmax - xmin, ymax - ymin) : 0;
  const length = Math.max(diag, MIN_LENGTH);

  const gravity = Math.hypot(spec.gravity.x, spec.gravity.y);
  let vmax = 0;
  for (const b of spec.bodies) {
    if (b.velocity) vmax = Math.max(vmax, Math.hypot(b.velocity.x, b.velocity.y));
  }
  const velocity = Math.max(Math.sqrt(gravity * length), vmax) || 1;

  let weight = 0;
  for (const b of spec.bodies) weight += b.mass * gravity;
  let fmax = 0;
  for (const f of spec.appliedForces ?? []) fmax = Math.max(fmax, Math.hypot(f.force.x, f.force.y));
  const force = Math.max(weight, fmax) || 1;

  return { length, gravity, velocity, force, time: length / velocity };
}
