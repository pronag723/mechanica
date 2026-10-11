"""Rounded numbers as printed in the docs. The oracle asserts its exact results against them, which
catches a transcription error in either place. A trailing '…' means the digits shown are truncated;
otherwise the number is rounded to the digits shown."""

from __future__ import annotations

from decimal import Decimal

PRINTED: dict[str, dict[str, dict[str, str]]] = {
    'docs/DESIGN.md §8': {
        't01_atwood': {'a': '1.96', 'T': '23.52', 't_m1_down_1m': '1.0102'},
        't02a_table_frictionless': {'a': '1.96', 'T': '7.84'},
        't02b_table_kinetic': {'a': '0.392', 'T': '9.408'},
        't02c_table_static': {'F_fr': '9.8', 'F_fr_limit': '11.76', 'T': '9.8'},
        't03_load_hits_floor': {
            'a': '1.96',
            'T1': '15.68',
            't_impact': '0.71429',
            'v_impact': '1.4',
            't_stop': '1.42857',
            'path_A': '1.000',
        },
        't14_two_strings': {'T30': '9.8', 'T60': '16.974'},
        't19c_bouncing_block': {'t_rest': '4.06579'},
    },
    'prompts/00-bootstrap.md': {
        't01_atwood': {'a': '1.96', 'T': '23.52', 't_m1_down_1m': '1.01015…'},
        't02b_table_kinetic': {'a': '0.392', 'T': '9.408'},
        't02c_table_static': {'F_fr': '9.8', 'T': '9.8', 'F_fr_limit': '11.76'},
        't03_load_hits_floor': {
            'a': '1.96',
            'T1': '15.68',
            't_impact': '0.714285…',
            'v_impact': '1.4',
            't_stop': '1.428571…',
            'path_A': '1.0',
            'T2': '0',
        },
        't14_two_strings': {'T30': '9.8', 'T60': '16.974…'},
        't19c_bouncing_block': {'t_rest': '4.06578…'},
        'x01_block_slides_to_stop': {'t_stop': '1.020408…', 's_stop': '1.020408…'},
        'x02a_force_below_static': {'F_fr': '-1.5'},
        'x02b_force_above_static': {'a': '1.52'},
        'x03_whirl_slack': {'cos_phi_slack': '-0.557823…', 'v_slack': '2.33809…'},
        'x04_slides_off_table': {
            't_fall': '0.404061…',
            'dx_fall': '0.808122…',
            'v_after_landing': '2.0',
        },
    },
}


def matches_printed(value: float, printed: str) -> bool:
    """True if `printed` is `value` rounded (or, with a trailing '…', truncated) to its digits."""
    shown = Decimal(printed.rstrip('…'))
    unit = Decimal(1).scaleb(shown.as_tuple().exponent)  # one unit in the last digit shown
    exact = Decimal(repr(value))
    if printed.endswith('…'):
        # Truncation toward zero: the value lies in [shown, shown + unit), measured away from zero.
        beyond = exact - shown if shown >= 0 else shown - exact
        return 0 <= beyond < unit
    return abs(exact - shown) <= unit / 2
