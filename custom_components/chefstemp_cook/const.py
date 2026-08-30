"""Constants for ChefsTemp Cook."""

DOMAIN = "chefstemp_cook"

# Config entry
CONF_GRILL_ENTITY = "grill_entity"
CONF_FOOD_ENTITY = "food_entity"     # optional: seeds the first probe
CONF_TARGET = "target_temp"

# Static asset serving + sidebar panel
PANEL_URL_PATH = "chefstemp-cook"
PANEL_TITLE = "Cook"
PANEL_ICON = "mdi:grill"
STATIC_URL = "/chefstemp_cook_static/chefstemp-cook-panel.js"
PANEL_ELEMENT = "chefstemp-cook-panel"

STORAGE_KEY = "chefstemp_cook.state"
STORAGE_VERSION = 2

# Quick timeline actions shown as buttons.
QUICK_EVENTS = [
    {"key": "meat_on", "label": "Meat On", "color": "#4caf50", "icon": "mdi:food-steak"},
    {"key": "wrapped", "label": "Wrapped", "color": "#ff9800", "icon": "mdi:package-variant-closed"},
    {"key": "sauce", "label": "Sauce", "color": "#e91e63", "icon": "mdi:bottle-tonic"},
    {"key": "flip", "label": "Flip", "color": "#00bcd4", "icon": "mdi:flip-horizontal"},
    {"key": "done", "label": "Done", "color": "#2196f3", "icon": "mdi:check-circle"},
]
DEFAULT_CUSTOM_COLOR = "#9e9e9e"

# Distinct colors handed to probes as they're added.
PROBE_COLORS = [
    "#e53935", "#8e24aa", "#3949ab", "#00897b",
    "#c0ca33", "#fb8c00", "#6d4c41", "#546e7a",
]
GRILL_COLOR = "#fb8c00"

# Item presets: default pull target in each unit (chosen by the entity's unit).
ITEM_PRESETS = [
    {"key": "custom", "label": "Custom", "target_f": None, "target_c": None},
    {"key": "steak_mr", "label": "Steak — med-rare", "target_f": 130, "target_c": 54},
    {"key": "steak_med", "label": "Steak — medium", "target_f": 140, "target_c": 60},
    {"key": "burger", "label": "Burger", "target_f": 160, "target_c": 71},
    {"key": "chicken", "label": "Chicken", "target_f": 165, "target_c": 74},
    {"key": "pork", "label": "Pork chop", "target_f": 145, "target_c": 63},
    {"key": "ribs", "label": "Ribs", "target_f": 195, "target_c": 90},
    {"key": "brisket", "label": "Brisket / Pulled pork", "target_f": 203, "target_c": 95},
    {"key": "fish", "label": "Fish", "target_f": 145, "target_c": 63},
    {"key": "pizza", "label": "Pizza (watch grill temp)", "target_f": None, "target_c": None},
]

# Grill hold presets (set the grill target).
GRILL_PRESETS = [
    {"key": "low_slow", "label": "Low & slow", "target_f": 225, "target_c": 107},
    {"key": "roast", "label": "Roasting", "target_f": 350, "target_c": 177},
    {"key": "sear", "label": "Searing / Pizza", "target_f": 500, "target_c": 260},
]
# Default +/- band (in the entity's own unit) for the grill-drift alert.
DEFAULT_GRILL_BAND = 20.0

# HA events fired for automations.
EVENT_TARGET_REACHED = "chefstemp_cook_target_reached"        # a probe hit target
EVENT_GRILL_DRIFT = "chefstemp_cook_grill_drift"              # grill left its band
