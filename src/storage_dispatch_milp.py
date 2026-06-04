"""MILP dispatch model for PV/wind self-consumption with battery storage.

Battery output convention in results:
- negative value means charging
- positive value means discharging
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import yaml

try:
    import pulp
except ImportError as exc:  # pragma: no cover - helpful runtime message
    raise SystemExit(
        "PuLP is required. Install dependencies with: pip install -r requirements.txt"
    ) from exc


@dataclass(frozen=True)
class StorageConfig:
    capacity_kwh: float
    max_charge_kw: float
    max_discharge_kw: float
    initial_soc_kwh: float
    min_soc_kwh: float = 0.0
    charge_efficiency: float = 0.95
    discharge_efficiency: float = 0.95
    dt_hours: float = 1.0
    export_priority_weight: float = 1000.0
    enforce_terminal_soc: bool = True


def optimize_storage_dispatch(
    pv_kw: Iterable[float],
    wind_kw: Iterable[float],
    load_kw: Iterable[float],
    config: StorageConfig,
) -> list[dict[str, float]]:
    """Find the best storage dispatch schedule.

    Objective:
    1. Minimize grid export energy with a high priority weight.
    2. Then minimize grid import energy.

    This represents maximizing renewable self-consumption first, while still
    preferring less grid import when export energy is already minimized.
    """

    pv = list(pv_kw)
    wind = list(wind_kw)
    load = list(load_kw)
    _validate_inputs(pv, wind, load, config)

    periods = range(len(pv))
    model = pulp.LpProblem("renewable_self_consumption_storage_dispatch", pulp.LpMinimize)

    charge_kw = pulp.LpVariable.dicts("charge_kw", periods, lowBound=0)
    discharge_kw = pulp.LpVariable.dicts("discharge_kw", periods, lowBound=0)
    grid_export_kw = pulp.LpVariable.dicts("grid_export_kw", periods, lowBound=0)
    grid_import_kw = pulp.LpVariable.dicts("grid_import_kw", periods, lowBound=0)
    charge_state = pulp.LpVariable.dicts("charge_state", periods, cat="Binary")
    soc_kwh = pulp.LpVariable.dicts(
        "soc_kwh",
        range(len(pv) + 1),
        lowBound=config.min_soc_kwh,
        upBound=config.capacity_kwh,
    )

    model += soc_kwh[0] == config.initial_soc_kwh, "initial_soc"

    for t in periods:
        renewable_kw = pv[t] + wind[t]

        model += (
            renewable_kw + discharge_kw[t] + grid_import_kw[t]
            == load[t] + charge_kw[t] + grid_export_kw[t]
        ), f"power_balance_{t}"

        model += (
            soc_kwh[t + 1]
            == soc_kwh[t]
            + config.charge_efficiency * charge_kw[t] * config.dt_hours
            - discharge_kw[t] * config.dt_hours / config.discharge_efficiency
        ), f"soc_balance_{t}"

        model += (
            charge_kw[t] <= charge_state[t] * config.max_charge_kw
        ), f"charge_power_limit_{t}"
        model += (
            discharge_kw[t] <= (1 - charge_state[t]) * config.max_discharge_kw
        ), f"discharge_power_limit_{t}"

    if config.enforce_terminal_soc:
        model += soc_kwh[len(pv)] == config.initial_soc_kwh, "terminal_soc"

    model += pulp.lpSum(
        (
            config.export_priority_weight * grid_export_kw[t]
            + grid_import_kw[t]
        )
        * config.dt_hours
        for t in periods
    )

    status = model.solve(pulp.PULP_CBC_CMD(msg=False))
    if pulp.LpStatus[status] != "Optimal":
        raise RuntimeError(f"Optimization failed with status: {pulp.LpStatus[status]}")

    rows: list[dict[str, float]] = []
    for t in periods:
        charge_energy = pulp.value(charge_kw[t]) * config.dt_hours
        discharge_energy = pulp.value(discharge_kw[t]) * config.dt_hours
        rows.append(
            {
                "period": float(t),
                "pv_kwh": pv[t] * config.dt_hours,
                "wind_kwh": wind[t] * config.dt_hours,
                "load_kwh": load[t] * config.dt_hours,
                "battery_energy_kwh": discharge_energy - charge_energy,
                "charge_energy_kwh": charge_energy,
                "discharge_energy_kwh": discharge_energy,
                "soc_start_kwh": pulp.value(soc_kwh[t]),
                "soc_end_kwh": pulp.value(soc_kwh[t + 1]),
                "grid_export_kwh": pulp.value(grid_export_kw[t]) * config.dt_hours,
                "grid_import_kwh": pulp.value(grid_import_kw[t]) * config.dt_hours,
                "is_charging": float(round(pulp.value(charge_state[t]))),
            }
        )

    return rows


def read_timeseries_csv(path: Path) -> tuple[list[float], list[float], list[float]]:
    """Read a CSV containing pv_kw, wind_kw, and load_kw columns."""

    with path.open("r", newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        required = {"pv_kw", "wind_kw", "load_kw"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Missing CSV columns: {', '.join(sorted(missing))}")

        pv_kw: list[float] = []
        wind_kw: list[float] = []
        load_kw: list[float] = []
        for row in reader:
            pv_kw.append(float(row["pv_kw"]))
            wind_kw.append(float(row["wind_kw"]))
            load_kw.append(float(row["load_kw"]))

    return pv_kw, wind_kw, load_kw


def write_results_csv(path: Path, rows: list[dict[str, float]]) -> None:
    if not rows:
        raise ValueError("No result rows to write.")

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def load_run_config(path: Path) -> tuple[Path, Path, StorageConfig]:
    """Load input/output paths and storage parameters from a YAML config file."""

    with path.open("r", encoding="utf-8") as file:
        raw_config = yaml.safe_load(file)

    if not isinstance(raw_config, dict):
        raise ValueError("Config file must contain a YAML object.")

    base_dir = path.parent
    input_csv = _resolve_config_path(base_dir, raw_config.get("input_csv"), "input_csv")
    output_csv = _resolve_config_path(base_dir, raw_config.get("output_csv"), "output_csv")

    storage = raw_config.get("storage", {})
    objective = raw_config.get("objective", {})
    constraints = raw_config.get("constraints", {})
    if not isinstance(storage, dict):
        raise ValueError("Config field 'storage' must be a YAML object.")
    if not isinstance(objective, dict):
        raise ValueError("Config field 'objective' must be a YAML object.")
    if not isinstance(constraints, dict):
        raise ValueError("Config field 'constraints' must be a YAML object.")

    config = StorageConfig(
        capacity_kwh=_required_float(storage, "capacity_kwh"),
        max_charge_kw=_required_float(storage, "max_charge_kw"),
        max_discharge_kw=_required_float(storage, "max_discharge_kw"),
        initial_soc_kwh=_required_float(storage, "initial_soc_kwh"),
        min_soc_kwh=float(storage.get("min_soc_kwh", 0.0)),
        charge_efficiency=float(storage.get("charge_efficiency", 0.95)),
        discharge_efficiency=float(storage.get("discharge_efficiency", 0.95)),
        dt_hours=float(storage.get("dt_hours", 1.0)),
        export_priority_weight=float(objective.get("export_priority_weight", 1000.0)),
        enforce_terminal_soc=bool(constraints.get("enforce_terminal_soc", True)),
    )

    return input_csv, output_csv, config


def _validate_inputs(
    pv_kw: list[float],
    wind_kw: list[float],
    load_kw: list[float],
    config: StorageConfig,
) -> None:
    if not pv_kw or len(pv_kw) != len(wind_kw) or len(pv_kw) != len(load_kw):
        raise ValueError("pv_kw, wind_kw, and load_kw must be non-empty and equal length.")

    numeric_values = [
        config.capacity_kwh,
        config.max_charge_kw,
        config.max_discharge_kw,
        config.dt_hours,
    ]
    if any(value <= 0 for value in numeric_values):
        raise ValueError("Capacity, power limits, and dt_hours must be positive.")

    if not 0 < config.charge_efficiency <= 1:
        raise ValueError("charge_efficiency must be in (0, 1].")
    if not 0 < config.discharge_efficiency <= 1:
        raise ValueError("discharge_efficiency must be in (0, 1].")
    if not config.min_soc_kwh <= config.initial_soc_kwh <= config.capacity_kwh:
        raise ValueError("initial_soc_kwh must be within [min_soc_kwh, capacity_kwh].")
    if any(value < 0 for value in pv_kw + wind_kw + load_kw):
        raise ValueError("Power time series cannot contain negative values.")


def _resolve_config_path(base_dir: Path, value: object, field_name: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError(f"Config field '{field_name}' is required.")

    path = Path(value)
    if not path.is_absolute():
        path = base_dir / path
    return path.resolve()


def _required_float(config: dict[str, object], field_name: str) -> float:
    if field_name not in config:
        raise ValueError(f"Config field 'storage.{field_name}' is required.")
    return float(config[field_name])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Optimize battery dispatch for PV/wind self-consumption."
    )
    parser.add_argument("--config", type=Path, help="YAML config file path.")
    parser.add_argument("--input", type=Path, help="CSV with pv_kw, wind_kw, load_kw columns.")
    parser.add_argument("--output", type=Path, help="Output CSV path.")
    parser.add_argument("--capacity-kwh", type=float)
    parser.add_argument("--max-charge-kw", type=float)
    parser.add_argument("--max-discharge-kw", type=float)
    parser.add_argument("--initial-soc-kwh", type=float)
    parser.add_argument("--min-soc-kwh", default=0.0, type=float)
    parser.add_argument("--charge-efficiency", default=0.95, type=float)
    parser.add_argument("--discharge-efficiency", default=0.95, type=float)
    parser.add_argument("--dt-hours", default=1.0, type=float)
    parser.add_argument("--export-priority-weight", default=1000.0, type=float)
    parser.add_argument(
        "--allow-terminal-soc-change",
        action="store_true",
        help="Do not force final SOC to equal initial SOC.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.config:
        input_csv, output_csv, config = load_run_config(args.config)
    else:
        _validate_cli_args(args)
        input_csv = args.input
        output_csv = args.output
        config = StorageConfig(
            capacity_kwh=args.capacity_kwh,
            max_charge_kw=args.max_charge_kw,
            max_discharge_kw=args.max_discharge_kw,
            initial_soc_kwh=args.initial_soc_kwh,
            min_soc_kwh=args.min_soc_kwh,
            charge_efficiency=args.charge_efficiency,
            discharge_efficiency=args.discharge_efficiency,
            dt_hours=args.dt_hours,
            export_priority_weight=args.export_priority_weight,
            enforce_terminal_soc=not args.allow_terminal_soc_change,
        )

    pv_kw, wind_kw, load_kw = read_timeseries_csv(input_csv)
    rows = optimize_storage_dispatch(pv_kw, wind_kw, load_kw, config)
    write_results_csv(output_csv, rows)


def _validate_cli_args(args: argparse.Namespace) -> None:
    required_fields = [
        "input",
        "output",
        "capacity_kwh",
        "max_charge_kw",
        "max_discharge_kw",
        "initial_soc_kwh",
    ]
    missing = [field for field in required_fields if getattr(args, field) is None]
    if missing:
        missing_options = ", ".join(f"--{field.replace('_', '-')}" for field in missing)
        raise SystemExit(f"Missing required arguments without --config: {missing_options}")


if __name__ == "__main__":
    main()
