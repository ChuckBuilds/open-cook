"""Constants for ChefsTemp Cook."""

DOMAIN = "chefstemp_cook"

# Config entry options
CONF_GRILL_ENTITY = "grill_entity"
CONF_FOOD_ENTITY = "food_entity"
CONF_TARGET = "target_temp"

# Static asset serving + sidebar panel
PANEL_URL_PATH = "chefstemp-cook"          # sidebar route (/chefstemp-cook)
PANEL_TITLE = "Cook"
PANEL_ICON = "mdi:grill"
STATIC_URL = "/chefstemp_cook_static/chefstemp-cook-panel.js"
PANEL_ELEMENT = "chefstemp-cook-panel"

STORAGE_KEY = "chefstemp_cook.state"
STORAGE_VERSION = 1

# Built-in quick actions the app shows as buttons. label + marker color.
QUICK_EVENTS = [
    {"key": "meat_on", "label": "Meat On", "color": "#4caf50", "icon": "mdi:food-steak"},
    {"key": "wrapped", "label": "Wrapped", "color": "#ff9800", "icon": "mdi:package-variant-closed"},
    {"key": "sauce", "label": "Sauce", "color": "#e91e63", "icon": "mdi:bottle-tonic"},
    {"key": "done", "label": "Done", "color": "#2196f3", "icon": "mdi:check-circle"},
]
DEFAULT_CUSTOM_COLOR = "#9e9e9e"

# Fired on the HA event bus when the food probe crosses the target.
EVENT_TARGET_REACHED = "chefstemp_cook_target_reached"
