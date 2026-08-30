"""Cook state: grill + probes, dual targets with alerts, editable timeline.

State is persisted so a cook survives a restart. One CookManager per config
entry; the frontend panel and the entity platforms read/drive it.
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
    DEFAULT_GRILL_BAND,
    DOMAIN,
    EVENT_GRILL_DRIFT,
    EVENT_TARGET_REACHED,
    GRILL_PRESETS,
    ITEM_PRESETS,
    PROBE_COLORS,
    QUICK_EVENTS,
    STORAGE_KEY,
    STORAGE_VERSION,
)

_QUICK = {e["key"]: e for e in QUICK_EVENTS}


def _now() -> float:
    return time.time()


class CookManager:
    """The active cook: grill, probes, timeline, targets."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self._store = Store(hass, STORAGE_VERSION, f"{STORAGE_KEY}.{entry.entry_id}")
        # persisted
        self.started_at: float | None = None
        self.events: list[dict[str, Any]] = []       # {id, ts, key, label, color}
        self.probes: list[dict[str, Any]] = []        # see _new_probe()
        self.grill_target: float | None = None
        self.grill_band: float = DEFAULT_GRILL_BAND
        self._grill_alert: str = "ok"                 # ok|low|high (dedupe)
        self._seq: int = 1
        # runtime
        self._listeners: list[Callable[[], None]] = []
        self._unsubs: list[Callable[[], None]] = []

    # ----- config -----
    @property
    def grill_entity(self) -> str | None:
        return self.entry.options.get(CONF_GRILL_ENTITY) or self.entry.data.get(CONF_GRILL_ENTITY)

    def _next_id(self) -> str:
        val = f"i{self._seq}"
        self._seq += 1
        return val

    # ----- persistence -----
    async def async_load(self) -> None:
        data = await self._store.async_load()
        if data:
            self.started_at = data.get("started_at")
            self.events = data.get("events", [])
            self.probes = data.get("probes", [])
            self.grill_target = data.get("grill_target")
            self.grill_band = data.get("grill_band", DEFAULT_GRILL_BAND)
            self._grill_alert = data.get("grill_alert", "ok")
            self._seq = data.get("seq", 1)
        # seed a first probe from the config's food entity, once
        if not self.probes:
            food = self.entry.options.get(CONF_FOOD_ENTITY) or self.entry.data.get(CONF_FOOD_ENTITY)
            if food:
                tgt = self.entry.options.get(CONF_TARGET, self.entry.data.get(CONF_TARGET))
                self.probes.append(
                    self._new_probe("Probe 1", [food], "custom",
                                    float(tgt) if tgt is not None else None)
                )
        self._rewatch()
        await self._async_save()

    async def _async_save(self) -> None:
        await self._store.async_save(
            {
                "started_at": self.started_at,
                "events": self.events,
                "probes": self.probes,
                "grill_target": self.grill_target,
                "grill_band": self.grill_band,
                "grill_alert": self._grill_alert,
                "seq": self._seq,
            }
        )

    # ----- listeners -----
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

    # ----- timeline events -----
    async def async_mark(self, key: str, label: str | None = None,
                         color: str | None = None) -> None:
        if key == "meat_on":
            self.started_at = _now()
            self.events = []
            for p in self.probes:
                p["target_reached_at"] = None
            self._grill_alert = "ok"
        meta = _QUICK.get(key, {})
        self.events.append(
            {
                "id": self._next_id(),
                "ts": _now(),
                "key": key,
                "label": label or meta.get("label", key.replace("_", " ").title()),
                "color": color or meta.get("color", DEFAULT_CUSTOM_COLOR),
            }
        )
        if self.started_at is None:
            self.started_at = self.events[0]["ts"]
        await self._changed()

    async def async_edit_event(self, event_id: str, ts: float | None = None,
                               label: str | None = None, color: str | None = None) -> None:
        for ev in self.events:
            if ev["id"] == event_id:
                if ts is not None:
                    ev["ts"] = float(ts)
                if label is not None:
                    ev["label"] = label
                if color is not None:
                    ev["color"] = color
                break
        self.events.sort(key=lambda e: e["ts"])
        await self._changed()

    async def async_delete_event(self, event_id: str) -> None:
        self.events = [e for e in self.events if e["id"] != event_id]
        await self._changed()

    async def async_reset(self) -> None:
        self.started_at = None
        self.events = []
        for p in self.probes:
            p["target_reached_at"] = None
        self._grill_alert = "ok"
        await self._changed()

    # ----- probes -----
    def _new_probe(self, name: str, readings: list[str], item: str,
                   target: float | None) -> dict[str, Any]:
        color = PROBE_COLORS[len(self.probes) % len(PROBE_COLORS)]
        return {
            "id": self._next_id(),
            "name": name,
            "item": item or "custom",
            "target": target,
            "color": color,
            "readings": [r for r in readings if r],
            "target_reached_at": None,
        }

    async def async_add_probe(self, name: str, readings: list[str],
                              item: str = "custom", target: float | None = None) -> None:
        self.probes.append(self._new_probe(name or f"Probe {len(self.probes)+1}",
                                           readings, item, target))
        self._rewatch()
        await self._changed()

    async def async_update_probe(self, probe_id: str, **fields: Any) -> None:
        for p in self.probes:
            if p["id"] == probe_id:
                if "name" in fields and fields["name"] is not None:
                    p["name"] = fields["name"]
                if "item" in fields and fields["item"] is not None:
                    p["item"] = fields["item"]
                if "target" in fields:
                    p["target"] = (float(fields["target"])
                                   if fields["target"] is not None else None)
                    p["target_reached_at"] = None
                if "readings" in fields and fields["readings"] is not None:
                    p["readings"] = [r for r in fields["readings"] if r]
                break
        self._rewatch()
        await self._changed()

    async def async_remove_probe(self, probe_id: str) -> None:
        self.probes = [p for p in self.probes if p["id"] != probe_id]
        self._rewatch()
        await self._changed()

    # ----- grill target -----
    async def async_set_grill_target(self, target: float | None,
                                     band: float | None = None) -> None:
        self.grill_target = float(target) if target is not None else None
        if band is not None:
            self.grill_band = float(band)
        self._grill_alert = "ok"
        await self._changed()

    # back-compat: single "set_target" sets the first probe's target
    async def async_set_target(self, target: float | None) -> None:
        if self.probes:
            await self.async_update_probe(self.probes[0]["id"], target=target)

    # ----- derived -----
    @property
    def elapsed_min(self) -> int:
        return int((_now() - self.started_at) / 60) if self.started_at else 0

    @property
    def stage(self) -> str:
        return self.events[-1]["label"] if self.events else "Idle"

    def _num(self, eid: str | None) -> float | None:
        if not eid:
            return None
        st = self.hass.states.get(eid)
        if not st or st.state in ("unknown", "unavailable", "", None):
            return None
        try:
            return float(st.state)
        except (TypeError, ValueError):
            return None

    def _watched_entities(self) -> list[str]:
        ents = set()
        if self.grill_entity:
            ents.add(self.grill_entity)
        for p in self.probes:
            for r in p.get("readings", []):
                ents.add(r)
        return list(ents)

    def _rewatch(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs = []
        ents = self._watched_entities()
        if ents:
            self._unsubs.append(
                async_track_state_change_event(self.hass, ents, self._on_change)
            )

    async def _on_change(self, event: Event) -> None:
        if not self.started_at:
            return
        eid = event.data.get("entity_id")
        # probe target alerts
        for p in self.probes:
            if p.get("target") is None or p.get("target_reached_at"):
                continue
            if not p.get("readings"):
                continue
            val = self._num(p["readings"][0])
            if val is None or val < p["target"]:
                continue
            p["target_reached_at"] = _now()
            await self._async_save()
            self._notify()
            self._fire_probe_alert(p, val)
        # grill drift alert
        if self.grill_target is not None and eid == self.grill_entity:
            g = self._num(self.grill_entity)
            if g is not None:
                state = ("low" if g < self.grill_target - self.grill_band else
                         "high" if g > self.grill_target + self.grill_band else "ok")
                if state != self._grill_alert:
                    self._grill_alert = state
                    await self._async_save()
                    self._notify()
                    if state != "ok":
                        self._fire_grill_alert(state, g)

    def _fire_probe_alert(self, probe: dict[str, Any], val: float) -> None:
        self.hass.bus.async_fire(
            EVENT_TARGET_REACHED,
            {
                "entry_id": self.entry.entry_id,
                "probe_id": probe["id"],
                "probe_name": probe["name"],
                "item": probe["item"],
                "food_temp": val,
                "target": probe["target"],
                "elapsed_min": self.elapsed_min,
                "events": self.events,
            },
        )
        persistent_notification.async_create(
            self.hass,
            f"{probe['name']} reached {val:g}° (target {probe['target']:g}°), "
            f"{self.elapsed_min} min in.",
            title="🍖 Cook target reached",
            notification_id=f"{DOMAIN}_target_{self.entry.entry_id}_{probe['id']}",
        )

    def _fire_grill_alert(self, state: str, val: float) -> None:
        self.hass.bus.async_fire(
            EVENT_GRILL_DRIFT,
            {
                "entry_id": self.entry.entry_id,
                "state": state,
                "grill_temp": val,
                "target": self.grill_target,
                "band": self.grill_band,
            },
        )
        word = "dropped below" if state == "low" else "spiked above"
        persistent_notification.async_create(
            self.hass,
            f"Grill {word} its target band: {val:g}° "
            f"(target {self.grill_target:g}° ±{self.grill_band:g}°).",
            title="🔥 Grill temp drifting",
            notification_id=f"{DOMAIN}_grill_{self.entry.entry_id}",
        )

    def as_dict(self) -> dict[str, Any]:
        probes = []
        for p in self.probes:
            readings = [
                {"entity": r, "value": self._num(r),
                 "unit": self._unit(r), "name": self._friendly(r)}
                for r in p.get("readings", [])
            ]
            probes.append({**p, "reading_values": readings})
        return {
            "entry_id": self.entry.entry_id,
            "grill_entity": self.grill_entity,
            "grill_value": self._num(self.grill_entity),
            "grill_unit": self._unit(self.grill_entity),
            "grill_target": self.grill_target,
            "grill_band": self.grill_band,
            "grill_alert": self._grill_alert,
            "started_at": self.started_at,
            "elapsed_min": self.elapsed_min,
            "stage": self.stage,
            "events": self.events,
            "probes": probes,
            "quick_events": QUICK_EVENTS,
            "item_presets": ITEM_PRESETS,
            "grill_presets": GRILL_PRESETS,
        }

    def _unit(self, eid: str | None) -> str | None:
        st = self.hass.states.get(eid) if eid else None
        return st.attributes.get("unit_of_measurement") if st else None

    def _friendly(self, eid: str) -> str:
        st = self.hass.states.get(eid)
        return st.attributes.get("friendly_name", eid) if st else eid

    def unload(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs = []
