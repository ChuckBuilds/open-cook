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

- **Sidebar app** with live grill + per-probe temps, elapsed time, and stage.
- **One-tap actions** — Meat On (starts a fresh cook), Wrapped, Sauce, Flip, Done
  — plus a **note box** for custom labels like "spritzed" or "added wood".
- **Multiple probes**, each with its own **name**, **item type** (steak, pizza,
  brisket, …), **pull target**, and **one or more reading sensors** (so a probe
  that exposes several sensors can chart them all).
- **Two kinds of target**:
  - **Grill target** with a ± band — alerts if the grill *drifts* out of range
    (fires `chefstemp_cook_grill_drift`). Presets: Low & slow / Roasting / Sear.
  - **Per-probe meat target** — alerts when that probe crosses it
    (fires `chefstemp_cook_target_reached`). Item presets prefill sensible targets.
- **Editable cook log** — tap *edit* on any logged action to fix its **time** or
  label after the fact (for when you couldn't get to your phone right away).
- **Heat chart** drawn inline (no extra cards/plugins): grill + every probe
  reading, dashed target lines, and a labelled marker at each event.
- **Entities & services** for automations/voice: action buttons,
  `sensor.cook_stage` / `sensor.cook_elapsed`, and services
  `mark_event`, `edit_event`, `delete_event`, `set_grill_target`,
  `add_probe`, `update_probe`, `remove_probe`, `reset`.

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
