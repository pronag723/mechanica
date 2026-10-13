/** The hybrid simulator (prompt 03): simulate(), the Trajectory, probes, queries, mode selection. */
export type * from './types';
export { simulate } from './simulate';
export { simTolerances, type SimTolerances } from './tolerances';
export { stateAt, phaseAt, forcesAt, probeValue, sampleProbe } from './trajectory';
export type { Side, TrajectoryState, ProbeSamples } from './trajectory';
export { CONTACT_REGIME, evalProbe, evalProbeRate, probeHasRate } from './probes';
export type { ProbeForces, ProbeState } from './probes';
export {
  selectMode,
  enumerateCombinations,
  type CandidateState,
  type ModeCandidate,
  type ModeProblem,
  type ModeSelection,
  type ModeSolve,
  type NullDirection,
  type SelectionStatus,
  type ValidMode,
} from './mode-select';
export { linearFeasible } from './feasibility';
export { findCandidates, selectModelMode, modeIsFeasible, type Candidate } from './model-modes';
