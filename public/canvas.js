// Renders "canvas" layouts: a fixed-size HUD (e.g. 1024x768) scaled to fit the screen,
// with regions that page through panels. Element coordinates are canvas pixels;
// panel elements are relative to their region.
(() => {
  const NS = "deck-canvas";
  // Shown text goes through the deck's language (i18n.js); English when it isn't loaded.
  const tr = (s) => (window.DeckI18n ? window.DeckI18n.t(s) : s);

  let current = null; // the deck drawn last; a new one replaces it (switching layouts)
  let penSeen = false; // a pen has drawn on a notepad, so fingers there are a resting palm

  window.renderCanvas = function renderCanvas(layout, D) {
    if (current) current.dispose();
    const [W, H] = layout.canvas;
    const stage = document.getElementById("stage");
    const canvas = document.getElementById("canvas");
    stage.hidden = false;
    // Small canvases (phone layouts) get tighter menus; wide ones ask phones to turn sideways.
    canvas.classList.toggle("compact", H < 500);
    stage.classList.toggle("landscape-only", W > H * 1.5);
    stage.querySelector(".hud-rotate")?.remove(); // its text follows the language
    stage.insertAdjacentHTML("beforeend", `<div class="hud-rotate"><span class="hud-ico">${D.deckIcon("swap")}</span>${tr("Turn your phone sideways")}</div>`);

    // Separate stores per canvas size, so phone and tablet keep their own page positions.
    const key = `${NS}-${W}x${H}`;
    const saved = (() => { try { return JSON.parse(D.store.get(key) || "{}"); } catch { return {}; } })();
    const state = { groups: saved.groups || {}, panels: saved.panels || {} };
    const save = () => D.store.set(key, JSON.stringify(state));

    // Fill the whole stage (which CSS keeps inside the safe area, clear of the iPhone's
    // Dynamic Island and home indicator). Text and icons scale uniformly by `s`; when the
    // screen's shape differs from the layout's, element boxes stretch along the longer
    // axis by kx/ky so there are no empty bands.
    let s = 1, kx = 1, ky = 1;
    const scaleNow = () => s;
    function measure() {
      const aw = stage.clientWidth || W, ah = stage.clientHeight || H;
      s = Math.min(aw / W, ah / H);
      const nkx = aw / s / W, nky = ah / s / H;
      const changed = Math.abs(nkx - kx) > 0.002 || Math.abs(nky - ky) > 0.002;
      kx = nkx; ky = nky;
      canvas.style.width = `${W * kx}px`;
      canvas.style.height = `${H * ky}px`;
      canvas.style.transform = `translate(-50%, -50%) scale(${s})`;
      return changed;
    }
    const fit = () => { if (measure()) render(); };
    const turned = () => setTimeout(fit, 250);
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", turned);
    measure();

    // Layout coordinates are in design pixels; place them on the stretched canvas.
    const box = (el, e) => {
      el.style.left = `${e.x * kx}px`;
      el.style.top = `${e.y * ky}px`;
      if (e.w !== undefined) el.style.width = `${e.w * kx}px`;
      if (e.h !== undefined) el.style.height = `${e.h * ky}px`;
      return el;
    };
    const make = (tag, cls, html) => {
      const el = document.createElement(tag);
      el.className = cls;
      if (html !== undefined) el.innerHTML = html;
      return el;
    };
    const text = (el, sel, value) => { el.querySelector(sel).textContent = tr(value); return el; };
    // Each switch group starts on the first value its switch lists.
    const groupDefaults = {};
    (function scan(node) {
      if (Array.isArray(node)) { node.forEach(scan); return; }
      if (!node || typeof node !== "object") return;
      if (node.type === "switch" && !(node.group in groupDefaults)) groupDefaults[node.group] = node.values[0];
      for (const v of Object.values(node)) if (v && typeof v === "object") scan(v);
    })(layout);
    const groupValue = (g, values) => state.groups[g] || groupDefaults[g] || (values && values[0]);

    // ---------- element renderers ----------

    function hudButton(def, style) {
      const el = make("button", `hud-btn s-${style || def.style || "std"}`);
      el.type = "button";
      el.dataset.color = def.color || "";
      const icon = def.icon ? `<span class="hud-ico">${D.deckIcon(def.icon)}</span>` : "";
      const s = style || def.style || "std";
      if (s === "top" || s === "chev") {
        el.innerHTML = icon || `<span class="hud-lbl"></span>`;
        if (!def.icon) text(el, ".hud-lbl", def.label);
      } else if (s === "dial") {
        el.innerHTML = `<span class="hud-lbl"></span><span class="dial"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16"/><path d="M20 4a16 16 0 0 1 16 16"/></svg></span>`;
        text(el, ".hud-lbl", def.label);
      } else {
        el.innerHTML = `${icon}<span class="hud-lbl"></span>`;
        text(el, ".hud-lbl", def.label);
      }
      el.setAttribute("aria-label", tr(def.label));
      el.title = `${tr(def.label)} — ${def.keys}`;
      D.bindButton(el, def);
      return el;
    }

    const R = {
      button: (e) => box(hudButton(e), e),

      action(e) {
        // icon "emblem" shows the current manufacturer emblem (updated when the theme changes).
        const ico = e.icon === "emblem"
          ? `<span class="hud-ico hud-emblem js-emblem">${D.emblemHtml()}</span>`
          : `<span class="hud-ico">${D.deckIcon(e.icon)}</span>`;
        const el = box(make("button", "hud-btn s-top", ico), e);
        el.type = "button";
        el.onclick = e.action === "theme" ? D.openPicker : D.toggleFullscreen;
        el.setAttribute("aria-label", tr(e.action === "theme" ? "Deck settings" : "Fullscreen"));
        return el;
      },

      // Hold-to-talk mic for voice commands; hidden when they're turned off on the PC.
      // An optional "label" shows next to the mic.
      talk(e) {
        const el = box(make("button", "hud-btn s-top js-talk", `<span class="hud-ico">${D.deckIcon("mic")}</span>${e.label ? `<span class="hud-lbl"></span>` : ""}`), e);
        if (e.label) text(el, ".hud-lbl", e.label);
        el.type = "button";
        el.setAttribute("aria-label", tr("Hold to talk"));
        D.bindTalk(el);
        return el;
      },

      // Opens the list of voice commands; hidden with the mic when voice is off on the PC.
      voicehelp(e) {
        const el = box(make("button", "hud-btn s-top js-voice", `<span class="hud-ico">${D.deckIcon("help")}</span>`), e);
        el.type = "button";
        el.setAttribute("aria-label", tr("Voice commands list"));
        el.onclick = D.openVoiceHelp;
        return el;
      },

      status: (e) => box(make("div", "hud-status", `<span class="js-dot dot"></span><span class="js-status">Connecting…</span>`), e),

      rule: (e) => box(make("div", "hud-rule", "<i></i><i></i>"), e),
      divider: (e) => box(make("div", "hud-divider"), e),

      header: (e) => text(box(make("div", "hud-header", `<b>//</b><span></span>`), e), "span", e.text),

      "state-header"(e) {
        const values = Object.keys(e.labels);
        const cur = groupValue(e.group, values);
        const el = box(make("div", "hud-header state", `<div><b>//</b><span class="a"></span> <em>_ :${tr("ENABLED")}</em></div><div class="b"></div>`), e);
        text(el, ".a", e.labels[cur]);
        text(el, ".b", values.filter((v) => v !== cur).map((v) => e.labels[v]).join(" · "));
        return el;
      },

      switch(e) {
        const el = box(make("button", "hud-btn s-switch", `<span class="hud-lbl"></span>`), e);
        el.type = "button";
        text(el, ".hud-lbl", e.label);
        el.onclick = () => {
          const cur = groupValue(e.group, e.values);
          state.groups[e.group] = e.values[(e.values.indexOf(cur) + 1) % e.values.length];
          save();
          render();
        };
        return el;
      },

      vlabel: (e) => text(box(make("div", "hud-vlabel", "<span></span>"), e), "span", e.text),

      caption(e) {
        const el = box(make("div", "hud-caption", `<span class="hud-ico">${D.deckIcon(e.icon)}</span><span class="t"></span>`), e);
        el.dataset.color = e.color || "";
        return text(el, ".t", e.text);
      },

      bracket: (e) => box(make("div", "hud-bracket",
        `<svg viewBox="0 0 380 24" preserveAspectRatio="none"><path d="M2 2v8h120l10 10h116l10-10h120V2"/><path d="m184 12 6 6 6-6Z" class="f"/></svg>`), e),

      "danger-zone": (e) => box(make("div", "hud-danger"), e),

      slider(e) {
        const el = box(make("div", "hud-slider", `<div class="track"><span class="txt"></span></div><div class="knob"></div>`), e);
        text(el, ".txt", e.label);
        const knob = el.querySelector(".knob");
        const max = e.w * kx - 26;
        let start = null, pos = 0;
        const setPos = (p) => { pos = Math.max(0, Math.min(max, p)); knob.style.transform = `translateX(${pos}px)`; el.style.setProperty("--fill", `${(pos / max) * 100}%`); };
        knob.addEventListener("pointerdown", (ev) => {
          knob.setPointerCapture(ev.pointerId);
          start = ev.clientX - pos * scaleNow();
          el.classList.add("dragging");
        });
        knob.addEventListener("pointermove", (ev) => { if (start !== null) setPos((ev.clientX - start) / scaleNow()); });
        const end = () => {
          if (start === null) return;
          start = null;
          el.classList.remove("dragging");
          if (pos >= max * 0.94) {
            D.send({ t: "tap", id: e.id });
            D.buzz(40);
            window.DeckFX.pulse(el, "eject");
            el.classList.add("fired");
            setTimeout(() => el.classList.remove("fired"), 600);
          }
          knob.style.transition = "transform .25s ease";
          setPos(0);
          setTimeout(() => (knob.style.transition = ""), 260);
        };
        knob.addEventListener("pointerup", end);
        knob.addEventListener("pointercancel", end);
        return el;
      },

      menu(e) {
        const el = box(make("button", "hud-btn s-std s-menu", `<span class="hud-lbl"></span><span class="caret">▾</span>`), e);
        el.type = "button";
        text(el, ".hud-lbl", e.label);
        el.onclick = () => openMenu(e);
        return el;
      },

      grid(e) {
        const wrap = box(make("div", `hud-grid${e.compact ? " compact" : ""}`), e);
        const rows = Math.ceil(e.buttons.length / e.cols);
        const gap = e.compact ? 8 : 12;
        const cellH = Math.min((e.compact ? 64 : 120) * ky, (e.h * ky - gap * (rows - 1)) / rows);
        wrap.style.gridTemplateColumns = `repeat(${e.cols}, 1fr)`;
        wrap.style.gridAutoRows = `${cellH}px`;
        wrap.style.gap = `${gap}px`;
        for (const b of e.buttons) wrap.appendChild(hudButton(b, e.compact ? "std" : "cell"));
        return wrap;
      },

      notepad: (e) => notepad(e),
    };

    // A page to draw on with a finger or pen, e.g. which cargo goes where. It presses no
    // keys; the drawings stay on this device, kept as strokes in fractions of the pad so
    // they survive redraws, rotation and theme changes (colours are theme tokens).
    const PAGES = 3;
    const INKS = ["text", "accent", "amber", "red"];
    function notepad(e) {
      const storeKey = `notes-${e.id || "notepad"}`;
      const saved = (() => { try { return JSON.parse(D.store.get(storeKey) || "{}"); } catch { return {}; } })();
      const notes = { page: Math.min(saved.page || 0, PAGES - 1), pages: Array.from({ length: PAGES }, (_, i) => (saved.pages || [])[i] || []) };
      const keep = () => D.store.set(storeKey, JSON.stringify(notes));
      const history = []; // this visit's changes on each page, for Undo: a stroke, or a cleared page

      const el = box(make("div", "hud-notepad", `
        <div class="np-bar">
          ${INKS.map((c) => `<button type="button" class="np-tool np-ink" data-ink="${c}" style="--ink:var(--${c})" aria-label="${tr("Pen")}"><i></i></button>`).join("")}
          <button type="button" class="np-tool" data-tool="eraser" aria-label="${tr("Eraser")}">${D.deckIcon("eraser")}</button>
          <span class="np-gap"></span>
          <button type="button" class="np-tool" data-tool="undo" aria-label="${tr("Undo")}">${D.deckIcon("undo")}</button>
          <button type="button" class="np-tool np-clear" data-tool="clear" aria-label="${tr("Clear")}">${D.deckIcon("trash")}<span></span></button>
          <span class="np-gap"></span>
          <button type="button" class="np-tool" data-tool="prev" aria-label="${tr("Previous page")}">${D.deckIcon("chev-left")}</button>
          <span class="np-page"></span>
          <button type="button" class="np-tool" data-tool="next" aria-label="${tr("Next page")}">${D.deckIcon("chev-right")}</button>
        </div>
        <div class="np-sheet"><canvas></canvas><p class="np-empty"></p></div>`), e);
      const sheet = el.querySelector(".np-sheet"), cv = el.querySelector("canvas"), empty = el.querySelector(".np-empty");
      const clearBtn = el.querySelector(".np-clear");
      empty.textContent = tr("Draw or write here. Notes stay on this device.");
      let tool = saved.tool && (INKS.includes(saved.tool) || saved.tool === "eraser") ? saved.tool : "text";
      let ctx = null, ratio = 1;

      const strokes = () => notes.pages[notes.page];
      function paint() {
        if (!ctx) return;
        const w = cv.width / ratio, h = cv.height / ratio, css = getComputedStyle(el);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, w, h);
        for (const st of strokes()) drawStroke(st, w, h, css);
        empty.hidden = strokes().length > 0;
        el.querySelector(".np-page").textContent = `${notes.page + 1}/${PAGES}`;
        for (const b of el.querySelectorAll(".np-tool[data-ink], [data-tool=eraser]")) b.classList.toggle("on", (b.dataset.ink || "eraser") === tool);
      }
      function drawStroke(st, w, h, css) {
        const p = st.p;
        ctx.globalCompositeOperation = st.c === "eraser" ? "destination-out" : "source-over";
        ctx.strokeStyle = ctx.fillStyle = st.c === "eraser" ? "#000" : css.getPropertyValue(`--${st.c}`).trim() || "#fff";
        ctx.lineWidth = st.c === "eraser" ? 26 : 3;
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(p[0] * w, p[1] * h);
        if (p.length === 2) ctx.lineTo(p[0] * w + 0.1, p[1] * h); // a dot
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * w, p[i + 1] * h);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }
      // The canvas gets the sheet's size in screen pixels, so lines stay sharp at any scale.
      function size() {
        const r = sheet.getBoundingClientRect();
        if (!r.width) return;
        ratio = (window.devicePixelRatio || 1) * scaleNow();
        cv.width = Math.round(r.width / scaleNow() * ratio);
        cv.height = Math.round(r.height / scaleNow() * ratio);
        ctx = cv.getContext("2d");
        paint();
      }
      requestAnimationFrame(size);
      // Ink follows the theme, so repaint when it changes.
      const themeWatch = new MutationObserver(() => { if (el.isConnected) paint(); else themeWatch.disconnect(); });
      themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-contrast"] });

      // One stroke at a time. Once a pen has drawn, fingers don't, so a resting palm leaves
      // no marks; a second finger (or the two-finger swipe) ends the stroke.
      let drawing = null;
      cv.addEventListener("pointerdown", (ev) => {
        if (ev.pointerType === "pen") penSeen = true;
        else if (ev.pointerType === "touch" && penSeen) return;
        if (drawing) { finish({ pointerId: drawing.id }); return; }
        ev.preventDefault();
        cv.setPointerCapture(ev.pointerId);
        drawing = { id: ev.pointerId, st: { c: tool, p: [] } };
        add(ev);
        strokes().push(drawing.st);
        paint();
      });
      function add(ev) {
        const r = cv.getBoundingClientRect(), p = drawing.st.p;
        const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
        // Skip points closer than about a pixel to the last, so notes stay small to keep.
        if (p.length && Math.abs(x - p[p.length - 2]) * r.width < 1.5 && Math.abs(y - p[p.length - 1]) * r.height < 1.5) return;
        p.push(Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000);
      }
      function finish(ev) {
        if (!drawing || ev.pointerId !== drawing.id) return;
        history.push({ page: notes.page, stroke: drawing.st });
        drawing = null;
        keep();
      }
      cv.addEventListener("pointermove", (ev) => {
        if (!drawing || ev.pointerId !== drawing.id) return;
        for (const c of ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]) add(c);
        paint();
      });
      cv.addEventListener("pointerup", finish);
      cv.addEventListener("pointercancel", finish);

      let clearArmed = null;
      const disarm = () => { clearTimeout(clearArmed); clearArmed = null; clearBtn.classList.remove("armed"); clearBtn.querySelector("span").textContent = ""; };
      el.querySelector(".np-bar").addEventListener("click", (ev) => {
        const b = ev.target.closest(".np-tool");
        if (!b) return;
        const t = b.dataset.ink || b.dataset.tool;
        if (t !== "clear") disarm();
        if (INKS.includes(t) || t === "eraser") tool = t;
        else if (t === "undo") {
          for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].page !== notes.page) continue;
            const [h] = history.splice(i, 1);
            if (h.cleared) notes.pages[h.page] = h.cleared;
            else notes.pages[h.page] = strokes().filter((s) => s !== h.stroke);
            break;
          }
        } else if (t === "clear") {
          // Clearing asks first: the first tap arms it, a second within 3 s clears the page.
          if (!clearArmed) {
            if (!strokes().length) return;
            clearBtn.classList.add("armed");
            clearBtn.querySelector("span").textContent = tr("Clear page?");
            clearArmed = setTimeout(disarm, 3000);
            return;
          }
          disarm();
          history.push({ page: notes.page, cleared: strokes() });
          notes.pages[notes.page] = [];
        } else if (t === "prev" || t === "next") notes.page = (notes.page + (t === "next" ? 1 : PAGES - 1)) % PAGES;
        if (D.buzz) D.buzz(10);
        notes.tool = tool;
        keep();
        paint();
      });
      return el;
    }


    function openMenu(e) {
      const overlay = make("div", "hud-menu", `<div class="sheet"><div class="hud-header"><b>//</b><span></span></div><div class="opts"></div></div>`);
      text(overlay, ".hud-header span", e.title || e.label);
      const opts = overlay.querySelector(".opts");
      for (const o of e.options) {
        const b = hudButton(o, "cell");
        b.addEventListener("pointerup", () => setTimeout(() => overlay.remove(), 120));
        opts.appendChild(b);
      }
      overlay.addEventListener("pointerdown", (ev) => { if (ev.target === overlay) overlay.remove(); });
      canvas.appendChild(overlay);
    }

    function renderElements(parent, elements) {
      for (const e of elements) {
        if (e.when && groupValue(e.when[0]) !== e.when[1]) continue;
        const fn = R[e.type];
        if (fn) parent.appendChild(fn(e));
      }
    }

    // Set while paging, so the region's new panel slides in from that side.
    let slide = null;

    // Moves a region (one half of the HUD) d panels on, as its pager arrows do.
    function page(regionId, d) {
      const region = layout.regions.find((r) => r.id === regionId);
      if (!region) return;
      const n = region.panels.length;
      state.panels[regionId] = (Math.min(state.panels[regionId] || 0, n - 1) + d + n) % n;
      save();
      slide = { region: regionId, dir: d };
      render();
      slide = null;
    }

    function renderRegion(region) {
      const el = box(make("div", "hud-region"), region);
      el.dataset.region = region.id;
      const pagerH = region.pager || 44; // pager bar height; phone layouts use a slimmer one
      el.style.setProperty("--pager-h", `${pagerH}px`);
      const ids = region.panels;
      const idx = Math.min(state.panels[region.id] || 0, ids.length - 1);
      const panel = layout.panels[ids[idx]];
      const body = make("div", "hud-panel");
      if (slide && slide.region === region.id) body.classList.add(slide.dir > 0 ? "enter-next" : "enter-prev");
      body.style.height = `${region.h * ky - pagerH - 8}px`;
      renderElements(body, panel.elements);
      el.appendChild(body);

      const pager = make("div", "hud-pager",
        `<button type="button" class="hud-btn s-pg prev" aria-label="${tr("Previous panel")}">${D.deckIcon("chev-left")}</button>
         <div class="title"><span></span><div class="dots"></div></div>
         <button type="button" class="hud-btn s-pg next" aria-label="${tr("Next panel")}">${D.deckIcon("chev-right")}</button>`);
      text(pager, ".title span", panel.title);
      pager.querySelector(".dots").innerHTML = ids.map((_, i) => `<i class="${i === idx ? "on" : ""}"></i>`).join("");
      const go = (d) => page(region.id, d);
      pager.querySelector(".prev").onclick = () => go(-1);
      pager.querySelector(".next").onclick = () => go(1);
      el.appendChild(pager);
      return el;
    }

    function render() {
      canvas.innerHTML = "";
      renderElements(canvas, layout.chrome || []);
      for (const region of layout.regions) canvas.appendChild(renderRegion(region));
      D.refreshStatus();
      if (D.afterRender) D.afterRender();
    }

    render();
    // The layout editor redraws after changing the layout, and asks which panels are showing.
    current = {
      render,
      panelShown: (regionId) => state.panels[regionId] || 0,
      // Pages the half at screen point (x, y), for the two-finger swipe; false if none is there.
      pageAt(x, y, d) {
        for (const el of canvas.querySelectorAll(".hud-region")) {
          const r = el.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { page(el.dataset.region, d); return true; }
        }
        return false;
      },
      scale: scaleNow,
      // Stops this deck redrawing itself, before another layout is drawn or a grid layout shown.
      dispose() {
        window.removeEventListener("resize", fit);
        window.removeEventListener("orientationchange", turned);
        if (current === this) current = null;
      },
    };
    return current;
  };
})();
