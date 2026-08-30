/*
 * ChefsTemp Cook — sidebar panel (v2).
 * Multi-probe cook app: grill + meat targets, per-probe items/targets,
 * multiple readings per probe, an editable cook log, and a self-drawn heat
 * chart with event markers. No external libraries (CSP-safe).
 */
const WINDOW_HOURS = 12;

const pad2 = (n) => String(n).padStart(2, "0");
const toLocalInput = (ts) => {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const fmtTime = (ts) =>
  new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const esc = (s) =>
  String(s == null ? "" : s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

class ChefsTempCookPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._cook = null;
    this._history = {};
    this._unsub = null;
    this._timers = [];
    this._editingEvent = null;
    this._built = false;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._init();
    else this._paintLive();
  }

  connectedCallback() { if (!this._built) this._build(); }
  disconnectedCallback() {
    if (this._unsub) this._unsub.then((u) => u && u());
    this._timers.forEach(clearInterval);
    this._timers = [];
  }

  async _init() {
    this._build();
    try {
      this._unsub = this._hass.connection.subscribeMessage(
        (msg) => { this._cook = msg; this._render(); },
        { type: "chefstemp_cook/subscribe" }
      );
    } catch (e) {
      this.shadowRoot.getElementById("err").textContent =
        "Could not reach the ChefsTemp Cook integration.";
    }
    await this._loadHistory();
    this._render();
    this._timers.push(setInterval(() => this._loadHistory().then(() => this._renderChart()), 20000));
    this._timers.push(setInterval(() => this._paintLive(), 1000));
  }

  /* ---------- data ---------- */

  _entities() {
    const c = this._cook || {};
    const ids = new Set();
    if (c.grill_entity) ids.add(c.grill_entity);
    (c.probes || []).forEach((p) => (p.readings || []).forEach((r) => ids.add(r)));
    return [...ids];
  }

  async _loadHistory() {
    const ids = this._entities();
    if (!this._hass || !ids.length) return;
    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_HOURS * 3600 * 1000);
    try {
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: ids,
        minimal_response: true,
        no_attributes: true,
      });
      const out = {};
      for (const id of ids) {
        out[id] = (res[id] || [])
          .map((r) => ({ t: r.lu != null ? r.lu * 1000 : Date.parse(r.last_updated),
                         v: parseFloat(r.s != null ? r.s : r.state) }))
          .filter((p) => !isNaN(p.v) && !isNaN(p.t));
      }
      this._history = out;
    } catch (e) { /* no history yet */ }
  }

  _st(eid) { return this._hass && eid ? this._hass.states[eid] : null; }
  _unit(eid) { const s = this._st(eid); return (s && s.attributes.unit_of_measurement) || "°"; }
  _val(eid) {
    const s = this._st(eid);
    if (!s || ["unknown", "unavailable", ""].includes(s.state)) return null;
    const n = parseFloat(s.state);
    return isNaN(n) ? null : n;
  }
  _isFahrenheit(eid) { return this._unit(eid).toUpperCase().includes("F"); }

  _tempEntities() {
    if (!this._hass) return [];
    return Object.keys(this._hass.states)
      .filter((id) => id.startsWith("sensor.") &&
        this._hass.states[id].attributes.device_class === "temperature")
      .sort();
  }

  /* ---------- service calls ---------- */
  _svc(name, data) { this._hass.callService("chefstemp_cook", name, data || {}); }
  _mark(event, label, color) { this._svc("mark_event", { event, label, color }); }
  _reset() { this._svc("reset"); }
  _addProbe() { this._svc("add_probe", { name: `Probe ${(this._cook.probes || []).length + 1}`, readings: [] }); }
  _updateProbe(id, fields) { this._svc("update_probe", { id, ...fields }); }
  _removeProbe(id) { this._svc("remove_probe", { id }); }
  _setGrillTarget(target, band) {
    const d = {};
    if (target !== undefined) d.target = target === "" ? null : Number(target);
    if (band !== undefined && band !== "") d.band = Number(band);
    this._svc("set_grill_target", d);
  }
  _editEvent(id, ts, label) { this._svc("edit_event", { id, timestamp: ts, label }); this._editingEvent = null; }
  _deleteEvent(id) { this._svc("delete_event", { id }); this._editingEvent = null; }

  _applyItemPreset(probe, key) {
    const preset = (this._cook.item_presets || []).find((p) => p.key === key);
    const fields = { item: key };
    if (preset) {
      const f = this._isFahrenheit((probe.readings || [])[0] || this._cook.grill_entity);
      const t = f ? preset.target_f : preset.target_c;
      if (t != null) fields.target = t;
    }
    this._updateProbe(probe.id, fields);
  }

  /* ---------- build shell ---------- */

  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;height:100%;overflow:auto;
          background:var(--primary-background-color,#111);color:var(--primary-text-color,#eee);
          font-family:var(--paper-font-body1_-_font-family,Roboto,system-ui,sans-serif);}
        .wrap{max-width:1000px;margin:0 auto;padding:16px;box-sizing:border-box;}
        .top{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;}
        .stat{background:var(--card-background-color,#1c1c1c);border-radius:14px;padding:12px 16px;min-width:92px;
          box-shadow:var(--ha-card-box-shadow,0 2px 6px rgba(0,0,0,.3));}
        .stat .k{font-size:12px;opacity:.65;text-transform:uppercase;letter-spacing:.04em;}
        .stat .v{font-size:24px;font-weight:600;line-height:1.15;}
        .stat .v small{font-size:13px;opacity:.6;font-weight:400;}
        .stat.alert{outline:2px solid var(--error-color,#ff5252);}
        .actions{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 14px;}
        button.act{border:0;border-radius:12px;padding:13px 17px;font-size:15px;font-weight:600;color:#fff;cursor:pointer;}
        button.act:active{transform:translateY(1px);}
        .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0;}
        input,select{background:var(--card-background-color,#1c1c1c);border:1px solid var(--divider-color,#333);
          color:inherit;border-radius:10px;padding:9px 11px;font-size:14px;box-sizing:border-box;}
        input.grow{flex:1;min-width:150px;}
        .ghost{background:var(--card-background-color,#1c1c1c);color:inherit;border:1px solid var(--divider-color,#333);
          border-radius:10px;padding:9px 13px;cursor:pointer;font-size:14px;}
        .chip{border:0;border-radius:20px;padding:7px 13px;font-size:13px;cursor:pointer;color:#fff;}
        .card{background:var(--card-background-color,#1c1c1c);border-radius:16px;padding:14px;margin:10px 0;
          box-shadow:var(--ha-card-box-shadow,0 2px 6px rgba(0,0,0,.3));}
        h2{margin:20px 0 6px;font-size:14px;opacity:.8;font-weight:600;text-transform:uppercase;letter-spacing:.04em;}
        svg{width:100%;height:auto;display:block;}
        .muted{opacity:.6;}
        .err{color:var(--error-color,#ff5252);padding:8px 0;}
        .probe-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
        .swatch{width:12px;height:12px;border-radius:50%;flex:0 0 auto;}
        .reads{display:flex;flex-direction:column;gap:4px;margin:6px 0;}
        .read{display:flex;align-items:center;gap:8px;font-size:14px;}
        .x{cursor:pointer;opacity:.6;}
        .evrow{display:flex;align-items:center;gap:10px;font-size:14px;padding:4px 0;}
        .dot{width:10px;height:10px;border-radius:50%;flex:0 0 auto;}
        .link{color:var(--primary-color,#03a9f4);cursor:pointer;font-size:13px;}
        .editbox{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0;}
        .flame{color:var(--warning-color,#ff9800);}
      </style>
      <div class="wrap">
        <div id="stats" class="top"></div>
        <div id="actions" class="actions"></div>
        <div class="row">
          <input id="noteInput" class="grow" placeholder="Add a note (spritzed, added wood)…"/>
          <button class="ghost" id="noteAdd">Add note</button>
          <button class="ghost" id="resetBtn">Reset cook</button>
        </div>

        <h2>Grill target</h2>
        <div class="card" id="grillCard"></div>

        <h2>Probes</h2>
        <div id="probes"></div>
        <button class="ghost" id="addProbe">+ Add probe</button>

        <h2>Heat chart</h2>
        <div class="card"><div id="chart"></div></div>

        <h2>Cook log</h2>
        <div id="log" class="card"></div>
        <div id="err" class="err"></div>
      </div>`;
    const R = this.shadowRoot;
    R.getElementById("noteAdd").onclick = () => {
      const el = R.getElementById("noteInput");
      if (el.value.trim()) { this._mark("custom", el.value.trim()); el.value = ""; }
    };
    R.getElementById("noteInput").onkeydown = (e) => { if (e.key === "Enter") R.getElementById("noteAdd").onclick(); };
    R.getElementById("resetBtn").onclick = () => this._reset();
    R.getElementById("addProbe").onclick = () => this._addProbe();
  }

  /* ---------- render ---------- */

  _render() {
    if (!this._built || !this._cook) return;
    this._renderActions();
    this._paintLive();
    this._renderGrill();
    this._renderProbes();
    this._renderChart();
    this._renderLog();
  }

  _renderActions() {
    const box = this.shadowRoot.getElementById("actions");
    box.innerHTML = "";
    for (const e of this._cook.quick_events || []) {
      const b = document.createElement("button");
      b.className = "act"; b.style.background = e.color; b.textContent = e.label;
      b.onclick = () => this._mark(e.key);
      box.appendChild(b);
    }
  }

  _paintLive() {
    if (!this._built || !this._cook) return;
    const c = this._cook;
    const cells = [];
    if (c.grill_entity) {
      const v = this._val(c.grill_entity);
      const drift = c.grill_alert && c.grill_alert !== "ok";
      cells.push({ k: "Grill", v: v == null ? "—" : v, u: this._unit(c.grill_entity), alert: drift });
    }
    (c.probes || []).forEach((p) => {
      const eid = (p.readings || [])[0];
      const v = eid ? this._val(eid) : null;
      cells.push({ k: p.name, v: v == null ? "—" : v, u: eid ? this._unit(eid) : "", alert: !!p.target_reached_at });
    });
    const elapsed = c.started_at ? Math.floor((Date.now() / 1000 - c.started_at) / 60) : 0;
    cells.push({ k: "Elapsed", v: elapsed, u: "min" });
    cells.push({ k: "Stage", v: c.stage || "Idle", u: "" });
    this.shadowRoot.getElementById("stats").innerHTML = cells
      .map((c2) => `<div class="stat ${c2.alert ? "alert" : ""}"><div class="k">${esc(c2.k)}</div>
        <div class="v">${esc(c2.v)}<small> ${esc(c2.u)}</small></div></div>`)
      .join("");
  }

  _renderGrill() {
    const c = this._cook;
    const unit = this._unit(c.grill_entity);
    const presets = (c.grill_presets || [])
      .map((p) => `<button class="chip" style="background:${this._isFahrenheit(c.grill_entity) ? "#455a64" : "#455a64"}" data-gp="${p.key}">${esc(p.label)}</button>`)
      .join(" ");
    const box = this.shadowRoot.getElementById("grillCard");
    box.innerHTML = `
      <div class="row">
        <label class="muted">Target</label>
        <input id="gTarget" type="number" step="1" style="width:110px" value="${c.grill_target != null ? c.grill_target : ""}"/>
        <span class="muted">${esc(unit)}</span>
        <label class="muted" style="margin-left:8px">± band</label>
        <input id="gBand" type="number" step="1" style="width:80px" value="${c.grill_band != null ? c.grill_band : ""}"/>
        <button class="ghost" id="gClear">Clear</button>
      </div>
      <div class="row">${presets}</div>`;
    box.querySelector("#gTarget").onchange = (e) => this._setGrillTarget(e.target.value, box.querySelector("#gBand").value);
    box.querySelector("#gBand").onchange = (e) => this._setGrillTarget(undefined, e.target.value);
    box.querySelector("#gClear").onclick = () => this._setGrillTarget("");
    box.querySelectorAll("[data-gp]").forEach((btn) => {
      btn.onclick = () => {
        const p = (c.grill_presets || []).find((x) => x.key === btn.dataset.gp);
        const t = this._isFahrenheit(c.grill_entity) ? p.target_f : p.target_c;
        this._setGrillTarget(t);
      };
    });
  }

  _renderProbes() {
    const c = this._cook;
    const box = this.shadowRoot.getElementById("probes");
    const tempOpts = this._tempEntities();
    box.innerHTML = "";
    for (const p of c.probes || []) {
      const primary = (p.readings || [])[0];
      const unit = primary ? this._unit(primary) : this._unit(c.grill_entity);
      const items = (c.item_presets || [])
        .map((it) => `<option value="${it.key}" ${it.key === p.item ? "selected" : ""}>${esc(it.label)}</option>`)
        .join("");
      const reads = (p.reading_values || [])
        .map((r) => `<div class="read"><span class="swatch" style="background:${p.color}"></span>
          <span>${esc(r.name)}</span>
          <b>${r.value == null ? "—" : esc(r.value)}</b><span class="muted">${esc(r.unit || "")}</span>
          <span class="x" data-rmread="${p.id}|${esc(r.entity)}" title="remove reading">✕</span></div>`)
        .join("") || `<div class="muted">No readings yet — add a sensor below.</div>`;
      const addOpts = ['<option value="">+ add reading…</option>']
        .concat(tempOpts.filter((e) => !(p.readings || []).includes(e))
          .map((e) => `<option value="${e}">${esc(this._st(e) ? this._st(e).attributes.friendly_name || e : e)}</option>`))
        .join("");
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="probe-head">
          <span class="swatch" style="background:${p.color}"></span>
          <input class="grow" data-name="${p.id}" value="${esc(p.name)}"/>
          <span class="x" data-rmprobe="${p.id}" title="remove probe">✕</span>
        </div>
        <div class="row">
          <label class="muted">Item</label>
          <select data-item="${p.id}">${items}</select>
          <label class="muted">Target</label>
          <input type="number" step="1" style="width:100px" data-target="${p.id}" value="${p.target != null ? p.target : ""}"/>
          <span class="muted">${esc(unit)}</span>
          ${p.target_reached_at ? '<span style="color:var(--success-color,#4caf50)">✓ reached</span>' : ""}
        </div>
        <div class="reads">${reads}</div>
        <div class="row"><select data-addread="${p.id}">${addOpts}</select></div>`;
      box.appendChild(card);
    }
    // wire up
    box.querySelectorAll("[data-name]").forEach((el) => {
      el.onchange = () => this._updateProbe(el.dataset.name, { name: el.value });
    });
    box.querySelectorAll("[data-item]").forEach((el) => {
      el.onchange = () => {
        const probe = (c.probes || []).find((x) => x.id === el.dataset.item);
        this._applyItemPreset(probe, el.value);
      };
    });
    box.querySelectorAll("[data-target]").forEach((el) => {
      el.onchange = () => this._updateProbe(el.dataset.target, { target: el.value === "" ? null : Number(el.value) });
    });
    box.querySelectorAll("[data-rmprobe]").forEach((el) => {
      el.onclick = () => this._removeProbe(el.dataset.rmprobe);
    });
    box.querySelectorAll("[data-rmread]").forEach((el) => {
      el.onclick = () => {
        const [pid, ent] = el.dataset.rmread.split("|");
        const probe = (c.probes || []).find((x) => x.id === pid);
        this._updateProbe(pid, { readings: (probe.readings || []).filter((r) => r !== ent) });
      };
    });
    box.querySelectorAll("[data-addread]").forEach((el) => {
      el.onchange = () => {
        if (!el.value) return;
        const probe = (c.probes || []).find((x) => x.id === el.dataset.addread);
        this._updateProbe(el.dataset.addread, { readings: [...(probe.readings || []), el.value] });
      };
    });
  }

  _renderLog() {
    const c = this._cook;
    const box = this.shadowRoot.getElementById("log");
    if (!c.events || !c.events.length) {
      box.innerHTML = `<div class="muted">No events yet — tap an action above.</div>`;
      return;
    }
    box.innerHTML = c.events.slice().reverse().map((ev) => {
      if (this._editingEvent === ev.id) {
        return `<div class="editbox" data-editrow="${ev.id}">
          <span class="dot" style="background:${ev.color}"></span>
          <input type="datetime-local" data-ets value="${toLocalInput(ev.ts)}"/>
          <input class="grow" data-elabel value="${esc(ev.label)}"/>
          <button class="ghost" data-save="${ev.id}">Save</button>
          <button class="ghost" data-del="${ev.id}">Delete</button>
          <span class="link" data-cancel>Cancel</span>
        </div>`;
      }
      return `<div class="evrow"><span class="dot" style="background:${ev.color}"></span>
        <span>${esc(ev.label)}</span><span class="muted">· ${fmtTime(ev.ts)}</span>
        <span class="link" data-edit="${ev.id}">edit</span></div>`;
    }).join("");
    box.querySelectorAll("[data-edit]").forEach((el) => {
      el.onclick = () => { this._editingEvent = el.dataset.edit; this._renderLog(); };
    });
    const cancel = box.querySelector("[data-cancel]");
    if (cancel) cancel.onclick = () => { this._editingEvent = null; this._renderLog(); };
    box.querySelectorAll("[data-save]").forEach((el) => {
      el.onclick = () => {
        const rowEl = box.querySelector(`[data-editrow="${el.dataset.save}"]`);
        const ts = new Date(rowEl.querySelector("[data-ets]").value).getTime() / 1000;
        const label = rowEl.querySelector("[data-elabel]").value;
        this._editEvent(el.dataset.save, isNaN(ts) ? undefined : ts, label);
      };
    });
    box.querySelectorAll("[data-del]").forEach((el) => {
      el.onclick = () => this._deleteEvent(el.dataset.del);
    });
  }

  /* ---------- chart ---------- */

  _renderChart() {
    if (!this._cook) return;
    const c = this._cook;
    const host = this.shadowRoot.getElementById("chart");
    const W = 960, H = 360, ml = 46, mr = 14, mt = 14, mb = 26;

    const series = [];
    if (c.grill_entity)
      series.push({ id: c.grill_entity, color: "#fb8c00", width: 2, dash: false, pts: (this._history[c.grill_entity] || []).slice() });
    for (const p of c.probes || []) {
      (p.readings || []).forEach((eid, i) => {
        series.push({ id: eid, color: p.color, width: i === 0 ? 2.5 : 1.2, dash: i > 0, pts: (this._history[eid] || []).slice() });
      });
    }
    const now = Date.now();
    for (const s of series) {
      const v = this._val(s.id);
      if (v != null) s.pts.push({ t: now, v });
    }
    const all = series.flatMap((s) => s.pts);
    if (!all.length) {
      host.innerHTML = `<div class="muted" style="padding:24px;text-align:center">Waiting for temperature history…</div>`;
      return;
    }
    const targets = [];
    if (c.grill_target != null) targets.push({ v: c.grill_target, color: "#fb8c00", label: "grill" });
    (c.probes || []).forEach((p) => { if (p.target != null) targets.push({ v: p.target, color: p.color, label: p.name }); });

    const t0 = c.started_at ? Math.min(c.started_at * 1000, ...all.map((p) => p.t)) : Math.min(...all.map((p) => p.t));
    const t1 = Math.max(now, ...all.map((p) => p.t));
    let vmin = Math.min(...all.map((p) => p.v), ...targets.map((t) => t.v));
    let vmax = Math.max(...all.map((p) => p.v), ...targets.map((t) => t.v));
    const pad = Math.max(5, (vmax - vmin) * 0.1);
    vmin -= pad; vmax += pad;

    const X = (t) => ml + ((t - t0) / Math.max(1, t1 - t0)) * (W - ml - mr);
    const Y = (v) => mt + (1 - (v - vmin) / Math.max(1e-6, vmax - vmin)) * (H - mt - mb);
    const path = (pts) => (pts.length ? "M" + pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" L") : "");

    let g = "";
    for (let i = 0; i <= 4; i++) {
      const v = vmin + (i / 4) * (vmax - vmin), y = Y(v);
      g += `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="var(--divider-color,#333)" stroke-width="0.5"/>`;
      g += `<text x="${ml - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--secondary-text-color,#999)">${Math.round(v)}</text>`;
    }
    for (let i = 0; i <= 4; i++) {
      const t = t0 + (i / 4) * (t1 - t0), x = X(t);
      g += `<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--secondary-text-color,#999)">${fmtTime(t / 1000)}</text>`;
    }
    let tl = "";
    for (const t of targets) {
      const y = Y(t.v);
      tl += `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="${t.color}" stroke-width="1" stroke-dasharray="4 4" opacity="0.7"/>`;
    }
    let mk = "";
    for (const ev of c.events || []) {
      const x = X(ev.ts * 1000);
      if (x < ml || x > W - mr) continue;
      mk += `<line x1="${x}" y1="${mt}" x2="${x}" y2="${H - mb}" stroke="${ev.color}" stroke-width="1.5" stroke-dasharray="3 3"/>
        <text x="${x + 3}" y="${mt + 10}" font-size="10" fill="${ev.color}">${esc(ev.label)}</text>`;
    }
    const lines = series.map((s) =>
      `<path d="${path(s.pts)}" fill="none" stroke="${s.color}" stroke-width="${s.width}" ${s.dash ? 'stroke-dasharray="4 3"' : ""} stroke-linejoin="round"/>`
    ).join("");

    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}${tl}${mk}${lines}</svg>`;
  }
}

customElements.define("chefstemp-cook-panel", ChefsTempCookPanel);
