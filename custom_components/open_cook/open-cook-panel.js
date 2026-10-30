/*
 * Open Cook — sidebar panel (v3).
 * Independent per-item cooks on a shared grill: each probe has its own On/Wrap/
 * Sauce/Flip/Done timeline, start clock, and target. Grill temp + target + notes
 * are shared. Self-drawn SVG heat chart (no external libs).
 */
const WINDOW_HOURS = 12;
const pad2 = (n) => String(n).padStart(2, "0");
const toLocalInput = (ts) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const esc = (s) => String(s == null ? "" : s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

class OpenCookPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null; this._cook = null; this._history = {};
    this._unsub = null; this._timers = []; this._editingEvent = null; this._built = false;
  }
  set hass(hass) { const f = !this._hass; this._hass = hass; if (f) this._init(); else this._paintLive(); }
  connectedCallback() { if (!this._built) this._build(); }
  disconnectedCallback() {
    if (this._unsub) this._unsub.then((u) => u && u());
    this._timers.forEach(clearInterval); this._timers = [];
    if (this._onResize) window.removeEventListener("resize", this._onResize);
  }

  async _init() {
    this._build();
    try {
      this._unsub = this._hass.connection.subscribeMessage(
        (msg) => { this._cook = msg; this._render(); },
        { type: "open_cook/subscribe" });
    } catch (e) {
      this.shadowRoot.getElementById("err").textContent = "Could not reach the Open Cook integration.";
    }
    await this._loadHistory(); this._render();
    this._timers.push(setInterval(() => this._loadHistory().then(() => this._renderChart()), 20000));
    this._timers.push(setInterval(() => this._paintLive(), 1000));
    this._onResize = () => this._renderChart();
    window.addEventListener("resize", this._onResize);
  }

  _entities() {
    const c = this._cook || {}; const ids = new Set();
    if (c.grill_entity) ids.add(c.grill_entity);
    (c.probes || []).forEach((p) => (p.readings || []).forEach((r) => ids.add(r)));
    return [...ids];
  }
  async _loadHistory() {
    const ids = this._entities(); if (!this._hass || !ids.length) return;
    const end = new Date(); const start = new Date(end.getTime() - WINDOW_HOURS * 3600 * 1000);
    try {
      const res = await this._hass.callWS({
        type: "history/history_during_period", start_time: start.toISOString(),
        end_time: end.toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true });
      const out = {};
      for (const id of ids) out[id] = (res[id] || [])
        .map((r) => ({ t: r.lu != null ? r.lu * 1000 : Date.parse(r.last_updated), v: parseFloat(r.s != null ? r.s : r.state) }))
        .filter((p) => !isNaN(p.v) && !isNaN(p.t));
      this._history = out;
    } catch (e) {}
  }

  _st(eid) { return this._hass && eid ? this._hass.states[eid] : null; }
  _unit(eid) { const s = this._st(eid); return (s && s.attributes.unit_of_measurement) || "°"; }
  _val(eid) {
    const s = this._st(eid); if (!s || ["unknown", "unavailable", ""].includes(s.state)) return null;
    const n = parseFloat(s.state); return isNaN(n) ? null : n;
  }
  _isF(eid) { return this._unit(eid).toUpperCase().includes("F"); }
  _tempEntities() {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter((id) => id.startsWith("sensor.") && this._hass.states[id].attributes.device_class === "temperature").sort();
  }

  _svc(n, d) { this._hass.callService("open_cook", n, d || {}); }
  _itemEvent(pid, ev) { this._svc("item_event", { probe_id: pid, event: ev }); }
  _resetItem(pid) { this._svc("reset_item", { probe_id: pid }); }
  _note(label) { this._svc("note", { label }); }
  _reset() { this._svc("reset"); }
  _addProbe() { this._svc("add_probe", { name: `Probe ${(this._cook.probes || []).length + 1}`, readings: [] }); }
  _updateProbe(id, f) { this._svc("update_probe", { id, ...f }); }
  _removeProbe(id) { this._svc("remove_probe", { id }); }
  _setGrillTarget(t, b) {
    const d = {};
    if (t !== undefined) d.target = t === "" ? null : Number(t);
    if (b !== undefined && b !== "") d.band = Number(b);
    this._svc("set_grill_target", d);
  }
  _editEvent(id, ts, label) { this._svc("edit_event", { id, timestamp: ts, label }); this._editingEvent = null; }
  _deleteEvent(id) { this._svc("delete_event", { id }); this._editingEvent = null; }
  _applyItemPreset(probe, key) {
    const preset = (this._cook.item_presets || []).find((p) => p.key === key);
    const fields = { item: key };
    if (preset) {
      const t = this._isF((probe.readings || [])[0] || this._cook.grill_entity) ? preset.target_f : preset.target_c;
      if (t != null) fields.target = t;
    }
    this._updateProbe(probe.id, fields);
  }

  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;height:100%;overflow:auto;background:var(--primary-background-color,#111);
          color:var(--primary-text-color,#eee);font-family:var(--paper-font-body1_-_font-family,Roboto,system-ui,sans-serif);}
        .wrap{max-width:1000px;margin:0 auto;padding:16px;box-sizing:border-box;}
        .top{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;}
        .stat{background:var(--card-background-color,#1c1c1c);border-radius:14px;padding:12px 16px;min-width:88px;
          box-shadow:var(--ha-card-box-shadow,0 2px 6px rgba(0,0,0,.3));}
        .stat .k{font-size:12px;opacity:.65;text-transform:uppercase;letter-spacing:.04em;}
        .stat .v{font-size:24px;font-weight:600;line-height:1.15;}
        .stat .v small{font-size:13px;opacity:.6;font-weight:400;}
        .stat.alert{outline:2px solid var(--error-color,#ff5252);}
        .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0;}
        input,select{background:var(--card-background-color,#1c1c1c);border:1px solid var(--divider-color,#333);
          color:inherit;border-radius:10px;padding:9px 11px;font-size:14px;box-sizing:border-box;}
        input.grow{flex:1;min-width:140px;}
        .ghost{background:var(--card-background-color,#1c1c1c);color:inherit;border:1px solid var(--divider-color,#333);
          border-radius:10px;padding:9px 13px;cursor:pointer;font-size:14px;}
        .chip{border:0;border-radius:20px;padding:7px 13px;font-size:13px;cursor:pointer;color:#fff;}
        button.act{border:0;border-radius:10px;padding:10px 14px;font-size:14px;font-weight:600;color:#fff;cursor:pointer;}
        button.act:active{transform:translateY(1px);}
        .card{background:var(--card-background-color,#1c1c1c);border-radius:16px;padding:14px;margin:10px 0;
          box-shadow:var(--ha-card-box-shadow,0 2px 6px rgba(0,0,0,.3));}
        h2{margin:20px 0 6px;font-size:14px;opacity:.8;font-weight:600;text-transform:uppercase;letter-spacing:.04em;}
        svg{width:100%;height:auto;display:block;}
        .muted{opacity:.6;} .err{color:var(--error-color,#ff5252);padding:8px 0;}
        .phead{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
        .swatch{width:12px;height:12px;border-radius:50%;flex:0 0 auto;}
        .reads{display:flex;flex-direction:column;gap:4px;margin:6px 0;}
        .read{display:flex;align-items:center;gap:8px;font-size:14px;}
        .x{cursor:pointer;opacity:.6;} .link{color:var(--primary-color,#03a9f4);cursor:pointer;font-size:13px;}
        .ev{display:flex;align-items:center;gap:8px;font-size:13px;padding:3px 0;}
        .dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;}
        .editbox{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0;}
        .hr{height:1px;background:var(--divider-color,#333);margin:10px 0;opacity:.6;}
        .badge{font-size:12px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,.08);}
        /* --- phone: bigger text, fat touch targets, stacked controls --- */
        @media (max-width:640px){
          .wrap{padding:12px;}
          .stat{flex:1 1 42%;padding:14px 16px;}
          .stat .k{font-size:13px;} .stat .v{font-size:32px;}
          h2{font-size:15px;margin-top:22px;}
          button.act{flex:1 1 42%;padding:16px 10px;font-size:17px;border-radius:12px;}
          .chip{font-size:15px;padding:11px 16px;}
          .ghost{padding:13px 16px;font-size:16px;}
          input,select{font-size:16px;padding:13px;}  /* 16px stops iOS zoom-on-focus */
          input.grow{min-width:100%;}
          .read,.ev{font-size:16px;padding:6px 0;}
          .link{font-size:16px;padding:6px 4px;}       /* bigger tap target for edit/cancel */
          .x{font-size:20px;padding:4px;}
          .badge{font-size:14px;padding:4px 10px;}
          label.muted{font-size:14px;}
        }
      </style>
      <div class="wrap">
        <div id="stats" class="top"></div>
        <h2>Grill</h2><div class="card" id="grillCard"></div>
        <h2>Items</h2><div id="probes"></div>
        <button class="ghost" id="addProbe">+ Add item / probe</button>
        <h2>Heat chart</h2><div class="card"><div id="chart"></div></div>
        <h2>Grill notes (shared)</h2>
        <div class="card">
          <div class="row"><input id="noteInput" class="grow" placeholder="Add a shared note (added wood, opened lid)…"/>
            <button class="ghost" id="noteAdd">Add note</button>
            <button class="ghost" id="resetBtn">Reset whole cook</button></div>
          <div id="notelog"></div>
        </div>
        <div id="err" class="err"></div>
      </div>`;
    const R = this.shadowRoot;
    R.getElementById("noteAdd").onclick = () => {
      const el = R.getElementById("noteInput");
      if (el.value.trim()) { this._note(el.value.trim()); el.value = ""; }
    };
    R.getElementById("noteInput").onkeydown = (e) => { if (e.key === "Enter") R.getElementById("noteAdd").onclick(); };
    R.getElementById("resetBtn").onclick = () => this._reset();
    R.getElementById("addProbe").onclick = () => this._addProbe();
  }

  _render() {
    if (!this._built || !this._cook) return;
    this._paintLive(); this._renderGrill(); this._renderProbes(); this._renderNotes(); this._renderChart();
  }

  _paintLive() {
    if (!this._built || !this._cook) return;
    const c = this._cook; const cells = [];
    if (c.grill_entity) {
      const v = this._val(c.grill_entity);
      cells.push({ k: "Grill", v: v == null ? "—" : v, u: this._unit(c.grill_entity), alert: c.grill_alert && c.grill_alert !== "ok" });
    }
    cells.push({ k: "Cook time", v: c.overall_elapsed_min || 0, u: "min" });
    const n = (c.probes || []).filter((p) => p.started_at).length;
    cells.push({ k: "Items", v: n ? `${n} cooking` : "Idle", u: "" });
    this.shadowRoot.getElementById("stats").innerHTML = cells.map((x) =>
      `<div class="stat ${x.alert ? "alert" : ""}"><div class="k">${esc(x.k)}</div>
        <div class="v">${esc(x.v)}<small> ${esc(x.u)}</small></div></div>`).join("");
    // live per-item elapsed + reading values without clobbering inputs
    (c.probes || []).forEach((p) => {
      const se = this.shadowRoot.getElementById(`status_${p.id}`);
      if (se) se.textContent = p.started_at ? `Cooking · ${Math.floor((Date.now() / 1000 - p.started_at) / 60)} min` : "Not started";
      (p.readings || []).forEach((eid, i) => {
        const rv = this.shadowRoot.getElementById(`rv_${p.id}_${i}`);
        if (rv) { const v = this._val(eid); rv.textContent = v == null ? "—" : v; }
      });
    });
  }

  _renderGrill() {
    const c = this._cook; const unit = this._unit(c.grill_entity);
    const presets = (c.grill_presets || []).map((p) =>
      `<button class="chip" style="background:#455a64" data-gp="${p.key}">${esc(p.label)}</button>`).join(" ");
    const box = this.shadowRoot.getElementById("grillCard");
    box.innerHTML = `
      <div class="row"><b style="font-size:22px" data-glive>${this._val(c.grill_entity) == null ? "—" : this._val(c.grill_entity)}</b>
        <span class="muted">${esc(unit)}</span>
        ${c.grill_alert && c.grill_alert !== "ok" ? `<span class="badge" style="color:var(--error-color,#ff5252)">drift ${esc(c.grill_alert)}</span>` : ""}</div>
      <div class="row">
        <label class="muted">Target</label>
        <input id="gTarget" type="number" step="1" style="width:100px" value="${c.grill_target != null ? c.grill_target : ""}"/>
        <label class="muted">± band</label>
        <input id="gBand" type="number" step="1" style="width:76px" value="${c.grill_band != null ? c.grill_band : ""}"/>
        <button class="ghost" id="gClear">Clear</button></div>
      <div class="row">${presets}</div>`;
    box.querySelector("#gTarget").onchange = (e) => this._setGrillTarget(e.target.value, box.querySelector("#gBand").value);
    box.querySelector("#gBand").onchange = (e) => this._setGrillTarget(undefined, e.target.value);
    box.querySelector("#gClear").onclick = () => this._setGrillTarget("");
    box.querySelectorAll("[data-gp]").forEach((btn) => btn.onclick = () => {
      const p = (c.grill_presets || []).find((x) => x.key === btn.dataset.gp);
      this._setGrillTarget(this._isF(c.grill_entity) ? p.target_f : p.target_c);
    });
  }

  _renderProbes() {
    const c = this._cook; const box = this.shadowRoot.getElementById("probes");
    const tempOpts = this._tempEntities(); box.innerHTML = "";
    for (const p of c.probes || []) {
      const primary = (p.readings || [])[0];
      const unit = primary ? this._unit(primary) : this._unit(c.grill_entity);
      const items = (c.item_presets || []).map((it) =>
        `<option value="${it.key}" ${it.key === p.item ? "selected" : ""}>${esc(it.label)}</option>`).join("");
      const reads = (p.reading_values || []).map((r, i) =>
        `<div class="read"><span class="swatch" style="background:${p.color}"></span><span>${esc(r.name)}</span>
          <b id="rv_${p.id}_${i}">${r.value == null ? "—" : esc(r.value)}</b><span class="muted">${esc(r.unit || "")}</span>
          <span class="x" data-rmread="${p.id}|${esc(r.entity)}" title="remove reading">✕</span></div>`).join("")
        || `<div class="muted">No readings — add a sensor below.</div>`;
      const addOpts = ['<option value="">+ add reading…</option>'].concat(
        tempOpts.filter((e) => !(p.readings || []).includes(e)).map((e) =>
          `<option value="${e}">${esc(this._st(e) ? this._st(e).attributes.friendly_name || e : e)}</option>`)).join("");
      const actions = (c.quick_events || []).map((e) =>
        `<button class="act" style="background:${p.color}" data-ev="${p.id}|${e.key}">${esc(e.label)}</button>`).join(" ");
      const evlog = (p.events || []).slice().reverse().map((ev) => this._eventRow(ev, p.color)).join("")
        || `<div class="muted" style="font-size:13px">No actions yet.</div>`;
      const card = document.createElement("div"); card.className = "card";
      card.innerHTML = `
        <div class="phead"><span class="swatch" style="background:${p.color}"></span>
          <input class="grow" data-name="${p.id}" value="${esc(p.name)}"/>
          <span class="badge" id="status_${p.id}">${p.started_at ? `Cooking · ${p.elapsed_min} min` : "Not started"}</span>
          <span class="x" data-rmprobe="${p.id}" title="remove item">✕</span></div>
        <div class="row"><label class="muted">Item</label><select data-item="${p.id}">${items}</select>
          <label class="muted">Target</label>
          <input type="number" step="1" style="width:92px" data-target="${p.id}" value="${p.target != null ? p.target : ""}"/>
          <span class="muted">${esc(unit)}</span>
          ${p.target_reached_at ? '<span style="color:var(--success-color,#4caf50)">✓ reached</span>' : ""}</div>
        <div class="reads">${reads}</div>
        <div class="row"><select data-addread="${p.id}">${addOpts}</select></div>
        <div class="hr"></div>
        <div class="row">${actions}<button class="ghost" data-resetitem="${p.id}">Reset item</button></div>
        <div data-evlog="${p.id}">${evlog}</div>`;
      box.appendChild(card);
    }
    const q = (s) => box.querySelectorAll(s);
    q("[data-name]").forEach((el) => el.onchange = () => this._updateProbe(el.dataset.name, { name: el.value }));
    q("[data-item]").forEach((el) => el.onchange = () => this._applyItemPreset((c.probes || []).find((x) => x.id === el.dataset.item), el.value));
    q("[data-target]").forEach((el) => el.onchange = () => this._updateProbe(el.dataset.target, { target: el.value === "" ? null : Number(el.value) }));
    q("[data-rmprobe]").forEach((el) => el.onclick = () => this._removeProbe(el.dataset.rmprobe));
    q("[data-resetitem]").forEach((el) => el.onclick = () => this._resetItem(el.dataset.resetitem));
    q("[data-ev]").forEach((el) => el.onclick = () => { const [pid, key] = el.dataset.ev.split("|"); this._itemEvent(pid, key); });
    q("[data-rmread]").forEach((el) => el.onclick = () => {
      const [pid, ent] = el.dataset.rmread.split("|");
      const probe = (c.probes || []).find((x) => x.id === pid);
      this._updateProbe(pid, { readings: (probe.readings || []).filter((r) => r !== ent) });
    });
    q("[data-addread]").forEach((el) => el.onchange = () => {
      if (!el.value) return;
      const probe = (c.probes || []).find((x) => x.id === el.dataset.addread);
      this._updateProbe(el.dataset.addread, { readings: [...(probe.readings || []), el.value] });
    });
    this._wireEventRows(box);
  }

  _eventRow(ev, color) {
    if (this._editingEvent === ev.id) {
      return `<div class="editbox" data-editrow="${ev.id}"><span class="dot" style="background:${color || ev.color || "#999"}"></span>
        <input type="datetime-local" data-ets value="${toLocalInput(ev.ts)}"/>
        <input class="grow" data-elabel value="${esc(ev.label)}"/>
        <button class="ghost" data-save="${ev.id}">Save</button>
        <button class="ghost" data-del="${ev.id}">Delete</button><span class="link" data-cancel>Cancel</span></div>`;
    }
    return `<div class="ev"><span class="dot" style="background:${color || ev.color || "#999"}"></span>
      <span>${esc(ev.label)}</span><span class="muted">· ${fmtTime(ev.ts)}</span>
      <span class="link" data-edit="${ev.id}">edit</span></div>`;
  }

  _wireEventRows(root) {
    root.querySelectorAll("[data-edit]").forEach((el) => el.onclick = () => { this._editingEvent = el.dataset.edit; this._render(); });
    const cancel = root.querySelector("[data-cancel]");
    if (cancel) cancel.onclick = () => { this._editingEvent = null; this._render(); };
    root.querySelectorAll("[data-save]").forEach((el) => el.onclick = () => {
      const r = root.querySelector(`[data-editrow="${el.dataset.save}"]`);
      const ts = new Date(r.querySelector("[data-ets]").value).getTime() / 1000;
      this._editEvent(el.dataset.save, isNaN(ts) ? undefined : ts, r.querySelector("[data-elabel]").value);
    });
    root.querySelectorAll("[data-del]").forEach((el) => el.onclick = () => this._deleteEvent(el.dataset.del));
  }

  _renderNotes() {
    const c = this._cook; const box = this.shadowRoot.getElementById("notelog");
    box.innerHTML = (c.notes || []).length
      ? c.notes.slice().reverse().map((ev) => this._eventRow(ev, ev.color)).join("")
      : `<div class="muted" style="font-size:13px">No shared notes yet.</div>`;
    this._wireEventRows(box);
  }

  _renderChart() {
    if (!this._cook) return;
    const c = this._cook; const host = this.shadowRoot.getElementById("chart");
    // Responsive: on a phone use a taller, "zoomed-in" viewBox with bigger fonts
    // so axis numbers and markers stay legible once the SVG scales to screen width.
    const narrow = (this.clientWidth || window.innerWidth || 1000) < 640;
    const W = narrow ? 480 : 960, H = narrow ? 440 : 360;
    const ml = narrow ? 40 : 46, mr = 12, mt = 18, mb = narrow ? 30 : 26;
    const fAxis = narrow ? 15 : 10, fMark = narrow ? 13 : 9;
    const ticks = narrow ? 3 : 4, wScale = narrow ? 1.6 : 1;
    const series = [];
    if (c.grill_entity) series.push({ id: c.grill_entity, color: "#fb8c00", width: 2 * wScale, dash: false, pts: (this._history[c.grill_entity] || []).slice() });
    for (const p of c.probes || []) (p.readings || []).forEach((eid, i) =>
      series.push({ id: eid, color: p.color, width: (i === 0 ? 2.5 : 1.2) * wScale, dash: i > 0, pts: (this._history[eid] || []).slice() }));
    const now = Date.now();
    for (const s of series) { const v = this._val(s.id); if (v != null) s.pts.push({ t: now, v }); }
    const all = series.flatMap((s) => s.pts);
    if (!all.length) { host.innerHTML = `<div class="muted" style="padding:24px;text-align:center">Waiting for temperature history…</div>`; return; }
    const targets = [];
    if (c.grill_target != null) targets.push({ v: c.grill_target, color: "#fb8c00" });
    (c.probes || []).forEach((p) => { if (p.target != null) targets.push({ v: p.target, color: p.color }); });
    const markers = [];
    for (const p of c.probes || []) for (const ev of p.events || [])
      markers.push({ ts: ev.ts, color: p.color, label: narrow ? ev.label : `${p.name} · ${ev.label}` });
    for (const ev of c.notes || []) markers.push({ ts: ev.ts, color: ev.color || "#9e9e9e", label: ev.label });
    markers.sort((a, b) => a.ts - b.ts);

    const starts = (c.probes || []).filter((p) => p.started_at).map((p) => p.started_at * 1000);
    const t0 = Math.min(...(starts.length ? starts : [now]), ...all.map((p) => p.t));
    const t1 = Math.max(now, ...all.map((p) => p.t));
    let vmin = Math.min(...all.map((p) => p.v), ...targets.map((t) => t.v));
    let vmax = Math.max(...all.map((p) => p.v), ...targets.map((t) => t.v));
    const pad = Math.max(5, (vmax - vmin) * 0.1); vmin -= pad; vmax += pad;
    const X = (t) => ml + ((t - t0) / Math.max(1, t1 - t0)) * (W - ml - mr);
    const Y = (v) => mt + (1 - (v - vmin) / Math.max(1e-6, vmax - vmin)) * (H - mt - mb);
    const path = (pts) => pts.length ? "M" + pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" L") : "";

    let g = "";
    for (let i = 0; i <= ticks; i++) { const v = vmin + (i / ticks) * (vmax - vmin), y = Y(v);
      g += `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="var(--divider-color,#333)" stroke-width="0.5"/>
        <text x="${ml - 5}" y="${y + fAxis / 3}" text-anchor="end" font-size="${fAxis}" fill="var(--secondary-text-color,#999)">${Math.round(v)}</text>`; }
    for (let i = 0; i <= ticks; i++) { const t = t0 + (i / ticks) * (t1 - t0);
      g += `<text x="${X(t)}" y="${H - 8}" text-anchor="middle" font-size="${fAxis}" fill="var(--secondary-text-color,#999)">${fmtTime(t / 1000)}</text>`; }
    let tl = ""; for (const t of targets) { const y = Y(t.v);
      tl += `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="${t.color}" stroke-width="${1 * wScale}" stroke-dasharray="4 4" opacity="0.7"/>`; }
    // markers with staggered label rows so they don't overlap on a narrow chart
    let mk = ""; let mi = 0;
    for (const ev of markers) { const x = X(ev.ts * 1000); if (x < ml || x > W - mr) continue;
      const ly = mt + fMark + (mi % 3) * (fMark + 2); mi++;
      const anchor = x > W - mr - 60 ? "end" : "start"; const dx = anchor === "end" ? -3 : 3;
      mk += `<line x1="${x}" y1="${mt}" x2="${x}" y2="${H - mb}" stroke="${ev.color}" stroke-width="${1.5 * wScale}" stroke-dasharray="3 3"/>
        <text x="${x + dx}" y="${ly}" text-anchor="${anchor}" font-size="${fMark}" fill="${ev.color}">${esc(ev.label)}</text>`; }
    const lines = series.map((s) => `<path d="${path(s.pts)}" fill="none" stroke="${s.color}" stroke-width="${s.width}" ${s.dash ? 'stroke-dasharray="4 3"' : ""} stroke-linejoin="round"/>`).join("");
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}${tl}${mk}${lines}</svg>`;
  }
}

customElements.define("open-cook-panel", OpenCookPanel);
