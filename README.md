# ChefsTemp Cook

A cook-timeline **app** for Home Assistant. Adds a **Cook** page to the sidebar
with big action buttons — Meat On, Wrapped, Sauce, Done, plus free-text notes —
and a live **heat chart** that overlays every action as a labelled marker, so you
can see exactly when you wrapped or spritzed against the temperature curve. Get a
push alert when the food probe hits your pull temperature.

Works with any temperature sensors — pair it with the grill and food entities
from the [chefstemp-s1-ha](https://github.com/ChuckBuilds/chefstemp-s1-ha)
ESPHome build, or any other thermometer.

## Install (HACS custom repository)

1. HACS → ⋮ → **Custom repositories** → add
   `https://github.com/ChuckBuilds/chefstemp-cook`, category **Integration**.
2. Install **ChefsTemp Cook**, then **restart Home Assistant**.
3. Settings → Devices & Services → **Add Integration** → *ChefsTemp Cook* →
   pick your **grill** and **food** temperature sensors and a default pull target.
4. A **Cook** item appears in the sidebar. That's the app — no dashboard to build.

## What you get

- **Sidebar app** with live grill/food temps, elapsed time, and current stage.
- **One-tap actions** (Meat On starts a fresh cook) and a **note box** for custom
  labels like "spritzed" or "added wood".
- **Heat chart** drawn inline (no extra cards/plugins) showing grill + food lines,
  a dashed pull-target line, and a vertical marker at every event.
- **Pull-temp alert**: fires the `chefstemp_cook_target_reached` event and a
  persistent notification when the food probe crosses the target. Automate a
  phone notification off that event if you want it on your phone.
- **Entities** for automations/voice: buttons (Meat On/Wrapped/Sauce/Done/Reset)
  and `sensor.cook_stage` / `sensor.cook_elapsed`.

## Services

- `chefstemp_cook.mark_event` — `event` (meat_on/wrapped/sauce/done/custom),
  optional `label`, `color`.
- `chefstemp_cook.reset`
- `chefstemp_cook.set_target` — `target` (in your entities' unit).

## Phone alert example

```yaml
automation:
  - alias: Cook target -> phone
    trigger:
      - platform: event
        event_type: chefstemp_cook_target_reached
    action:
      - service: notify.mobile_app_your_phone
        data:
          title: "🍖 Food hit {{ trigger.event.data.target }}°"
          message: >-
            {{ trigger.event.data.food_temp }}° after
            {{ trigger.event.data.elapsed_min }} min.
```

## Notes

- Temperatures are shown in whatever unit your chosen entities report; the app
  doesn't convert. Set the target in that same unit.
- The chart pulls history from the HA recorder (default 12 h window).
- Not affiliated with ChefsTemp.
