/** Version of the engine's public API and Trajectory format; bump it on breaking changes. */
export const ENGINE_VERSION = '0.3.0';

export * from './numeric';

export type * from './spec';
export * from './diagnostics';
export { compareIds, contactId } from './ids';

export * from './geometry/shapes';
export * from './geometry/string-path';

export type * from './model/types';
export { compileModel, GEOMETRY_REL_TOL, type CompileResult } from './model/compile';
export { generalizedForces } from './model/forces';
export { staticFaces, staticSeparation, pairMaterial } from './model/contacts';
export { WRAP_ANGLE_TOL } from './model/strings';

export * from './constraints';
export * from './mode';
export * from './kkt/assemble';
export * from './kkt/solve-system';
export * from './forces';
export * from './solve';
export * from './sim';
