/**
 * Force breakdown per body, for free-body diagrams and probes. Constraint forces come from J_iᵀλ_i,
 * split into the normal and friction parts of each contact and into the two ends of each string.
 */
import { contactPoint } from './constraints/contact';
import { loadRoute } from './constraints/string';
import { createStringTrace, traceString } from './geometry/string-path';
import type { KktLayout } from './kkt/assemble';
import type { Model } from './model/types';
import type { Vec2 } from './spec';

export type ForceKind = 'gravity' | 'normal' | 'friction' | 'tension' | 'applied';

export interface ForceContribution {
  readonly body: string;
  readonly kind: ForceKind;
  /** The element or constraint producing it: 'gravity', an applied force id, a string id, a contact id. */
  readonly sourceId: string;
  /** Textbook symbol (engine notation; the UI localizes, e.g. F_fr → F_тр). */
  readonly symbol: string;
  /** Force on the body (N). */
  readonly vector: Vec2;
  /** Application point for drawing: body position, string anchor, or contact point on the face. */
  readonly point: Vec2;
  /** Set when the value is one admissible split of a statically indeterminate system. */
  readonly indeterminate?: true;
}

const vec = (x: number, y: number): Vec2 => ({ x, y });

/**
 * Builds the breakdown from a solved mode. `lambda` and `friction` are per active position
 * (friction = signed tangential force along +t of each active contact, 0 for strings).
 */
export function forceBreakdown(
  model: Model,
  layout: KktLayout,
  q: ArrayLike<number>,
  lambda: Float64Array,
  friction: Float64Array,
  indeterminate: ReadonlySet<number>,
  indeterminateFriction: ReadonlySet<number>,
): ForceContribution[] {
  const out: ForceContribution[] = [];
  const g = model.gravity;
  for (const b of model.bodies) {
    out.push({
      body: b.id,
      kind: 'gravity',
      sourceId: 'gravity',
      symbol: 'mg',
      vector: vec(b.mass * g.x, b.mass * g.y),
      point: vec(q[b.dofX], q[b.dofY]),
    });
  }
  for (const f of model.appliedForces) {
    out.push({
      body: f.body,
      kind: 'applied',
      sourceId: f.id,
      symbol: f.symbol,
      vector: vec(f.force.x, f.force.y),
      point: vec(q[f.dofX], q[f.dofY]),
    });
  }
  const flag = (on: boolean): { indeterminate?: true } => (on ? { indeterminate: true } : {});

  layout.active.forEach((ci, j) => {
    const c = model.constraints[ci];
    const lam = lambda[j];
    if (c.kind === 'string') {
      const tr = createStringTrace(c.nodes.length);
      loadRoute(c.nodes, q, tr);
      if (!traceString(tr)) return;
      const n = tr.n;
      // First end pulled along +d₀ (towards the route), last end along −d_last.
      const ends = [
        { node: c.nodes[0], ux: tr.dx[0], uy: tr.dy[0], px: tr.ax[0], py: tr.ay[0] },
        {
          node: c.nodes[n - 1],
          ux: -tr.dx[n - 2],
          uy: -tr.dy[n - 2],
          px: tr.bx[n - 2],
          py: tr.by[n - 2],
        },
      ];
      for (const e of ends) {
        if (e.node.kind !== 'body') continue;
        out.push({
          body: e.node.body,
          kind: 'tension',
          sourceId: c.id,
          symbol: c.provenance.symbol,
          vector: vec(lam * e.ux, lam * e.uy),
          point: vec(e.px, e.py),
          ...flag(indeterminate.has(j)),
        });
      }
      return;
    }
    const point = contactPoint(c, q);
    out.push({
      body: c.body,
      kind: 'normal',
      sourceId: c.id,
      symbol: c.provenance.symbol,
      vector: vec(lam * c.normal.x, lam * c.normal.y),
      point,
      ...flag(indeterminate.has(j)),
    });
    const sticks = layout.slip[j] === 0;
    if (sticks || c.material.muK !== 0) {
      const ft = friction[j];
      out.push({
        body: c.body,
        kind: 'friction',
        sourceId: c.id,
        symbol: 'F_fr',
        vector: vec(ft * c.tangent.x, ft * c.tangent.y),
        point,
        ...flag(indeterminateFriction.has(j)),
      });
    }
  });
  return out;
}
