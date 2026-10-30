"""Reset button (per-item actions live in the app panel, not as entities)."""
from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .manager import CookManager


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddEntitiesCallback) -> None:
    mgr: CookManager = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([CookResetButton(mgr, entry)])


class CookResetButton(ButtonEntity):
    _attr_has_entity_name = True
    _attr_name = "Reset Cook"
    _attr_icon = "mdi:restart"

    def __init__(self, mgr: CookManager, entry: ConfigEntry) -> None:
        self._mgr = mgr
        self._attr_unique_id = f"{entry.entry_id}_reset"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Open Cook",
            manufacturer="Open Cook",
        )

    async def async_press(self) -> None:
        await self._mgr.async_reset()
