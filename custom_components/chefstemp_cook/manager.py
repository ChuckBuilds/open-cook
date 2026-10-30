"""Cook state (v3): shared grill + independent per-item probes.

Each probe is a self-contained cook item with its own start time, elapsed clock,
event timeline (on/wrap/sauce/flip/done) and target. The grill (temp + target +
drift alert) and free-text notes are shared across the cook. State is persisted.
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


class _CookStore(Store):
    """Store with a migration so bumping STORAGE_VERSION never crashes setup.

    Uses *args so it works whether HA calls the migrator with
    (old_version, data) or (old_major, old_minor, data) — the stored dict is
    always the last argument.
    """

    async def _async_migrate_func(self, *args):  # type: ignore[override]
        data = dict(args[-1] or {})
        # v2 -> v3: the single global "events" list becomes grill-level "notes",
        # and every probe gains its own timeline + start clock.
        if "events" in data and "notes" not in data:
            data["notes"] = data.pop("events")
        for p in data.get("probes", []):
            if isinstance(p, dict):
                p.setdefault("started_at", None)
                p.setdefault("events", [])
                p.setdefault("target_reached_at", None)
        return data


class CookManager:
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self._store = _CookStore(hass, STORAGE_VERSION, f"{STORAGE_KEY}.{entry.entry_id}")
        # persisted
        self.probes: list[dict[str, Any]] = []     # each is a cook item (see _new_probe)
        self.notes: list[dict[str, Any]] = []       # grill-level shared timeline
        self.grill_target: float | None = None
        self.grill_band: float = DEFAULT_GRILL_BAND
        self._grill_alert: str = "ok"
        self._seq: int = 1
        # runtime
        self._listeners: list[Callable[[], None]] = []
        self._unsubs: list[Callable[[], None]] = []

    @property
    def grill_entity(self) -> str | None:
        return self.entry.options.get(CONF_GRILL_ENTITY) or self.entry.data.get(CONF_GRILL_ENTITY)

    def _next_id(self) -> str:
        val = f"i{self._seq}"
        self._seq += 1
        return val

    # ----- persistence + migration -----
    async def async_load(self) -> None:
        data = await self._store.async_load()
        if data:
            self.probes = data.get("probes", [])
            self.notes = data.get("notes", data.get("events", []))   # v2 global events -> notes
            self.grill_target = data.get("grill_target")
            self.grill_band = data.get("grill_band", DEFAULT_GRILL_BAND)
            self._grill_alert = data.get("grill_alert", "ok")
            self._seq = data.get("seq", 1)
        # normalize probes to the v3 shape
        for p in self.probes:
            p.setdefault("started_at", None)
            p.setdefault("events", [])
            p.setdefault("target_reached_at", None)
            p.setdefault("color", PROBE_COLORS[0])
            p.setdefault("item", "custom")
            p.setdefault("readings", [])
        if not self.probes:
            food = self.entry.options.get(CONF_FOOD_ENTITY) or self.entry.data.get(CONF_FOOD_ENTITY)
            if food:
                tgt = self.entry.options.get(CONF_TARGET, self.entry.data.get(CONF_TARGET))
                self.probes.append(self._new_probe("Probe 1", [food], "custom",
                                                   float(tgt) if tgt is not None else None))
        self._rewatch()
        await self._async_save()

    async def _async_save(self) -> None:
        await self._store.async_save({
            "probes": self.probes,
            "notes": self.notes,
            "grill_target": self.grill_target,
            "grill_band": self.grill_band,
            "grill_alert": self._grill_alert,
            "seq": self._seq,
        })

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

    # ----- per-item timeline -----
    def _probe(self, probe_id: str) -> dict[str, Any] | None:
        return next((p for p in self.probes if p["id"] == probe_id), None)

    async def async_item_event(self, probe_id: str, key: str,
                               label: str | None = None) -> None:
        p = self._probe(probe_id)
        if not p:
            return
        if key == "on":
            p["started_at"] = _now()
            p["events"] = []
            p["target_reached_at"] = None
        meta = _QUICK.get(key, {})
        p["events"].append({
            "id": self._next_id(),
            "ts": _now(),
            "key": key,
            "label": label or meta.get("label", key.replace("_", " ").title()),
        })
        p["events"].sort(key=lambda e: e["ts"])
        if p["started_at"] is None:
            p["started_at"] = p["events"][0]["ts"]
        await self._changed()

    async def async_reset_item(self, probe_id: str) -> None:
        p = self._probe(probe_id)
        if p:
            p["started_at"] = None
            p["events"] = []
            p["target_reached_at"] = None
            await self._changed()

    # ----- grill-level notes (shared) -----
    async def async_note(self, label: str, color: str | None = None) -> None:
        self.notes.append({
            "id": self._next_id(),
            "ts": _now(),
            "key": "note",
            "label": label or "Note",
            "color": color or DEFAULT_CUSTOM_COLOR,
        })
        self.notes.sort(key=lambda e: e["ts"])
        await self._changed()

    # ----- edit/delete any event (item timeline or note) -----
    def _all_lists(self) -> list[list[dict[str, Any]]]:
        return [self.notes] + [p["events"] for p in self.probes]

    async def async_edit_event(self, event_id: str, ts: float | None = None,
                               label: str | None = None, color: str | None = None) -> None:
        for lst in self._all_lists():
            for ev in lst:
                if ev["id"] == event_id:
                    if ts is not None:
                        ev["ts"] = float(ts)
                    if label is not None:
                        ev["label"] = label
                    if color is not None:
                        ev["color"] = color
                    lst.sort(key=lambda e: e["ts"])
                    await self._changed()
                    return

    async def async_delete_event(self, event_id: str) -> None:
        self.notes = [e for e in self.notes if e["id"] != event_id]
        for p in self.probes:
            p["events"] = [e for e in p["events"] if e["id"] != event_id]
        await self._changed()

    async def async_reset(self) -> None:
        for p in self.probes:
            p["started_at"] = None
            p["events"] = []
            p["target_reached_at"] = None
        self.notes = []
        self._grill_alert = "ok"
        await self._changed()

    # ----- probes -----
    def _new_probe(self, name: str, readings: list[str], item: str,
                   target: float | None) -> dict[str, Any]:
        return {
            "id": self._next_id(),
            "name": name,
            "item": item or "custom",
            "target": target,
            "color": PROBE_COLORS[len(self.probes) % len(PROBE_COLORS)],
            "readings": [r for r in readings if r],
            "target_reached_at": None,
            "started_at": None,
            "events": [],
        }

    async def async_add_probe(self, name: str, readings: list[str],
                              item: str = "custom", target: float | None = None) -> None:
        self.probes.append(self._new_probe(name or f"Probe {len(self.probes)+1}",
                                           readings, item, target))
        self._rewatch()
        await self._changed()

    async def async_update_probe(self, probe_id: str, **fields: Any) -> None:
        p = self._probe(probe_id)
        if p:
            if fields.get("name") is not None:
                p["name"] = fields["name"]
            if fields.get("item") is not None:
                p["item"] = fields["item"]
            if "target" in fields:
                p["target"] = float(fields["target"]) if fields["target"] is not None else None
                p["target_reached_at"] = None
            if fields.get("readings") is not None:
                p["readings"] = [r for r in fields["readings"] if r]
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

    async def async_set_target(self, target: float | None) -> None:
        if self.probes:
            await self.async_update_probe(self.probes[0]["id"], target=target)

    # ----- derived -----
    @property
    def _any_cooking(self) -> bool:
        return any(p.get("started_at") for p in self.probes)

    @property
    def elapsed_min(self) -> int:
        """Overall elapsed = since the earliest item was put on."""
        starts = [p["started_at"] for p in self.probes if p.get("started_at")]
        return self._elapsed(min(starts)) if starts else 0

    @property
    def stage(self) -> str:
        n = sum(1 for p in self.probes if p.get("started_at"))
        return f"{n} cooking" if n else "Idle"

    def _elapsed(self, started: float | None) -> int:
        return int((_now() - started) / 60) if started else 0

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

    def _unit(self, eid: str | None) -> str | None:
        st = self.hass.states.get(eid) if eid else None
        return st.attributes.get("unit_of_measurement") if st else None

    def _friendly(self, eid: str) -> str:
        st = self.hass.states.get(eid)
        return st.attributes.get("friendly_name", eid) if st else eid

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
            self._unsubs.append(async_track_state_change_event(self.hass, ents, self._on_change))

    async def _on_change(self, event: Event) -> None:
        eid = event.data.get("entity_id")
        # per-item target alerts (only for started items)
        for p in self.probes:
            if not p.get("started_at") or p.get("target") is None or p.get("target_reached_at"):
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
        # grill drift (while any item is cooking)
        if self.grill_target is not None and eid == self.grill_entity and self._any_cooking:
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

    def _fire_probe_alert(self, p: dict[str, Any], val: float) -> None:
        self.hass.bus.async_fire(EVENT_TARGET_REACHED, {
            "entry_id": self.entry.entry_id, "probe_id": p["id"], "probe_name": p["name"],
            "item": p["item"], "food_temp": val, "target": p["target"],
            "elapsed_min": self._elapsed(p.get("started_at")),
        })
        persistent_notification.async_create(
            self.hass,
            f"{p['name']} reached {val:g}° (target {p['target']:g}°), "
            f"{self._elapsed(p.get('started_at'))} min in.",
            title="🍖 Cook target reached",
            notification_id=f"{DOMAIN}_target_{self.entry.entry_id}_{p['id']}",
        )

    def _fire_grill_alert(self, state: str, val: float) -> None:
        self.hass.bus.async_fire(EVENT_GRILL_DRIFT, {
            "entry_id": self.entry.entry_id, "state": state, "grill_temp": val,
            "target": self.grill_target, "band": self.grill_band,
        })
        word = "dropped below" if state == "low" else "spiked above"
        persistent_notification.async_create(
            self.hass,
            f"Grill {word} its band: {val:g}° (target {self.grill_target:g}° ±{self.grill_band:g}°).",
            title="🔥 Grill temp drifting",
            notification_id=f"{DOMAIN}_grill_{self.entry.entry_id}",
        )

    def as_dict(self) -> dict[str, Any]:
        probes = []
        for p in self.probes:
            readings = [
                {"entity": r, "value": self._num(r), "unit": self._unit(r), "name": self._friendly(r)}
                for r in p.get("readings", [])
            ]
            probes.append({**p, "reading_values": readings,
                           "elapsed_min": self._elapsed(p.get("started_at"))})
        starts = [p["started_at"] for p in self.probes if p.get("started_at")]
        return {
            "entry_id": self.entry.entry_id,
            "grill_entity": self.grill_entity,
            "grill_value": self._num(self.grill_entity),
            "grill_unit": self._unit(self.grill_entity),
            "grill_target": self.grill_target,
            "grill_band": self.grill_band,
            "grill_alert": self._grill_alert,
            "overall_elapsed_min": self._elapsed(min(starts)) if starts else 0,
            "any_cooking": self._any_cooking,
            "probes": probes,
            "notes": self.notes,
            "quick_events": QUICK_EVENTS,
            "item_presets": ITEM_PRESETS,
            "grill_presets": GRILL_PRESETS,
        }

    def unload(self) -> None:
        for u in self._unsubs:
            u()
        self._unsubs = []
