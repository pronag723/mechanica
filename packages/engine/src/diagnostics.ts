/**
 * Diagnostics: the engine reports instead of guessing (DESIGN §3.6). The UI localizes by `code`
 * and `params`; `message` is English for developers.
 */

export type DiagnosticCode =
  // Compile time (compileModel)
  | 'INVALID_ID'
  | 'INVALID_PARAMETER'
  | 'SHAPE_INVALID'
  | 'UNKNOWN_REFERENCE'
  | 'STRING_ROUTE_INVALID'
  | 'STRING_SEGMENT_DEGENERATE'
  | 'PULLEY_WRAP_INVALID'
  | 'STRING_OVERSTRETCHED'
  | 'BODY_PENETRATES_STATIC'
  // Solve time (solveAccelerations)
  | 'STATICALLY_INDETERMINATE'
  | 'MOTION_UNDETERMINED'
  // Run time (simulate)
  | 'INITIAL_VELOCITY_PROJECTED'
  | 'NO_CONSISTENT_MODE'
  | 'MODE_NOT_UNIQUE'
  | 'BOUNDARY_CASE'
  | 'TOO_MANY_CANDIDATES'
  | 'EVENT_LIMIT'
  | 'QUERY_UNSUPPORTED'
  | 'INDETERMINATE_REGIME_CHANGE'
  | 'INTEGRATION_FAILED';

export type Severity = 'error' | 'warning' | 'info';

export type DiagnosticParam = string | number | boolean | readonly string[];

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  /** Ids of the spec elements involved (bodies, statics, pulleys, strings, applied forces). */
  readonly elementIds: readonly string[];
  readonly params: Readonly<Record<string, DiagnosticParam>>;
  readonly message: string;
}

export function diagnostic(
  code: DiagnosticCode,
  severity: Severity,
  elementIds: readonly string[],
  params: Record<string, DiagnosticParam>,
  message: string,
): Diagnostic {
  return { code, severity, elementIds, params, message };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
