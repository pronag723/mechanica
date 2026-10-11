"""Shared pieces of the oracle: exact constants, the Scene/Quantity records, solving helpers,
the formula check and the rounding used for expected.json."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

import sympy as sp

G = sp.Rational(49, 5)  # g = 9.8 m/s^2, kept exact so every derivation stays rational until the end

EXACT = 'exact'  # uniformly accelerated phases: the engine must match to 1e-9 relative
ODE = 'ode'  # needs real ODE integration (curved motion, springs): 1e-7 relative

SIGNIFICANT_DIGITS = 15  # written to expected.json
WORKING_DIGITS = 40  # evaluation precision before rounding


class OracleError(Exception):
    pass


@dataclass(frozen=True)
class Quantity:
    key: str
    derived: sp.Expr  # the result of the derivation, in the scene's given symbols
    formula: str  # closed form for the note; check_formula proves it equals `derived`
    meaning: str
    cls: str = EXACT

    @property
    def note(self) -> str:
        return f'{self.key} = {self.formula}; {self.meaning}'


@dataclass(frozen=True)
class Scene:
    id: str
    givens: dict[sp.Symbol, sp.Expr]  # every symbol a quantity may depend on, with exact values
    quantities: tuple[Quantity, ...]


def require(condition: object, message: str) -> None:
    """Assert a physical consistency condition (evaluated with the givens substituted)."""
    if not bool(condition):
        raise OracleError(message)


def solve_unique(equations: list[sp.Eq], unknowns: list[sp.Symbol]) -> dict[sp.Symbol, sp.Expr]:
    solutions = sp.solve(equations, unknowns, dict=True)
    if len(solutions) != 1 or any(u not in solutions[0] for u in unknowns):
        raise OracleError(f'expected exactly one solution for {unknowns}, got {solutions}')
    return solutions[0]


def positive_root(equation: sp.Eq, unknown: sp.Symbol, givens: dict) -> sp.Expr:
    """The single root of `equation` that is real and positive for the given values."""
    roots = [r for r in sp.solve(equation, unknown) if _is_positive(r, givens)]
    if len(roots) != 1:
        raise OracleError(f'expected one positive root for {unknown} in {equation}, got {roots}')
    return roots[0]


def _is_positive(expr: sp.Expr, givens: dict) -> bool:
    x = expr.subs(givens).evalf(WORKING_DIGITS)
    return bool(x.is_real) and bool(x > 0)


def evaluate(expr: sp.Expr, givens: dict) -> sp.Expr:
    return expr.subs(givens).evalf(WORKING_DIGITS)


def round_significant(x: sp.Expr) -> float:
    """Round a real SymPy number to SIGNIFICANT_DIGITS. The float prints back as the same digits,
    because any decimal with <= 15 significant digits survives a round trip through a double."""
    if not x.is_real:
        raise OracleError(f'value {x} is not real')
    rounded = float(format(Decimal(str(x)), f'.{SIGNIFICANT_DIGITS}g'))
    return rounded + 0.0  # turns -0.0 into 0.0


def perturbed(givens: dict) -> dict:
    """Givens scaled by distinct factors, so a formula that only matches the derivation by
    coincidence at the given numbers (e.g. mu_s where mu_k is meant, when both are 0.2) fails."""
    ordered = sorted(givens, key=lambda s: s.name)
    return {s: givens[s] * (1 + sp.Rational(i + 1, 97)) for i, s in enumerate(ordered)}


def check_formula(scene: Scene, q: Quantity) -> list[str]:
    """The note's formula must parse in the scene's symbols and equal the derivation, both at the
    givens and at perturbed givens. Returns error messages."""
    where = f'{scene.id}.{q.key}'
    symbols = set(scene.givens)
    try:
        parsed = sp.parse_expr(q.formula, local_dict={s.name: s for s in symbols})
    except Exception as exc:  # any parse failure is an oracle error, not a crash
        return [f'{where}: cannot parse formula {q.formula!r}: {exc}']

    errors = []
    if stray := parsed.free_symbols - symbols:
        errors.append(f'{where}: formula uses symbols that are not givens: {stray}')
    if stray := q.derived.free_symbols - symbols:
        errors.append(f'{where}: derivation still depends on non-givens: {stray}')
    if errors:
        return errors

    for point in (scene.givens, perturbed(scene.givens)):
        a = complex(parsed.subs(point).evalf(30))
        b = complex(q.derived.subs(point).evalf(30))
        if abs(a - b) > 1e-12 * max(1.0, abs(b)):
            errors.append(f'{where}: formula {q.formula!r} gives {a}, derivation gives {b}')
            break
    return errors
