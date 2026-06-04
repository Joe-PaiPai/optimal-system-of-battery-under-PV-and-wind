from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from storage_dispatch_milp import StorageConfig, optimize_storage_dispatch, read_timeseries_csv, write_results_csv


def main() -> None:
    pv_kw, wind_kw, load_kw = read_timeseries_csv(ROOT / "examples" / "sample_timeseries.csv")
    config = StorageConfig(
        capacity_kwh=100,
        max_charge_kw=50,
        max_discharge_kw=50,
        initial_soc_kwh=50,
        min_soc_kwh=10,
        charge_efficiency=0.95,
        discharge_efficiency=0.95,
        dt_hours=1,
    )
    rows = optimize_storage_dispatch(pv_kw, wind_kw, load_kw, config)
    output = ROOT / "examples" / "sample_result.csv"
    write_results_csv(output, rows)

    for row in rows:
        print(
            f"period={int(row['period'])}, "
            f"battery_energy_kwh={row['battery_energy_kwh']:.3f}, "
            f"soc_end_kwh={row['soc_end_kwh']:.3f}, "
            f"grid_export_kwh={row['grid_export_kwh']:.3f}, "
            f"grid_import_kwh={row['grid_import_kwh']:.3f}"
        )
    print(f"Saved result to {output}")


if __name__ == "__main__":
    main()

