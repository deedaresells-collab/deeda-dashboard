"""Portfolio circuit breaker."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any


@dataclass
class CircuitBreakerConfig:
    daily_loss_limit_pct: float = 0.05
    max_portfolio_drawdown_pct: float = 0.15
    max_consecutive_losses: int = 10
    auto_restart: bool = False


@dataclass
class CircuitBreakerState:
    config: CircuitBreakerConfig
    initial_capital: float
    peak_equity: float = 0.0
    current_equity: float = 0.0
    daily_pnl: dict[date, float] = field(default_factory=dict)
    consecutive_losses: int = 0
    triggered: bool = False
    trigger_reason: str = ""
    diagnostics: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.peak_equity = self.initial_capital
        self.current_equity = self.initial_capital

    def update_equity(self, equity: float, trade_date: date) -> None:
        self.current_equity = equity
        self.peak_equity = max(self.peak_equity, equity)
        if self.triggered and not self.config.auto_restart:
            return

        drawdown = (equity - self.peak_equity) / self.peak_equity if self.peak_equity > 0 else 0
        if drawdown < -self.config.max_portfolio_drawdown_pct:
            self._trigger("max_portfolio_drawdown", {"drawdown": drawdown})
            return

        day_pnl = self.daily_pnl.get(trade_date, 0.0)
        if day_pnl < -self.config.daily_loss_limit_pct * self.initial_capital:
            self._trigger("daily_loss_limit", {"daily_pnl": day_pnl, "date": str(trade_date)})

    def record_trade(self, pnl: float, trade_date: date) -> None:
        self.daily_pnl[trade_date] = self.daily_pnl.get(trade_date, 0.0) + pnl
        if pnl <= 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0
        if self.consecutive_losses >= self.config.max_consecutive_losses:
            self._trigger("max_consecutive_losses", {"streak": self.consecutive_losses})

    def _trigger(self, reason: str, details: dict) -> None:
        self.triggered = True
        self.trigger_reason = reason
        self.diagnostics.append({"reason": reason, **details})

    def can_trade(self) -> bool:
        return not self.triggered or self.config.auto_restart

    def diagnostic_report(self) -> dict[str, Any]:
        return {
            "triggered": self.triggered,
            "trigger_reason": self.trigger_reason,
            "consecutive_losses": self.consecutive_losses,
            "peak_equity": self.peak_equity,
            "current_equity": self.current_equity,
            "drawdown": (self.current_equity - self.peak_equity) / self.peak_equity if self.peak_equity else 0,
            "daily_pnl": {str(k): v for k, v in self.daily_pnl.items()},
            "diagnostics": self.diagnostics,
        }
