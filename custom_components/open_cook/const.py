"""Constants for Open Cook."""

DOMAIN = "open_cook"

# Config entry
CONF_GRILL_ENTITY = "grill_entity"
CONF_FOOD_ENTITY = "food_entity"     # optional: seeds the first probe
CONF_TARGET = "target_temp"

# Static asset serving + sidebar panel
PANEL_URL_PATH = "open-cook"
PANEL_TITLE = "Cook"
PANEL_ICON = "mdi:grill"
STATIC_URL = "/open_cook_static/open-cook-panel.js"
PANEL_ELEMENT = "open-cook-panel"

STORAGE_KEY = "open_cook.state"
STORAGE_VERSION = 3

# Per-item timeline actions shown as buttons on each probe card. "on" starts
# (or restarts) that item's clock and clears its own timeline.
QUICK_EVENTS = [
    {"key": "on", "label": "On", "icon": "mdi:play"},
    {"key": "wrapped", "label": "Wrap", "icon": "mdi:package-variant-closed"},
    {"key": "sauce", "label": "Sauce", "icon": "mdi:bottle-tonic"},
    {"key": "flip", "label": "Flip", "icon": "mdi:flip-horizontal"},
    {"key": "done", "label": "Done", "icon": "mdi:check-circle"},
]
DEFAULT_CUSTOM_COLOR = "#9e9e9e"   # grill-level notes

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
EVENT_TARGET_REACHED = "open_cook_target_reached"        # a probe hit target
EVENT_GRILL_DRIFT = "open_cook_grill_drift"              # grill left its band
