"""ChefsTemp Cook — a cook-timeline app panel for Home Assistant.

Registers a sidebar panel ("Cook") with big action buttons and a heat chart that
overlays your cook events (meat on, wrapped, sauce, custom notes). Backed by a
config entry that points at your grill + food temperature entities.
"""
from __future__ import annotations

import logging
import os

import voluptuous as vol

from homeassistant.components import panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv

from . import websocket_api
from .const import (
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    STATIC_URL,
)
from .manager import CookManager

_LOGGER = logging.getLogger(__name__)
PLATFORMS = ["button", "sensor"]
_GLOBAL = "_global_setup"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    manager = CookManager(hass, entry)
    await manager.async_load()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = manager

    if not hass.data[DOMAIN].get(_GLOBAL):
        hass.data[DOMAIN][_GLOBAL] = True
        await _async_register_panel(hass)
        websocket_api.async_register(hass)
        _async_register_services(hass)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        manager: CookManager = hass.data[DOMAIN].pop(entry.entry_id, None)
        if manager:
            manager.unload()
    return unloaded


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def _async_register_panel(hass: HomeAssistant) -> None:
    js_path = os.path.join(os.path.dirname(__file__), "chefstemp-cook-panel.js")
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL, js_path, False)]
    )
    try:
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=PANEL_ELEMENT,
            module_url=STATIC_URL,
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            require_admin=False,
            config={},
            embed_iframe=False,
        )
    except ValueError:
        # already registered (reload) — fine
        pass


def _manager_for(hass: HomeAssistant, call: ServiceCall) -> CookManager | None:
    entry_id = call.data.get("entry_id")
    managers = {
        k: v for k, v in hass.data.get(DOMAIN, {}).items() if isinstance(v, CookManager)
    }
    if not managers:
        return None
    if entry_id and entry_id in managers:
        return managers[entry_id]
    return next(iter(managers.values()))


def _async_register_services(hass: HomeAssistant) -> None:
    async def _mark(call: ServiceCall) -> None:
        mgr = _manager_for(hass, call)
        if mgr:
            await mgr.async_mark(
                call.data.get("event", "custom"),
                call.data.get("label"),
                call.data.get("color"),
            )

    async def _reset(call: ServiceCall) -> None:
        mgr = _manager_for(hass, call)
        if mgr:
            await mgr.async_reset()

    async def _set_target(call: ServiceCall) -> None:
        mgr = _manager_for(hass, call)
        if mgr:
            await mgr.async_set_target(call.data.get("target"))

    hass.services.async_register(
        DOMAIN, "mark_event", _mark,
        schema=vol.Schema(
            {
                vol.Optional("event", default="custom"): cv.string,
                vol.Optional("label"): cv.string,
                vol.Optional("color"): cv.string,
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )
    hass.services.async_register(
        DOMAIN, "reset", _reset,
        schema=vol.Schema({vol.Optional("entry_id"): cv.string}),
    )
    hass.services.async_register(
        DOMAIN, "set_target", _set_target,
        schema=vol.Schema(
            {
                vol.Required("target"): vol.Coerce(float),
                vol.Optional("entry_id"): cv.string,
            }
        ),
    )
