"""Cook Stage / Cook Elapsed sensors, driven by the manager."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .manager import CookManager


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddEntitiesCallback) -> None:
    mgr: CookManager = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([CookStageSensor(mgr, entry), CookElapsedSensor(mgr, entry)])


def _device(entry: ConfigEntry) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name="ChefsTemp Cook",
        manufacturer="ChefsTemp Cook",
    )


class _Base(SensorEntity):
    _attr_has_entity_name = True

    def __init__(self, mgr: CookManager, entry: ConfigEntry) -> None:
        self._mgr = mgr
        self._attr_device_info = _device(entry)
        self._unsub = None

    async def async_added_to_hass(self) -> None:
        self._unsub = self._mgr.add_listener(self.async_write_ha_state)

    async def async_will_remove_from_hass(self) -> None:
        if self._unsub:
            self._unsub()


class CookStageSensor(_Base):
    _attr_name = "Cook Stage"
    _attr_icon = "mdi:pot-steam-outline"

    def __init__(self, mgr: CookManager, entry: ConfigEntry) -> None:
        super().__init__(mgr, entry)
        self._attr_unique_id = f"{entry.entry_id}_stage"

    @property
    def native_value(self) -> str:
        return self._mgr.stage


class CookElapsedSensor(_Base):
    _attr_name = "Cook Elapsed"
    _attr_icon = "mdi:timer-outline"
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, mgr: CookManager, entry: ConfigEntry) -> None:
        super().__init__(mgr, entry)
        self._attr_unique_id = f"{entry.entry_id}_elapsed"

    @property
    def native_value(self) -> int:
        return self._mgr.elapsed_min
