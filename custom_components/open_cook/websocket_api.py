"""WebSocket API the frontend panel uses to read cook state and subscribe."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .manager import CookManager


def _managers(hass: HomeAssistant) -> dict[str, CookManager]:
    return {
        k: v for k, v in hass.data.get(DOMAIN, {}).items() if isinstance(v, CookManager)
    }


def _pick(hass: HomeAssistant, entry_id: str | None) -> CookManager | None:
    mgrs = _managers(hass)
    if not mgrs:
        return None
    if entry_id and entry_id in mgrs:
        return mgrs[entry_id]
    return next(iter(mgrs.values()))


@callback
def async_register(hass: HomeAssistant) -> None:
    if hass.data.get(f"{DOMAIN}_ws_registered"):
        return
    hass.data[f"{DOMAIN}_ws_registered"] = True
    websocket_api.async_register_command(hass, ws_get)
    websocket_api.async_register_command(hass, ws_subscribe)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "open_cook/get",
        vol.Optional("entry_id"): str,
    }
)
@callback
def ws_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
           msg: dict[str, Any]) -> None:
    mgr = _pick(hass, msg.get("entry_id"))
    if mgr is None:
        connection.send_error(msg["id"], "not_found", "No Open Cook configured")
        return
    connection.send_result(msg["id"], mgr.as_dict())


@websocket_api.websocket_command(
    {
        vol.Required("type"): "open_cook/subscribe",
        vol.Optional("entry_id"): str,
    }
)
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                 msg: dict[str, Any]) -> None:
    mgr = _pick(hass, msg.get("entry_id"))
    if mgr is None:
        connection.send_error(msg["id"], "not_found", "No Open Cook configured")
        return

    @callback
    def _push() -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], mgr.as_dict())
        )

    remove = mgr.add_listener(_push)
    connection.subscriptions[msg["id"]] = remove
    connection.send_result(msg["id"])
    _push()   # send initial snapshot
