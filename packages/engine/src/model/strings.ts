/** Compiling strings: route nodes, the geometry check at t₀ and the rest length. */
import { type Diagnostic, diagnostic } from '../diagnostics';
import { createStringTrace, traceString } from '../geometry/string-path';
import { loadRoute } from '../constraints/string';
import type { ModelSpec, StringSpec } from '../spec';
import type { ModelBody, ModelStringNode, StringConstraint } from './types';

const TWO_PI = 2 * Math.PI;
/** A wrap angle closer than this to 0 or 2π is degenerate (rad). */
export const WRAP_ANGLE_TOL = 1e-9;

export function compileRoute(
  s: StringSpec,
  spec: ModelSpec,
  bodies: readonly ModelBody[],
  bodyIndex: ReadonlyMap<string, number>,
): ModelStringNode[] {
  return s.route.map((node): ModelStringNode => {
    if (node.kind === 'body') {
      const b = bodies[bodyIndex.get(node.body) ?? -1];
      const c = Math.cos(b.angle);
      const sn = Math.sin(b.angle);
      const a = node.anchor;
      const anchor =
        b.angle === 0 ? { x: a.x, y: a.y } : { x: c * a.x - sn * a.y, y: sn * a.x + c * a.y };
      return { kind: 'body', body: b.id, dofX: b.dofX, dofY: b.dofY, anchor };
    }
    if (node.kind === 'fixed')
      return { kind: 'fixed', point: { x: node.point.x, y: node.point.y } };
    const p = spec.pulleys.find((x) => x.id === node.pulley);
    if (!p) throw new Error(`compileRoute: unknown pulley "${node.pulley}" (validate first)`);
    return {
      kind: 'pulley',
      pulley: p.id,
      center: { x: p.center.x, y: p.center.y },
      radius: p.radius,
      wrap: node.wrap,
    };
  });
}

const nodeElement = (node: ModelStringNode): string[] =>
  node.kind === 'body' ? [node.body] : node.kind === 'pulley' ? [node.pulley] : [];

/**
 * Builds the string constraint and checks its geometry at q₀: every tangent exists, no segment is
 * shorter than `lenTol`, no wrap angle is within WRAP_ANGLE_TOL of 0 or 2π, and the string is not
 * longer than its rest length.
 */
export function compileString(
  s: StringSpec,
  nodes: ModelStringNode[],
  q0: Float64Array,
  lenTol: number,
  diagnostics: Diagnostic[],
): Omit<StringConstraint, 'index'> | null {
  const tr = createStringTrace(nodes.length);
  loadRoute(nodes, q0, tr);
  const ok = traceString(tr);
  let valid = true;
  if (!ok) {
    const k = tr.failSegment;
    const ids = [s.id, ...nodeElement(nodes[k]), ...nodeElement(nodes[k + 1])];
    if (tr.rho[k] === 0 && tr.rho[k + 1] === 0) {
      diagnostics.push(
        diagnostic(
          'STRING_SEGMENT_DEGENERATE',
          'error',
          ids,
          { segment: k, length: 0 },
          `String "${s.id}": segment ${k} has zero length at t₀.`,
        ),
      );
    } else {
      diagnostics.push(
        diagnostic(
          'PULLEY_WRAP_INVALID',
          'error',
          ids,
          { segment: k, reason: 'tangentMissing' },
          `String "${s.id}": segment ${k} has no tangent with the requested wrap sides ` +
            '(an end inside a pulley, or pulleys too close).',
        ),
      );
    }
    return null;
  }
  for (let k = 0; k < tr.n - 1; k++) {
    if (tr.len[k] < lenTol) {
      valid = false;
      diagnostics.push(
        diagnostic(
          'STRING_SEGMENT_DEGENERATE',
          'error',
          [s.id, ...nodeElement(nodes[k]), ...nodeElement(nodes[k + 1])],
          { segment: k, length: tr.len[k] },
          `String "${s.id}": segment ${k} is degenerate (length ${tr.len[k].toExponential(3)} m) at t₀.`,
        ),
      );
    }
  }
  for (let i = 1; i < tr.n - 1; i++) {
    const w = tr.wrap[i];
    if (w < WRAP_ANGLE_TOL || w > TWO_PI - WRAP_ANGLE_TOL) {
      valid = false;
      diagnostics.push(
        diagnostic(
          'PULLEY_WRAP_INVALID',
          'error',
          [s.id, ...nodeElement(nodes[i])],
          { node: i, reason: w < Math.PI ? 'wrapZero' : 'wrapFull', angle: w },
          `String "${s.id}": the wrap angle at node ${i} is ${w} rad; it must be strictly ` +
            'between 0 and 2π (the string only touches the pulley, or overlaps itself).',
        ),
      );
    }
  }
  const length = tr.length;
  const restLength = s.restLength ?? length;
  if (length - restLength > lenTol) {
    valid = false;
    diagnostics.push(
      diagnostic(
        'STRING_OVERSTRETCHED',
        'error',
        [s.id],
        { length, restLength },
        `String "${s.id}" is ${length} m long at t₀ but its rest length is ${restLength} m.`,
      ),
    );
  }
  if (!valid) return null;
  return {
    kind: 'string',
    id: s.id,
    sided: 'unilateral',
    linear: false,
    provenance: { elementId: s.id, kind: 'string', symbol: s.symbol ?? 'T' },
    elementIds: [s.id],
    restLength,
    nodes,
  };
}
