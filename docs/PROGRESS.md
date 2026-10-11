# Progress

## Status
| # | Prompt | Done |
|---|---|---|
| 00 | Bootstrap: monorepo, tooling, CI, SymPy oracle | ☑ |
| 01 | Numerics: LU/QR, DOPRI5 with dense output, event location | ☐ |
| 02 | Model spec, constraints, instantaneous KKT solve | ☐ |
| 03 | Hybrid simulator: phases, guards, mode selection, probes, queries | ☐ |
| 04 | Impacts, slack/taut, Zeno, terminal events, CLI (Phase 0 exit) | ☐ |
| 05 | App shell and design system | ☐ |
| 06 | Scene document | ☐ |
| 07 | Editor | ☐ |
| 08 | String tool | ☐ |
| 09 | Simulation and timeline | ☐ |
| 10 | Answers | ☐ |

## Log

### 2026-10-11 · 00 Bootstrap
**Built**
- pnpm workspace (`packages/*`, `apps/*`), `packageManager: pnpm@12.11.2`, `engines.node >= 22.13`
  (the floor ESLint 10 and Vitest 5 need), `.nvmrc` = 22.
- `tsconfig.base.json`: `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `noImplicitReturns`, `verbatimModuleSyntax`, `moduleResolution: bundler`, ES2023, no DOM lib.
  `noUncheckedIndexedAccess` is off. The root `tsconfig.json` covers root config files only.
- `@mech/engine`: `exports` → `./src/index.ts`, `ENGINE_VERSION` plus a smoke test, own `tsconfig.json`
  (`types: []`) and `vitest.config.ts`. Zero runtime dependencies.
- Root scripts: `test` (one Vitest run over the `packages/*` projects), `typecheck` (root config files,
  then `pnpm -r typecheck`), `lint` (`--max-warnings 0`), `format`, `format:check`, `oracle`.
- ESLint flat config: `@eslint/js` + typescript-eslint recommended everywhere, `recommendedTypeChecked`
  (project service) for `packages/**/*.ts`, eslint-config-prettier last.
- **Determinism rule** in `packages/engine`: `no-restricted-globals` (Date, performance) and
  `no-restricted-properties` (Math.random, globalThis.Date, globalThis.performance). Disabling them is
  itself an error outside `*.test.ts` (`@eslint-community/eslint-comments/no-restricted-disable`, which
  also catches a blanket `/* eslint-disable */`). Verified with throwaway probe files: every use in
  source is reported, and a benchmark in a test file opts out with
  `// eslint-disable-next-line no-restricted-globals -- benchmark timing`.
- Prettier: printWidth 100, single quotes, trailing commas. It skips `docs/`, `prompts/`, `CLAUDE.md`
  (hand-written layout) and `tests/scenes/expected.json` (written byte-for-byte by the oracle).
- `.gitattributes` forces LF, so the oracle's output is byte-identical on Windows and in CI.
- CI (`.github/workflows/ci.yml`, ubuntu-latest): pnpm install `--frozen-lockfile`, typecheck, lint,
  test; then Python 3.14, the pinned requirements, `pnpm oracle`, and a check that `expected.json` is
  tracked and unchanged.
- **Oracle** (`tools/oracle/`, see its README): 12 scenes, 52 quantities, all derived in SymPy from
  Newton's laws, energy or the impact law, with exact rational inputs evaluated at 40 digits and
  rounded to 15 significant digits. Three kinds of checks: each note's formula equals the derivation
  (at the givens and at perturbed givens); each regime hypothesis (stick/slip, taut/slack) is tested
  against its inequality; 46 rounded values printed in DESIGN §8 and prompt 00 match. All pass.
  - Repeated runs are byte-identical; a run under a second local Python with SymPy 1.13.1 also gave
    the identical file.
  - `x03.t_slack` (an integral, not in the prompt table) was cross-checked by integrating the
    pendulum ODE with mpmath `odefun`: it agrees to all 15 digits.
  - Keys added beyond the prompt table, because later prompts test them: `t03.a2`,
    `t19c.{t_impact1, v_impact1, v_rebound1, h_bounce1, t_impact2}`, `x01.{a, F_fr, N}`,
    `x02a.{a, N, F_fr_limit}`, `x02b.{F_fr, N}`, `x03.{h_slack, t_slack}`, `x04.vy_landing`.

**Tool versions:** Node 22.22.2, pnpm 12.11.2, TypeScript 6.0.3, Vitest 5.0.3, ESLint 10.12.0,
typescript-eslint 8.71.1, Prettier 3.9.10, Python 3.14.4, SymPy 1.14.0, mpmath 1.3.0. CI actions:
checkout v7, pnpm/action-setup v6, setup-node v7, setup-python v7.

**Version choices**
- TypeScript 6.0, not 7.0: typescript-eslint 8.71 supports TypeScript `< 6.1` only.
- `.nvmrc` pins Node 22 (maintenance LTS), which is what is installed locally. Node 24 is the active LTS.

**Performance:** no engine code yet. `pnpm test` takes about 0.3 s, and `pnpm oracle` about 5 s.

## Deviations from DESIGN.md
- None.

## Follow-ups
- **t19c rest time (prompt 04).** DESIGN §3.5 accepts the engine's Zeno cutoff within 1e-6 s of
  `t19c.t_rest`, but its class is `exact` (1e-9 relative, about 4e-9 s). The regression harness needs a
  per-key tolerance override for this key. Don't loosen the class for the other t19c keys.
- **CLI wall time (prompt 04).** `packages/engine/scripts/sim.ts` must measure wall time, but the
  determinism rule covers all of `packages/engine`, and the opt-out comment is rejected outside
  `*.test.ts`. Add a narrowly scoped override for `packages/engine/scripts/**` in `eslint.config.js`,
  or measure time outside the package.
- **apps/web (prompt 05).** Add `apps/*` to `projects` in the root `vitest.config.ts`, and extend the
  type-aware ESLint block to `apps/**/*.{ts,tsx}` with the DOM globals.
- **TypeScript 7.** Move to it when typescript-eslint supports it.
- **Node 24.** Bump `.nvmrc` to 24 (the active LTS) when convenient; CI follows `.nvmrc`.

## Known issues
- `pnpm oracle` uses the first `python` on PATH. On this machine another Python install with SymPy 1.13.1
  can shadow Python 3.14, depending on PATH order. The output is identical, and the oracle prints which
  interpreter it used and warns when SymPy differs from the pinned version.
