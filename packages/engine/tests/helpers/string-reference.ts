/**
 * An independent, angle-based construction of a string's path (test-only), to cross-check the
 * engine's vector formula. A common tangent from a circle with signed radius ρ_A to one with ρ_B
 * has direction angle atan2(D) − asin(Δρ/|D|) and length |D|·cos(asin(Δρ/|D|)); the wrap is the
 * difference of consecutive direction angles in the wrap sense, reduced to [0, 2π).
 */
import type { PathPulley } from '../../src/geometry/string-path';
import type { Vec2 } from '../../src/spec';

export interface ReferencePath {
  length: number;
  segmentLengths: number[];
  wraps: number[];
}

export function referencePath(start: Vec2, vias: readonly PathPulley[], end: Vec2): ReferencePath {
  const nodes = [
    { c: start, rho: 0, sense: 0 },
    ...vias.map((p) => {
      const sense = p.wrap === 'ccw' ? 1 : -1;
      return { c: p.center, rho: sense * p.radius, sense };
    }),
    { c: end, rho: 0, sense: 0 },
  ];
  const angles: number[] = [];
  const segmentLengths: number[] = [];
  for (let s = 0; s < nodes.length - 1; s++) {
    const Dx = nodes[s + 1].c.x - nodes[s].c.x;
    const Dy = nodes[s + 1].c.y - nodes[s].c.y;
    const dist = Math.hypot(Dx, Dy);
    const beta = Math.asin((nodes[s + 1].rho - nodes[s].rho) / dist);
    angles.push(Math.atan2(Dy, Dx) - beta);
    segmentLengths.push(dist * Math.cos(beta));
  }
  const wraps: number[] = [];
  let length = segmentLengths.reduce((a, b) => a + b, 0);
  for (let i = 1; i < nodes.length - 1; i++) {
    const turn = nodes[i].sense * (angles[i] - angles[i - 1]);
    const w = ((turn % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    wraps.push(w);
    length += Math.abs(nodes[i].rho) * w;
  }
  return { length, segmentLengths, wraps };
}
