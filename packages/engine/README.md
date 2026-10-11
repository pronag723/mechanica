# @mech/engine

Physics and numerics for the mechanics sandbox: the model, constraints, the KKT solve, DOPRI5 with dense output, events, mode selection and impacts (see `docs/DESIGN.md` §3).

- Zero runtime dependencies. No DOM, no Node APIs in `src/`.
- Deterministic: no `Math.random`, `Date` or `performance.now` (enforced by ESLint). A benchmark inside a `*.test.ts` file may opt out with `// eslint-disable-next-line no-restricted-globals -- benchmark timing`; the opt-out is rejected anywhere else.
- Consumed as TypeScript source: `exports` points at `./src/index.ts`, and there is no build step.

## Scripts

- `pnpm --filter @mech/engine test` runs this package's Vitest suite (`src/**/*.test.ts`, `tests/**/*.test.ts`).
- `pnpm --filter @mech/engine typecheck`

## Public API

_Nothing yet besides `ENGINE_VERSION: string`, the version of the public API and the Trajectory format._
