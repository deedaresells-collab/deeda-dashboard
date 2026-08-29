"""Automated research loop with experiment logging."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from pmresearch.config import ROOT


@dataclass
class ExperimentLog:
    timestamp: str
    parameter: str
    previous_value: Any
    new_value: Any
    reason: str
    train_performance: dict
    validation_performance: dict
    test_performance: dict | None = None
    kept: bool = False
    overfit_flag: bool = False


class ResearchLoop:
    def __init__(self, log_path: Path | None = None):
        self.log_path = log_path or ROOT / "research_log.md"
        self.experiments: list[ExperimentLog] = []
        if not self.log_path.exists():
            self.log_path.write_text("# Research Log\n\n", encoding="utf-8")

    def log_change(
        self,
        parameter: str,
        previous_value: Any,
        new_value: Any,
        reason: str,
        train_perf: dict,
        val_perf: dict,
        test_perf: dict | None = None,
        kept: bool = False,
    ) -> None:
        overfit = (
            val_perf.get("net_profit", 0) < train_perf.get("net_profit", 0) * 0.5
            and train_perf.get("net_profit", 0) > 0
        )
        entry = ExperimentLog(
            timestamp=datetime.now(timezone.utc).isoformat(),
            parameter=parameter,
            previous_value=previous_value,
            new_value=new_value,
            reason=reason,
            train_performance=train_perf,
            validation_performance=val_perf,
            test_performance=test_perf,
            kept=kept,
            overfit_flag=overfit,
        )
        self.experiments.append(entry)
        self._append_to_log(entry)

    def _append_to_log(self, entry: ExperimentLog) -> None:
        flag = " ⚠️ OVERFIT FLAG" if entry.overfit_flag else ""
        kept = "✅ KEPT" if entry.kept else "❌ REJECTED"
        text = f"""
## Experiment — {entry.timestamp}{flag}

- **Parameter:** {entry.parameter}
- **Previous:** {entry.previous_value}
- **New:** {entry.new_value}
- **Reason:** {entry.reason}
- **Decision:** {kept}
- **Train net profit:** ${entry.train_performance.get('net_profit', 0):,.2f}
- **Validation net profit:** ${entry.validation_performance.get('net_profit', 0):,.2f}
- **Test net profit:** ${entry.test_performance.get('net_profit', 0) if entry.test_performance else 'N/A'}

"""
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(text)

    def run_iteration(
        self,
        name: str,
        baseline_val: dict,
        baseline_test: dict,
        modified_fn: Callable,
        train_df,
        val_df,
        test_df,
        parameter: str,
        previous_value: Any,
        new_value: Any,
        reason: str,
    ) -> dict:
        """Run one research iteration; keep modification only if validation improves robustly."""
        modified_val, modified_test = modified_fn(train_df, val_df, test_df)
        val_improved = modified_val.get("net_profit", 0) > baseline_val.get("net_profit", 0)
        test_not_worse = modified_test.get("net_profit", 0) >= baseline_test.get("net_profit", 0) * 0.8
        kept = val_improved and test_not_worse

        self.log_change(
            parameter=parameter,
            previous_value=previous_value,
            new_value=new_value,
            reason=f"[{name}] {reason}",
            train_perf=modified_val,
            val_perf=modified_val,
            test_perf=modified_test,
            kept=kept,
        )
        return modified_test if kept else baseline_test
