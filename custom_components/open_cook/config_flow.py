"""Config + options flow: pick the grill and food temperature entities."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import CONF_FOOD_ENTITY, CONF_GRILL_ENTITY, CONF_TARGET, DOMAIN

_TEMP_SELECTOR = selector.EntitySelector(
    selector.EntitySelectorConfig(domain="sensor", device_class="temperature")
)


def _schema(defaults: dict[str, Any]) -> vol.Schema:
    # Everything is optional: you can create the entry with nothing chosen and
    # pick the grill sensor (and add probes) inside the app afterwards.
    def _opt(key):
        cur = defaults.get(key)
        return vol.Optional(key, description={"suggested_value": cur}) if cur else vol.Optional(key)

    return vol.Schema(
        {
            _opt(CONF_GRILL_ENTITY): _TEMP_SELECTOR,
            _opt(CONF_FOOD_ENTITY): _TEMP_SELECTOR,
            vol.Optional(CONF_TARGET, default=defaults.get(CONF_TARGET, 95)): selector.NumberSelector(
                selector.NumberSelectorConfig(min=0, max=600, step=1, mode="box")
            ),
        }
    )


class ChefsTempCookConfigFlow(ConfigFlow, domain=DOMAIN):
    """Initial setup."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            return self.async_create_entry(title="Cook", data=user_input)
        return self.async_show_form(step_id="user", data_schema=_schema({}))

    @staticmethod
    @callback
    def async_get_options_flow(entry: ConfigEntry) -> "ChefsTempCookOptionsFlow":
        return ChefsTempCookOptionsFlow(entry)


class ChefsTempCookOptionsFlow(OptionsFlow):
    """Let the user re-pick entities / default target later."""

    def __init__(self, entry: ConfigEntry) -> None:
        self.entry = entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)
        current = {**self.entry.data, **self.entry.options}
        return self.async_show_form(step_id="init", data_schema=_schema(current))
