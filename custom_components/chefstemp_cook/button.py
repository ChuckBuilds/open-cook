"""Button entities for the quick cook actions (also usable in automations)."""
from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, QUICK_EVENTS
from .manager import CookManager


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddEntitiesCallback) -> None:
    mgr: CookManager = hass.data[DOMAIN][entry.entry_id]
    entities = [CookActionButton(mgr, entry, e["key"], e["label"], e.get("icon")) for e in QUICK_EVENTS]
    entities.append(CookResetButton(mgr, entry))
    async_add_entities(entities)


def _device(entry: ConfigEntry) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name="ChefsTemp Cook",
        manufacturer="ChefsTemp Cook",
    )


class CookActionButton(ButtonEntity):
    _attr_has_entity_name = True

    def __init__(self, mgr: CookManager, entry: ConfigEntry, key: str,
                 label: str, icon: str | None) -> None:
        self._mgr = mgr
        self._key = key
        self._attr_name = label
        self._attr_icon = icon
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_device_info = _device(entry)

    async def async_press(self) -> None:
        await self._mgr.async_mark(self._key)


class CookResetButton(ButtonEntity):
    _attr_has_entity_name = True
    _attr_name = "Reset Cook"
    _attr_icon = "mdi:restart"

    def __init__(self, mgr: CookManager, entry: ConfigEntry) -> None:
        self._mgr = mgr
        self._attr_unique_id = f"{entry.entry_id}_reset"
        self._attr_device_info = _device(entry)

    async def async_press(self) -> None:
        await self._mgr.async_reset()
