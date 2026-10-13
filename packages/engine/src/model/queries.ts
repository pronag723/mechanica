/**
 * Compiling the spec's queries: parameter checks and references (bodies, strings, contact ids,
 * which exist only after the contacts are built). Queries are sorted by id.
 */
import { type Diagnostic, diagnostic } from '../diagnostics';
import { compareIds } from '../ids';
import type { ModelSpec, QuerySpec } from '../spec';
import type { Constraint } from './types';

export function compileQueries(
  spec: ModelSpec,
  bodies: ReadonlySet<string>,
  constraints: ReadonlyMap<string, Constraint>,
  out: Diagnostic[],
): QuerySpec[] {
  const queries = [...(spec.queries ?? [])].sort((a, b) => compareIds(a.id, b.id));
  for (const qs of queries) {
    const missing = (field: string, ref: string, expected: string): void => {
      out.push(
        diagnostic(
          'UNKNOWN_REFERENCE',
          'error',
          [qs.id],
          { field, ref, expected },
          `Query "${qs.id}": ${field} refers to "${ref}", which is not a ${expected}.`,
        ),
      );
    };
    const bad = (field: string, what: string): void => {
      out.push(
        diagnostic(
          'INVALID_PARAMETER',
          'error',
          [qs.id],
          { field, reason: 'outOfRange' },
          `Query "${qs.id}": ${field} ${what}.`,
        ),
      );
    };
    const p = qs.probe as { kind: string; body?: string; string?: string; contact?: string };
    if (p.body !== undefined && !bodies.has(p.body)) missing('probe.body', p.body, 'body');
    for (const kind of ['string', 'contact'] as const) {
      const id = p[kind];
      if (id !== undefined && constraints.get(id)?.kind !== kind)
        missing(`probe.${kind}`, id, kind);
    }
    if (qs.probe.kind === 'bodyDisplacement' && typeof qs.probe.axis === 'object') {
      const { x, y } = qs.probe.axis;
      if (!(Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x, y) > 0))
        bad('probe.axis', 'must be a finite nonzero vector');
    }
    if (qs.condition.kind === 'equals' && !Number.isFinite(qs.condition.value))
      bad('condition.value', 'must be finite');
  }
  return queries;
}
