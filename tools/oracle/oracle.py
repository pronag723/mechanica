"""Independent oracle for the engine's regression scenes.

Derives every expected answer symbolically in SymPy (scenes_phase0.py), proves each note's formula
equal to its derivation, checks the results against the rounded numbers printed in the docs
(printed.py), and writes tests/scenes/expected.json:

    { "<scene id>": { "<key>": { "value": 1.96, "class": "exact", "note": "a = ...; meaning" } } }

Scenes are sorted by id; quantities keep their derivation order. Values have 15 significant digits.
`class` is "exact" (relative tolerance 1e-9) or "ode" (1e-7). Run it with `pnpm oracle`. Nothing
is written unless every check passes."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    import sympy
except ImportError:
    sys.exit('oracle: SymPy is missing. Run: python -m pip install -r tools/oracle/requirements.txt')

from common import OracleError, Scene, check_formula, evaluate, round_significant
from printed import PRINTED, matches_printed
from scenes_phase0 import SCENES

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUTPUT = ROOT / 'tests' / 'scenes' / 'expected.json'


def warn_on_version_drift() -> None:
    pinned = re.search(r'^sympy==(\S+)', (HERE / 'requirements.txt').read_text(), re.MULTILINE)
    if pinned and pinned.group(1) != sympy.__version__:
        print(f'oracle: warning: SymPy {sympy.__version__} is installed, '
              f'requirements.txt pins {pinned.group(1)}', file=sys.stderr)


def build(scenes: list[Scene], errors: list[str]) -> dict:
    data: dict[str, dict[str, dict]] = {}
    for scene in sorted(scenes, key=lambda s: s.id):
        if scene.id in data:
            errors.append(f'duplicate scene id {scene.id}')
        entries: dict[str, dict] = {}
        for q in scene.quantities:
            if q.key in entries:
                errors.append(f'{scene.id}: duplicate key {q.key}')
            errors.extend(check_formula(scene, q))
            try:
                value = round_significant(evaluate(q.derived, scene.givens))
            except OracleError as exc:
                errors.append(f'{scene.id}.{q.key}: {exc}')
                continue
            entries[q.key] = {'value': value, 'class': q.cls, 'note': q.note}
        data[scene.id] = entries
    return data


def check_printed(data: dict, errors: list[str]) -> int:
    checked = 0
    for source, scenes in PRINTED.items():
        for scene_id, values in scenes.items():
            for key, printed in values.items():
                entry = data.get(scene_id, {}).get(key)
                if entry is None:
                    errors.append(f'{source}: {scene_id}.{key} is printed but not derived')
                elif not matches_printed(entry['value'], printed):
                    errors.append(f'{source}: {scene_id}.{key} is printed as {printed}, '
                                  f'the oracle derives {entry["value"]!r}')
                checked += 1
    return checked


def main() -> int:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    warn_on_version_drift()

    errors: list[str] = []
    try:
        scenes = [make() for make in SCENES]
    except OracleError as exc:
        print(f'oracle: derivation failed: {exc}', file=sys.stderr)
        return 1
    data = build(scenes, errors)
    checked = check_printed(data, errors)
    if errors:
        print(f'oracle: {len(errors)} check(s) failed; expected.json was not written', file=sys.stderr)
        for message in errors:
            print(f'  - {message}', file=sys.stderr)
        return 1

    text = json.dumps(data, indent=2, ensure_ascii=True) + '\n'
    previous = OUTPUT.read_text(encoding='utf-8') if OUTPUT.exists() else None
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(text, encoding='utf-8', newline='\n')

    quantities = sum(len(entries) for entries in data.values())
    status = 'unchanged' if previous == text else ('created' if previous is None else 'UPDATED')
    print(f'oracle: Python {sys.version.split()[0]} ({sys.executable}), SymPy {sympy.__version__}')
    print(f'oracle: {len(data)} scenes, {quantities} quantities; formulas verified; '
          f'{checked} printed values match the docs')
    print(f'oracle: {OUTPUT.relative_to(ROOT).as_posix()} {status}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
