# Open Cook

A device-agnostic cook-timeline **app** for Home Assistant. Adds a **Cook** page
to the sidebar where each probe is its own cook item with per-item action buttons
(On / Wrap / Sauce / Flip / Done), and a live **heat chart** overlays every action
as a labelled marker against the temperature curves. Get a push alert when a probe
hits its pull temperature or the grill drifts out of its band.

**Works with any temperature sensors** — ChefsTemp (via the
[chefstemp-s1-ha](https://github.com/ChuckBuilds/chefstemp-s1-ha) ESPHome build),
ThermoPro (via `ha-thermopro-meat`), Govee, a plain ESPHome sensor — anything that
exposes a `sensor` with `device_class: temperature`. Open Cook only consumes HA
temperature entities; it has no dependency on any particular thermometer.

## Install (HACS custom repository)

1. HACS → ⋮ → **Custom repositories** → add
   `https://github.com/ChuckBuilds/open-cook`, category **Integration**.
2. Install **Open Cook**, then **restart Home Assistant**.
3. Settings → Devices & Services → **Add Integration** → *Open Cook* →
   pick your **grill** and **food** temperature sensors and a default pull target.
4. A **Cook** item appears in the sidebar. That's the app — no dashboard to build.

> **Migrating from "ChefsTemp Cook" (v3 and earlier):** this release renamed the
> integration to `open_cook` (a clean break so it's thermometer-agnostic). It does
> not auto-upgrade in place. Remove the old *ChefsTemp Cook* integration and its
> HACS entry first, then add this repo and set it up fresh. Your probe config is
> re-entered once; in-progress cook state does not carry over.

## What you get

- **Independent per-item cooks on one grill.** Each probe is its own cook item
  with its **own** On / Wrap / Sauce / Flip / Done timeline, start clock, and
  elapsed — so you can run **beef and chicken at once and stagger them** (start
  one later, foil them at different times) without their timelines colliding.
- **Shared grill** — one grill temperature and grill target/drift alert for the
  whole cook, plus a **shared notes** timeline for grill-level events ("added
  wood", "opened lid").
- **Multiple probes**, each with its own **name**, **item type** (steak, pizza,
  brisket, …), **pull target**, and **one or more reading sensors** (so a probe
  that exposes several sensors can chart them all).
- **Two kinds of target**:
  - **Grill target** with a ± band — alerts if the grill *drifts* out of range
    (fires `open_cook_grill_drift`). Presets: Low & slow / Roasting / Sear.
  - **Per-probe meat target** — alerts when that probe crosses it
    (fires `open_cook_target_reached`). Item presets prefill sensible targets.
- **Editable cook log** — tap *edit* on any logged action to fix its **time** or
  label after the fact (for when you couldn't get to your phone right away).
- **Heat chart** drawn inline (no extra cards/plugins): grill + every probe
  reading, dashed target lines, and a labelled marker at each event.
- **Entities & services** for automations/voice: a *Reset Cook* button,
  `sensor.cook_stage` / `sensor.cook_elapsed`, and the services below.

## Services

- `open_cook.item_event` — `probe_id`, `event` (on/wrapped/sauce/flip/done/custom), optional `label`
- `open_cook.reset_item` — `probe_id`
- `open_cook.note` — grill-level shared note (`label`, optional `color`)
- `open_cook.edit_event` / `open_cook.delete_event` — `id` (works on any timeline)
- `open_cook.set_grill_target` — `target`, optional `band`
- `open_cook.add_probe` / `open_cook.update_probe` / `open_cook.remove_probe`
- `open_cook.reset` — clears the whole cook

## Phone alert example

```yaml
automation:
  - alias: Cook target -> phone
    trigger:
      - platform: event
        event_type: open_cook_target_reached
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
