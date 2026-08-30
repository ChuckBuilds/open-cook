/*
 * ChefsTemp Cook — sidebar panel.
 * Big action buttons + a self-drawn heat chart with cook-event markers.
 * No external libraries (CSP-safe): the chart is inline SVG.
 */
const WINDOW_HOURS = 12;

class ChefsTempCookPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._cook = null;       // snapshot from the integration
    this._history = {};      // entity_id -> [{t, v}]
    this._hass = null;
    this._unsub = null;
    this._timers = [];
    this._built = false;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._init();
    else this._paintLive();   // cheap live-temp refresh on every hass push
  }

  connectedCallback() {
    if (!this._built) this._build();
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub.then((u) => u && u());
    this._timers.forEach((t) => clearInterval(t));
    this._timers = [];
  }

  async _init() {
    this._build();
    // live cook state (events, target, config)
    try {
      this._unsub = this._hass.connection.subscribeMessage(
        (msg) => { this._cook = msg; this._render(); },
        { type: "chefstemp_cook/subscribe" }
      );
    } catch (e) {
      this._error("Could not reach the ChefsTemp Cook integration.");
    }
    await this._loadHistory();
    this._render();
    this._timers.push(setInterval(() => this._loadHistory().then(() => this._render()), 20000));
    this._timers.push(setInterval(() => this._paintLive(), 1000));
  }

  _entities() {
    const c = this._cook || {};
    return [c.grill_entity, c.food_entity].filter(Boolean);
  }

  async _loadHistory() {
    const ids = this._entities();
    if (!this._hass || ids.length === 0) return;
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
        const rows = res[id] || [];
        out[id] = rows
          .map((r) => ({
            t: (r.lu != null ? r.lu * 1000 : Date.parse(r.last_updated)),
            v: parseFloat(r.s != null ? r.s : r.state),
          }))
          .filter((p) => !isNaN(p.v) && !isNaN(p.t));
      }
      this._history = out;
    } catch (e) {
      /* history unavailable; chart just shows what it has */
    }
  }

  _unit(eid) {
    const st = this._hass && this._hass.states[eid];
    return (st && st.attributes.unit_of_measurement) || "°";
  }

  _val(eid) {
    const st = this._hass && this._hass.states[eid];
    if (!st || ["unknown", "unavailable", ""].includes(st.state)) return null;
    const n = parseFloat(st.state);
    return isNaN(n) ? null : n;
  }

  _mark(event, label, color) {
    this._hass.callService("chefstemp_cook", "mark_event", { event, label, color });
  }
  _reset() { this._hass.callService("chefstemp_cook", "reset", {}); }
  _setTarget(v) {
    if (v === "" || v == null) return;
    this._hass.callService("chefstemp_cook", "set_target", { target: Number(v) });
  }

  /* ---------- DOM ---------- */

  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; height:100%;
          background: var(--primary-background-color, #111);
          color: var(--primary-text-color, #eee);
          font-family: var(--paper-font-body1_-_font-family, Roboto, system-ui, sans-serif); }
        .wrap { max-width: 960px; margin: 0 auto; padding: 16px; box-sizing: border-box; }
        .top { display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:12px; }
        .stat { background: var(--card-background-color, #1c1c1c); border-radius:14px;
          padding:12px 16px; min-width:96px; box-shadow: var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,.3)); }
        .stat .k { font-size:12px; opacity:.65; text-transform:uppercase; letter-spacing:.04em; }
        .stat .v { font-size:26px; font-weight:600; line-height:1.1; }
        .stat .v small { font-size:14px; opacity:.6; font-weight:400; }
        .actions { display:flex; gap:10px; flex-wrap:wrap; margin:8px 0 16px; }
        button.act { border:0; border-radius:12px; padding:14px 18px; font-size:15px; font-weight:600;
          color:#fff; cursor:pointer; display:flex; align-items:center; gap:8px; }
        button.act:active { transform: translateY(1px); }
        .note { display:flex; gap:8px; margin:8px 0 16px; flex-wrap:wrap; }
        .note input, .target input { background: var(--card-background-color,#1c1c1c);
          border:1px solid var(--divider-color,#333); color:inherit; border-radius:10px;
          padding:10px 12px; font-size:14px; }
        .note input { flex:1; min-width:160px; }
        .ghost { background: var(--card-background-color,#1c1c1c); color:inherit;
          border:1px solid var(--divider-color,#333); border-radius:10px; padding:10px 14px; cursor:pointer; }
        .card { background: var(--card-background-color,#1c1c1c); border-radius:16px; padding:12px;
          box-shadow: var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,.3)); }
        .target { display:flex; align-items:center; gap:10px; margin:16px 0 8px; }
        .target label { opacity:.75; font-size:14px; }
        svg { width:100%; height:auto; display:block; }
        .evlist { margin-top:12px; display:flex; flex-direction:column; gap:6px; }
        .evrow { display:flex; align-items:center; gap:10px; font-size:14px; }
        .dot { width:10px; height:10px; border-radius:50%; flex:0 0 auto; }
        .muted { opacity:.6; }
        .err { color: var(--error-color, #ff5252); padding:16px; }
        h2 { margin:18px 0 6px; font-size:15px; opacity:.8; font-weight:600; }
      </style>
      <div class="wrap">
        <div id="stats" class="top"></div>
        <div id="actions" class="actions"></div>
        <div class="note">
          <input id="noteInput" placeholder="Add a note (e.g. spritzed, added wood)…" />
          <button class="ghost" id="noteAdd">Add note</button>
          <button class="ghost" id="resetBtn">Reset cook</button>
        </div>
        <div class="target">
          <label>Pull target</label>
          <input id="targetInput" type="number" step="1" style="width:110px" />
          <span id="targetUnit" class="muted"></span>
        </div>
        <div class="card"><div id="chart"></div></div>
        <h2>Cook log</h2>
        <div id="evlist" class="evlist"></div>
        <div id="err" class="err"></div>
      </div>
    `;
    const root = this.shadowRoot;
    root.getElementById("noteAdd").addEventListener("click", () => {
      const el = root.getElementById("noteInput");
      if (el.value.trim()) { this._mark("custom", el.value.trim()); el.value = ""; }
    });
    root.getElementById("noteInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") root.getElementById("noteAdd").click();
    });
    root.getElementById("resetBtn").addEventListener("click", () => this._reset());
    root.getElementById("targetInput").addEventListener("change", (e) => this._setTarget(e.target.value));
  }

  _error(m) {
    if (this.shadowRoot.getElementById("err")) this.shadowRoot.getElementById("err").textContent = m;
  }

  _render() {
    if (!this._built || !this._cook) return;
    this._renderActions();
    this._paintLive();
    this._renderTargetUnit();
    this._renderChart();
    this._renderEvents();
  }

  _renderActions() {
    const box = this.shadowRoot.getElementById("actions");
    const quick = (this._cook && this._cook.quick_events) || [];
    box.innerHTML = "";
    for (const e of quick) {
      const b = document.createElement("button");
      b.className = "act";
      b.style.background = e.color;
      b.textContent = e.label;
      b.addEventListener("click", () => this._mark(e.key));
      box.appendChild(b);
    }
  }

  _paintLive() {
    if (!this._built || !this._cook) return;
    const c = this._cook;
    const stats = this.shadowRoot.getElementById("stats");
    const cells = [];
    if (c.grill_entity) {
      const v = this._val(c.grill_entity);
      cells.push(["Grill", v == null ? "—" : v, this._unit(c.grill_entity)]);
    }
    if (c.food_entity) {
      const v = this._val(c.food_entity);
      cells.push(["Food", v == null ? "—" : v, this._unit(c.food_entity)]);
    }
    const elapsed = c.started_at ? Math.floor((Date.now() / 1000 - c.started_at) / 60) : 0;
    cells.push(["Elapsed", `${elapsed}`, "min"]);
    cells.push(["Stage", c.stage || "Idle", ""]);
    stats.innerHTML = cells
      .map(([k, v, u]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}<small> ${u}</small></div></div>`)
      .join("");
  }

  _renderTargetUnit() {
    const c = this._cook;
    const ti = this.shadowRoot.getElementById("targetInput");
    if (document.activeElement !== ti && c.target != null) ti.value = c.target;
    this.shadowRoot.getElementById("targetUnit").textContent =
      c.food_entity ? this._unit(c.food_entity) : "";
  }

  _renderEvents() {
    const c = this._cook;
    const box = this.shadowRoot.getElementById("evlist");
    if (!c.events || !c.events.length) {
      box.innerHTML = `<div class="muted">No events yet — tap an action above.</div>`;
      return;
    }
    box.innerHTML = c.events
      .slice()
      .reverse()
      .map((ev) => {
        const d = new Date(ev.ts * 1000);
        const hh = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return `<div class="evrow"><span class="dot" style="background:${ev.color}"></span>
          <span>${ev.label}</span><span class="muted">· ${hh}</span></div>`;
      })
      .join("");
  }

  _renderChart() {
    const c = this._cook;
    const host = this.shadowRoot.getElementById("chart");
    const W = 900, H = 340, ml = 44, mr = 14, mt = 14, mb = 26;
    const series = [];
    if (c.grill_entity) series.push({ id: c.grill_entity, color: "#fb8c00", pts: this._history[c.grill_entity] || [] });
    if (c.food_entity) series.push({ id: c.food_entity, color: "#e53935", pts: this._history[c.food_entity] || [] });

    // live points appended so the line reaches "now"
    const now = Date.now();
    for (const s of series) {
      const v = this._val(s.id);
      if (v != null) s.pts = s.pts.concat([{ t: now, v }]);
    }
    const all = series.flatMap((s) => s.pts);
    if (all.length === 0) {
      host.innerHTML = `<div class="muted" style="padding:24px;text-align:center">Waiting for temperature history…</div>`;
      return;
    }
    const t0 = c.started_at ? Math.min(c.started_at * 1000, ...all.map((p) => p.t)) : Math.min(...all.map((p) => p.t));
    const t1 = Math.max(now, ...all.map((p) => p.t));
    let vmin = Math.min(...all.map((p) => p.v));
    let vmax = Math.max(...all.map((p) => p.v));
    if (c.target != null) { vmin = Math.min(vmin, c.target); vmax = Math.max(vmax, c.target); }
    const pad = Math.max(5, (vmax - vmin) * 0.1);
    vmin -= pad; vmax += pad;

    const X = (t) => ml + ((t - t0) / Math.max(1, t1 - t0)) * (W - ml - mr);
    const Y = (v) => mt + (1 - (v - vmin) / Math.max(1e-6, vmax - vmin)) * (H - mt - mb);

    const path = (pts) =>
      pts.length
        ? "M" + pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" L")
        : "";

    // y gridlines
    let grid = "";
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = vmin + (i / steps) * (vmax - vmin);
      const y = Y(v);
      grid += `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="var(--divider-color,#333)" stroke-width="0.5"/>`;
      grid += `<text x="${ml - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--secondary-text-color,#999)">${Math.round(v)}</text>`;
    }
    // time ticks
    for (let i = 0; i <= 4; i++) {
      const t = t0 + (i / 4) * (t1 - t0);
      const x = X(t);
      const hh = new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      grid += `<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--secondary-text-color,#999)">${hh}</text>`;
    }
    // target line
    let target = "";
    if (c.target != null) {
      const y = Y(c.target);
      target = `<line x1="${ml}" y1="${y}" x2="${W - mr}" y2="${y}" stroke="#9e9e9e" stroke-width="1.5" stroke-dasharray="4 4"/>
        <text x="${W - mr}" y="${y - 4}" text-anchor="end" font-size="10" fill="#9e9e9e">target ${c.target}</text>`;
    }
    // event markers
    let markers = "";
    for (const ev of c.events || []) {
      const x = X(ev.ts * 1000);
      if (x < ml || x > W - mr) continue;
      markers += `<line x1="${x}" y1="${mt}" x2="${x}" y2="${H - mb}" stroke="${ev.color}" stroke-width="1.5" stroke-dasharray="3 3"/>
        <text x="${x + 3}" y="${mt + 10}" font-size="10" fill="${ev.color}">${this._esc(ev.label)}</text>`;
    }
    const lines = series
      .map((s) => `<path d="${path(s.pts)}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>`)
      .join("");

    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${grid}${target}${markers}${lines}</svg>`;
  }

  _esc(s) {
    return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  }
}

customElements.define("chefstemp-cook-panel", ChefsTempCookPanel);
