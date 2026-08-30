"""Cook state: events, target, and the target-reached alert.

State is persisted so a cook survives a restart. One CookManager per config
entry; the frontend panel and the entity platforms all read/drive it.
"""
from __future__ import annotations

import time
from typing import Any, Callable

from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.storage import Store

from .const import (
    CONF_FOOD_ENTITY,
    CONF_GRILL_ENTITY,
    CONF_TARGET,
    DEFAULT_CUSTOM_COLOR,
    DOMAIN,
    EVENT_TARGET_REACHED,
    QUICK_EVENTS,
    STORAGE_KEY,
    STORAGE_VERSION,
)

_QUICK = {e["key"]: e for e in QUICK_EVENTS}


def _now() -> float:
    return time.time()


class CookManager:
    """Holds the active cook: its events, target, and derived state."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self._store: Store = Store(hass, STORAGE_VERSION, f"{STORAGE_KEY}.{entry.entry_id}")
        # persisted state
        self.started_at: float | None = None
        self.events: list[dict[str, Any]] = []   # {ts, key, label, color}
        self.target: float | None = None
        self.target_reached_at: float | None = None
        self._listeners: list[Callable[[], None]] = []
        self._unsub_state: Callable[[], None] | None = None

    # ----- config helpers -----
    @property
    def grill_entity(self) -> str | None:
        return self.entry.options.get(CONF_GRILL_ENTITY) or self.entry.data.get(CONF_GRILL_ENTITY)

    @property
    def food_entity(self) -> str | None:
        return self.entry.options.get(CONF_FOOD_ENTITY) or self.entry.data.get(CONF_FOOD_ENTITY)

    # ----- persistence -----
    async def async_load(self) -> None:
        data = await self._store.async_load()
        if data:
            self.started_at = data.get("started_at")
            self.events = data.get("events", [])
            self.target = data.get("target")
            self.target_reached_at = data.get("target_reached_at")
        if self.target is None:
            cfg = self.entry.options.get(CONF_TARGET, self.entry.data.get(CONF_TARGET))
            self.target = float(cfg) if cfg is not None else None
        self._watch_food()

    async def _async_save(self) -> None:
        await self._store.async_save(
            {
                "started_at": self.started_at,
                "events": self.events,
                "target": self.target,
                "target_reached_at": self.target_reached_at,
            }
        )

    # ----- change notification (drives entities + panel push) -----
    @callback
    def add_listener(self, cb: Callable[[], None]) -> Callable[[], None]:
        self._listeners.append(cb)
        return lambda: self._listeners.remove(cb)

    @callback
    def _notify(self) -> None:
        for cb in list(self._listeners):
            cb()

    async def _changed(self) -> None:
        await self._async_save()
        self._notify()

    # ----- actions -----
    async def async_mark(self, key: str, label: str | None = None,
                         color: str | None = None) -> None:
        """Record an event. `meat_on` starts a fresh cook."""
        if key == "meat_on":
            # fresh cook: clear prior events + rearm alert
            self.started_at = _now()
            self.events = []
            self.target_reached_at = None
        meta = _QUICK.get(key, {})
        self.events.append(
            {
                "ts": _now(),
                "key": key,
                "label": label or meta.get("label", key.replace("_", " ").title()),
                "color": color or meta.get("color", DEFAULT_CUSTOM_COLOR),
            }
        )
        if self.started_at is None:
            self.started_at = self.events[0]["ts"]
        await self._changed()

    async def async_reset(self) -> None:
        self.started_at = None
        self.events = []
        self.target_reached_at = None
        await self._changed()

    async def async_set_target(self, target: float | None) -> None:
        self.target = float(target) if target is not None else None
        self.target_reached_at = None   # rearm
        await self._changed()

    # ----- derived state -----
    @property
    def elapsed_min(self) -> int:
        if not self.started_at:
            return 0
        return int((_now() - self.started_at) / 60)

    @property
    def stage(self) -> str:
        if not self.events:
            return "Idle"
        return self.events[-1]["label"]

    def _food_value(self) -> float | None:
        eid = self.food_entity
        if not eid:
            return None
        st = self.hass.states.get(eid)
        if not st or st.state in ("unknown", "unavailable", "", None):
            return None
        try:
            return float(st.state)
        except (TypeError, ValueError):
            return None

    # ----- target alert -----
    def _watch_food(self) -> None:
        if self._unsub_state:
            self._unsub_state()
            self._unsub_state = None
        eid = self.food_entity
        if eid:
            self._unsub_state = async_track_state_change_event(
                self.hass, [eid], self._on_food_change
            )

    async def _on_food_change(self, event: Event) -> None:
        if self.target is None or self.target_reached_at is not None:
            return
        if not self.started_at:   # only during an active cook
            return
        val = self._food_value()
        if val is None or val < self.target:
            return
        self.target_reached_at = _now()
        await self._changed()
        self.hass.bus.async_fire(
            EVENT_TARGET_REACHED,
            {
                "entry_id": self.entry.entry_id,
                "food_temp": val,
                "target": self.target,
                "elapsed_min": self.elapsed_min,
                "events": self.events,
            },
        )
        # visible fallback so the alert never silently no-ops
        persistent_notification.async_create(
            self.hass,
            f"Food probe reached {val:g}° (target {self.target:g}°), "
            f"{self.elapsed_min} min into the cook.",
            title="🍖 Cook target reached",
            notification_id=f"{DOMAIN}_target_{self.entry.entry_id}",
        )

    def as_dict(self) -> dict[str, Any]:
        """Serializable snapshot for the frontend panel."""
        return {
            "entry_id": self.entry.entry_id,
            "grill_entity": self.grill_entity,
            "food_entity": self.food_entity,
            "started_at": self.started_at,
            "elapsed_min": self.elapsed_min,
            "stage": self.stage,
            "target": self.target,
            "target_reached_at": self.target_reached_at,
            "events": self.events,
            "quick_events": QUICK_EVENTS,
        }

    def unload(self) -> None:
        if self._unsub_state:
            self._unsub_state()
            self._unsub_state = None
