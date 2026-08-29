#!/usr/bin/env python3
"""Main CLI for prediction-market research platform."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pmresearch.backtests.engine import BacktestEngine
from pmresearch.collectors.demo_data import generate_demo_dataset
from pmresearch.config import ROOT, load_config
from pmresearch.data.loader import load_merged_snapshots
from pmresearch.data.storage import Database
from pmresearch.reports.calibration import calibration_table, edge_bucket_analysis, plot_calibration
from pmresearch.reports.monte_carlo import monte_carlo_monthly, scalability_targets
from pmresearch.reports.summary import generate_results_summary, save_backtest_results


def cmd_generate_demo(args: argparse.Namespace) -> None:
    config = load_config()
    db = Database(config.database_path)
    stats = generate_demo_dataset(db, n_days=args.days, seed=args.seed)
    print(f"Generated demo dataset: {json.dumps(stats, indent=2)}")
    db.close()


def cmd_compare_strategies(args: argparse.Namespace) -> None:
    from pmresearch.backtests.strategy_engine import StrategyBacktestEngine
    from pmresearch.reports.strategy_comparison import build_comparison_report, save_comparison_report

    config = load_config()
    db = Database(config.database_path)

    if db.count_rows("prediction_snapshots") == 0:
        print("No data found. Generating demo dataset...")
        generate_demo_dataset(db, n_days=args.days, seed=args.seed)
        data_type = "SYNTHETIC_DEMO"
    else:
        data_type = args.data_type

    df = load_merged_snapshots(db)
    if df.empty:
        print("ERROR: No merged snapshots available.")
        sys.exit(1)

    print(f"Loaded {len(df)} snapshots")
    engine = StrategyBacktestEngine(config)
    results = engine.run_oos_comparison(df)
    results["data_type"] = data_type

    # Regime distribution on test set
    prepared = engine.prepare_data(df)
    from pmresearch.data.loader import chronological_split
    _, _, test = chronological_split(prepared, train_pct=config.train_pct, val_pct=config.validation_pct)
    if "regime" in test.columns:
        dist = test["regime"].value_counts(normalize=True).to_dict()
        results["regime_distribution"] = {str(k): float(v) for k, v in dist.items()}

    report = build_comparison_report(results, data_type=data_type)
    json_path, md_path = save_comparison_report(report)

    print(f"\nComparison saved to {json_path}")
    print(f"Report: {md_path}")
    print("\n" + "=" * 60)
    print("TERMINAL SUMMARY")
    print("=" * 60)
    print(f"DATASET USED:        {data_type} (synthetic — NOT evidence of edge)")
    print(f"TEST OBSERVATIONS:   {results.get('test_size', 0)}")
    print(f"STRATEGIES TESTED:   {', '.join(results['strategies'].keys())}")
    print("\nTRADES BY STRATEGY / NET RESULTS:")
    for name, m in results["strategies"].items():
        print(f"  {name:18s}  trades={m.get('num_trades', 0):5.0f}  net=${m.get('net_profit', 0):>10,.2f}  max_dd={m.get('max_drawdown', 0):.2%}  sharpe={m.get('sharpe_ratio', 0):.3f}")
    print("\nKNOWN LIMITATIONS:")
    print("  - Synthetic demo data only; no real prediction-market order books")
    print("  - Results validate pipeline, NOT trading edge")
    print("  - Parameter selection must use train/val only, never test set")
    print("\nNEXT REQUIRED DATA:")
    print("  - Historical prediction-market order book snapshots")
    print("  - Real settlement outcomes with synchronized crypto feeds")
    db.close()


def cmd_backtest_regime(args: argparse.Namespace) -> None:
    from pmresearch.backtests.regime_engine import RegimeBacktestRunner
    from pmresearch.data.loader import chronological_split
    from pmresearch.reports.regime_summary import generate_regime_report

    config = load_config()
    db = Database(config.database_path)

    if db.count_rows("prediction_snapshots") == 0:
        print("No data found. Generating demo dataset...")
        generate_demo_dataset(db, n_days=args.days)
        data_type = "SYNTHETIC_DEMO"
    else:
        data_type = args.data_type

    df = load_merged_snapshots(db)
    if df.empty:
        print("ERROR: No merged snapshots available.")
        sys.exit(1)

    print(f"Loaded {len(df)} snapshots for regime backtest")

    runner = RegimeBacktestRunner(config)
    prepared = runner.prepare_data(df)
    _, _, test = chronological_split(prepared, train_pct=config.train_pct, val_pct=config.validation_pct)
    print(f"Test set: {len(test)} snapshots (untouched OOS)")

    results = runner.compare_components(test, split_name="test")
    results["data_type"] = data_type

    out_dir = ROOT / "reports" / "output"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "regime_comparison.json"
    serializable = {k: v for k, v in results.items() if k != "trades"}
    out_path.write_text(json.dumps(serializable, indent=2, default=str), encoding="utf-8")

    report = generate_regime_report(results)
    print(f"\nRegime comparison saved to {out_path}")
    print(f"Report: {ROOT / 'regime_results_summary.md'}")
    print("\n--- OOS Component Comparison ---")
    for name, m in results["components"].items():
        print(f"  {name:25s}  trades={m.get('num_trades', 0):5.0f}  net=${m.get('net_profit', 0):>10,.2f}  sharpe={m.get('sharpe_ratio', 0):.3f}")

    db.close()


def cmd_backtest(args: argparse.Namespace) -> None:
    config = load_config()
    db = Database(config.database_path)

    if db.count_rows("prediction_snapshots") == 0:
        print("No data found. Generating demo dataset...")
        stats = generate_demo_dataset(db, n_days=30)
        print(f"Generated: {stats}")
        data_type = "SYNTHETIC_DEMO"
    else:
        data_type = args.data_type

    df = load_merged_snapshots(db)
    if df.empty:
        print("ERROR: No merged snapshots available.")
        sys.exit(1)

    print(f"Loaded {len(df)} merged snapshots across {df['market_id'].nunique()} markets")

    engine = BacktestEngine(config)
    results = engine.run_full_backtest(df)

    # Calibration on test set prepared data
    prepared = engine.prepare_data(df)
    _, _, test = __import__("pmresearch.data.loader", fromlist=["chronological_split"]).chronological_split(
        prepared, train_pct=config.train_pct, val_pct=config.validation_pct
    )
    # One row per market for calibration (last snapshot before expiry)
    cal_df = test.sort_values("timestamp").groupby("market_id").last().reset_index()
    cal_table = calibration_table(cal_df)
    cal_chart_path = ROOT / "reports" / "output" / "calibration_chart.png"
    plot_calibration(cal_table, cal_chart_path)

    test_trades = results.get("test_trades_a", __import__("pandas").DataFrame())
    edge_df = edge_bucket_analysis(test_trades)
    mc = monte_carlo_monthly(test_trades, n_simulations=config.monte_carlo_simulations)
    scale = scalability_targets(test_trades)

    out_path = save_backtest_results(results)
    summary = generate_results_summary(
        results, cal_table, edge_df, mc, scale, data_type=data_type
    )

    print(f"\nBacktest complete. Results saved to {out_path}")
    print(f"Summary written to {ROOT / 'results_summary.md'}")
    print("\n--- Test Set Highlights (Strategy A) ---")
    test_m = results["strategies"]["A_fair_value"]["test"]
    for k in ["num_trades", "net_profit", "sharpe_ratio", "max_drawdown", "realized_edge"]:
        print(f"  {k}: {test_m.get(k)}")

    db.close()


def cmd_import_crypto(args: argparse.Namespace) -> None:
    from pmresearch.collectors.crypto_exchanges import SYMBOL_MAP, fetch_binance_klines, klines_to_crypto_snapshots

    config = load_config()
    db = Database(config.database_path)
    for asset in args.assets:
        symbol = SYMBOL_MAP.get(asset, f"{asset}USDT")
        print(f"Fetching {symbol} klines...")
        klines = fetch_binance_klines(symbol, interval="1m", limit=args.limit)
        snapshots = klines_to_crypto_snapshots(klines, asset)
        snapshots["snapshot_id"] = range(1, len(snapshots) + 1)
        db.insert_df("crypto_snapshots", snapshots)
        print(f"  Imported {len(snapshots)} snapshots for {asset}")
    db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Prediction Market Research Platform")
    sub = parser.add_subparsers(dest="command")

    gen = sub.add_parser("generate-demo", help="Generate synthetic demo data for pipeline testing")
    gen.add_argument("--days", type=int, default=30)
    gen.add_argument("--seed", type=int, default=42)
    gen.set_defaults(func=cmd_generate_demo)

    bt = sub.add_parser("backtest", help="Run full baseline backtest")
    bt.add_argument("--data-type", default="SYNTHETIC_DEMO", help="Label for data provenance")
    bt.set_defaults(func=cmd_backtest)

    imp = sub.add_parser("import-crypto", help="Import real crypto klines from Binance")
    imp.add_argument("--assets", nargs="+", default=["BTC", "ETH"])
    imp.add_argument("--limit", type=int, default=500)
    imp.set_defaults(func=cmd_import_crypto)

    reg = sub.add_parser("backtest-regime", help="Run regime engine component comparison on OOS data")
    reg.add_argument("--data-type", default="SYNTHETIC_DEMO")
    reg.add_argument("--days", type=int, default=14, help="Demo data days if DB empty")
    reg.set_defaults(func=cmd_backtest_regime)

    cmp = sub.add_parser("compare-strategies", help="Run all 5 strategies through common engine on OOS data")
    cmp.add_argument("--data-type", default="SYNTHETIC_DEMO")
    cmp.add_argument("--days", type=int, default=14)
    cmp.add_argument("--seed", type=int, default=42)
    cmp.set_defaults(func=cmd_compare_strategies)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(0)
    args.func(args)


if __name__ == "__main__":
    main()
