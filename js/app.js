(function () {
  "use strict";

  const PIN_LEN = 4;
  const LS = {
    pinHash: "index_pin_hash",
    pinSalt: "index_pin_salt",
    pinEnabled: "index_pin_enabled",
    favorites: "index_favorites",
    ageOk: "index_age_ok"
  };

  const TAG_LABELS = {
    hotwife: "Hotwife",
    cuckold: "Cuckold",
    cuckquean: "Cuckquean",
    couple: "Couple",
    bbc: "BBC",
    "femdom-cuck": "Femdom-cuck",
    bnwo: "BNWO",
    snowbunny: "Snowbunny",
    qos: "QoS",
    extreme: "Extreme"
  };

  const state = {
    pinBuffer: "",
    settingPin: false,
    confirmPin: null,
    creators: [],
    updated: "",
    query: "",
    tag: "all",
    sort: "name",
    favorites: []
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  function copyViaTextarea(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.padding = "0";
    ta.style.border = "0";
    ta.style.outline = "none";
    ta.style.boxShadow = "none";
    ta.style.background = "transparent";
    ta.style.opacity = "0";
    ta.style.fontSize = "16px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    // iOS Safari standalone often blocks the Clipboard API after the
    // user-gesture window; execCommand in the same tap is more reliable.
    if (isStandalone()) {
      if (copyViaTextarea(text)) return Promise.resolve(true);
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text)
        .then(() => true)
        .catch(() => copyViaTextarea(text));
    }
    return Promise.resolve(copyViaTextarea(text));
  }

  function handleFromUrl(url) {
    if (!url) return "";
    const m = String(url).match(/(?:x\.com|twitter\.com)\/([^/?#]+)/i);
    if (!m) return "";
    try {
      return decodeURIComponent(m[1]).replace(/^@/, "");
    } catch (e) {
      return m[1].replace(/^@/, "");
    }
  }

  const COPY_ICON =
    '<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

  function copyChip(handle, label) {
    const at = "@" + handle;
    const aria = label ? "Copy " + label + " handle " + at : "Copy " + at;
    return (
      '<button class="copy-chip" type="button" data-copy="' + escapeHtml(at) + '" aria-label="' + escapeHtml(aria) + '">' +
        (label ? '<span class="copy-chip-label">' + escapeHtml(label) + "</span>" : "") +
        '<span class="copy-chip-handle">@' + escapeHtml(handle) + "</span>" +
        COPY_ICON +
      "</button>"
    );
  }

  function handleChips(c) {
    const ofHandle = c.handle || "";
    const xHandle = handleFromUrl(c.links && c.links.x);
    const chips = [];
    if (ofHandle) {
      const distinctX = xHandle && xHandle.toLowerCase() !== ofHandle.toLowerCase();
      chips.push(copyChip(ofHandle, distinctX ? "OF" : ""));
      if (distinctX) chips.push(copyChip(xHandle, "X"));
    }
    return '<div class="handle-row">' + chips.join("") + "</div>";
  }

  async function sha256(str) {
    const data = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function randomSalt() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function hashPin(pin, salt) {
    return sha256(salt + ":" + pin);
  }

  function loadJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initial(name) {
    const t = String(name || "").trim();
    const ch = t.charAt(0);
    return /[A-Za-z0-9]/.test(ch) ? ch.toUpperCase() : "#";
  }

  function formatUpdated(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return iso;
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  /* ---------- PIN ---------- */
  function pinEnabled() {
    return localStorage.getItem(LS.pinEnabled) === "1" && !!localStorage.getItem(LS.pinHash);
  }

  function updatePinDots(error) {
    $$(".pin-dot").forEach((d, i) => {
      d.classList.toggle("filled", i < state.pinBuffer.length);
      d.classList.toggle("error", !!error);
    });
  }

  function showLock(mode) {
    $("#age-screen").classList.add("hidden");
    $("#lock-screen").classList.remove("hidden");
    $("#app").classList.add("hidden");
    state.pinBuffer = "";
    state.settingPin = mode === "set" || mode === "change";
    if (mode !== "confirm") state.confirmPin = null;
    const title = $("#lock-title");
    const sub = $("#lock-sub");
    if (mode === "set") {
      title.textContent = "Create a PIN";
      sub.textContent = "Optional lock for Index on this device.";
    } else if (mode === "confirm") {
      title.textContent = "Confirm PIN";
      sub.textContent = "Enter the same PIN again.";
    } else if (mode === "change") {
      title.textContent = "New PIN";
      sub.textContent = "Enter a new 4-digit PIN.";
    } else {
      title.textContent = "Enter PIN";
      sub.textContent = "Index is locked.";
    }
    $("#lock-error").textContent = "";
    updatePinDots(false);
  }

  function unlockApp() {
    sessionStorage.setItem("index_session_ok", "1");
    $("#age-screen").classList.add("hidden");
    $("#lock-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    renderAll();
  }

  async function onPinComplete(pin) {
    const errEl = $("#lock-error");
    if (state.settingPin && state.confirmPin === null) {
      state.confirmPin = pin;
      state.pinBuffer = "";
      showLock("confirm");
      state.settingPin = true;
      return;
    }
    if (state.settingPin && state.confirmPin !== null) {
      if (pin !== state.confirmPin) {
        errEl.textContent = "PINs didn’t match. Try again.";
        state.confirmPin = null;
        state.pinBuffer = "";
        updatePinDots(true);
        setTimeout(() => showLock("set"), 450);
        return;
      }
      const salt = randomSalt();
      localStorage.setItem(LS.pinSalt, salt);
      localStorage.setItem(LS.pinHash, await hashPin(pin, salt));
      localStorage.setItem(LS.pinEnabled, "1");
      state.confirmPin = null;
      state.settingPin = false;
      toast("PIN enabled");
      unlockApp();
      syncPinToggle();
      return;
    }
    const salt = localStorage.getItem(LS.pinSalt);
    const expected = localStorage.getItem(LS.pinHash);
    if ((await hashPin(pin, salt)) === expected) {
      unlockApp();
    } else {
      errEl.textContent = "Wrong PIN";
      state.pinBuffer = "";
      updatePinDots(true);
      setTimeout(() => updatePinDots(false), 400);
    }
  }

  function bindPinPad() {
    $$(".pin-key").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.key;
        if (k === "del") {
          state.pinBuffer = state.pinBuffer.slice(0, -1);
          updatePinDots(false);
          return;
        }
        if (k === "ok") return;
        if (state.pinBuffer.length >= PIN_LEN) return;
        state.pinBuffer += k;
        updatePinDots(false);
        if (state.pinBuffer.length === PIN_LEN) onPinComplete(state.pinBuffer);
      });
    });
  }

  function syncPinToggle() {
    const on = pinEnabled();
    $("#pin-toggle").classList.toggle("on", on);
    $("#pin-toggle-label").textContent = on ? "On" : "Off";
  }

  /* ---------- Data / favorites ---------- */
  function isFav(id) {
    return state.favorites.indexOf(id) !== -1;
  }

  function toggleFav(id) {
    if (isFav(id)) {
      state.favorites = state.favorites.filter((x) => x !== id);
      toast("Removed from favorites");
    } else {
      state.favorites = state.favorites.concat([id]);
      toast("Saved to favorites");
    }
    localStorage.setItem(LS.favorites, JSON.stringify(state.favorites));
    renderList();
    renderFavorites();
  }

  function filtered() {
    const q = state.query.trim().toLowerCase();
    let list = state.creators.slice();
    if (state.tag !== "all") {
      list = list.filter((c) => (c.tags || []).indexOf(state.tag) !== -1);
    }
    if (q) {
      list = list.filter((c) => {
        const blob = [c.name, c.handle, c.description, (c.tags || []).join(" "), c.price || ""].join(" ").toLowerCase();
        return blob.indexOf(q) !== -1;
      });
    }
    list.sort((a, b) => {
      if (state.sort === "free") {
        const ar = a.access === "free" ? 0 : a.access === "free-trial" ? 1 : 2;
        const br = b.access === "free" ? 0 : b.access === "free-trial" ? 1 : 2;
        if (ar !== br) return ar - br;
      } else if (state.sort === "paid") {
        const ar = a.access === "paid" ? 0 : a.access === "free-trial" ? 1 : 2;
        const br = b.access === "paid" ? 0 : b.access === "free-trial" ? 1 : 2;
        if (ar !== br) return ar - br;
      } else if (state.sort === "extreme") {
        const ar = (a.tags || []).indexOf("extreme") !== -1 ? 0 : 1;
        const br = (b.tags || []).indexOf("extreme") !== -1 ? 0 : 1;
        if (ar !== br) return ar - br;
      }
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
    });
    return list;
  }

  function accessLabel(c) {
    if (c.access === "free") return c.price || "Free";
    if (c.access === "free-trial") return c.price || "Free trial";
    return c.price ? c.price + "/mo" : "Paid";
  }

  function accessClass(c) {
    if (c.access === "free") return "access-free";
    if (c.access === "free-trial") return "access-free-trial";
    return "access-paid";
  }

  function avatarHtml(c) {
    const init = escapeHtml(initial(c.name));
    if (c.avatar) {
      return (
        '<div class="avatar" aria-hidden="true">' +
          '<img src="' + escapeHtml(c.avatar) + '" alt="" width="48" height="48" loading="lazy" decoding="async" onerror="this.remove()">' +
          init +
        "</div>"
      );
    }
    return '<div class="avatar" aria-hidden="true">' + init + "</div>";
  }

  function cardHtml(c) {
    const on = isFav(c.id);
    const tags = (c.tags || [])
      .map((t) => '<span class="tag' + (t === "extreme" || t === "qos" ? " tag-" + t : "") + '">' + escapeHtml(TAG_LABELS[t] || t) + "</span>")
      .join("");
    const links = [];
    const of = (c.links && c.links.onlyfans) || c.onlyfans;
    if (of) links.push('<a href="' + escapeHtml(of) + '" target="_blank" rel="noopener noreferrer">OnlyFans</a>');
    if (c.links && c.links.x) links.push('<a href="' + escapeHtml(c.links.x) + '" target="_blank" rel="noopener noreferrer">X</a>');
    if (c.links && c.links.instagram) links.push('<a href="' + escapeHtml(c.links.instagram) + '" target="_blank" rel="noopener noreferrer">Instagram</a>');
    return (
      '<article class="creator-card" data-id="' + escapeHtml(c.id) + '">' +
        '<div class="creator-top">' +
          avatarHtml(c) +
          '<div class="creator-meta">' +
            '<p class="creator-name">' + escapeHtml(c.name) + "</p>" +
            handleChips(c) +
          "</div>" +
          '<button class="fav-btn' + (on ? " on" : "") + '" type="button" data-fav="' + escapeHtml(c.id) + '" aria-label="' + (on ? "Remove favorite" : "Add favorite") + '">' +
            (on
              ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>') +
          "</button>" +
        "</div>" +
        '<p class="creator-desc">' + escapeHtml(c.description) + "</p>" +
        '<div class="tag-row">' +
          '<span class="tag ' + accessClass(c) + '">' + escapeHtml(accessLabel(c)) + "</span>" +
          tags +
        "</div>" +
        (links.length ? '<div class="link-row">' + links.join("") + "</div>" : "") +
      "</article>"
    );
  }

  function renderList() {
    const list = filtered();
    const box = $("#creator-list");
    box.innerHTML = list.map(cardHtml).join("");
    $("#empty-dir").classList.toggle("hidden", list.length > 0);
    $("#result-count").textContent = list.length + " of " + state.creators.length;
    bindFavButtons(box);
  }

  function renderFavorites() {
    const favs = state.creators.filter((c) => isFav(c.id));
    favs.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
    const box = $("#favorites-list");
    box.innerHTML = favs.map(cardHtml).join("");
    $("#empty-favs").classList.toggle("hidden", favs.length > 0);
    bindFavButtons(box);
  }

  function bindFavButtons(root) {
    $$("[data-fav]", root).forEach((btn) => {
      btn.addEventListener("click", () => toggleFav(btn.getAttribute("data-fav")));
    });
    $$("[data-copy]", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        const value = btn.getAttribute("data-copy") || "";
        if (!value) return;
        copyText(value).then((ok) => {
          toast(ok ? "Copied " + value : "Couldn’t copy");
        });
      });
    });
  }

  function renderChips() {
    const used = {};
    state.creators.forEach((c) => (c.tags || []).forEach((t) => { used[t] = true; }));
    const order = ["hotwife", "cuckold", "cuckquean", "couple", "bbc", "femdom-cuck", "bnwo", "snowbunny", "qos", "extreme"];
    const tags = order.filter((t) => used[t]);
    const box = $("#tag-chips");
    const items = [{ id: "all", label: "All" }].concat(tags.map((t) => ({ id: t, label: TAG_LABELS[t] || t })));
    box.innerHTML = items
      .map((t) => '<button class="chip' + (state.tag === t.id ? " active" : "") + '" type="button" data-tag="' + t.id + '">' + escapeHtml(t.label) + "</button>")
      .join("");
    $$("[data-tag]", box).forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tag = btn.getAttribute("data-tag");
        renderChips();
        renderList();
      });
    });
  }

  function renderSettings() {
    $("#creator-count").textContent = String(state.creators.length);
    $("#updated-date").textContent = formatUpdated(state.updated);
    syncPinToggle();
  }

  function renderAll() {
    const n = state.creators.length;
    $("#header-sub").textContent = n ? n + " creators · updated " + formatUpdated(state.updated) : "";
    renderChips();
    renderList();
    renderFavorites();
    renderSettings();
  }

  function showView(name) {
    $$(".view").forEach((el) => el.classList.toggle("active", el.id === "view-" + name));
    $$(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.getAttribute("data-tab") === name));
    const titles = { directory: "Index", favorites: "Favorites", settings: "Settings" };
    $("#header-title").textContent = titles[name] || "Index";
  }

  async function loadCreators() {
    const res = await fetch("./data/creators.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not load directory");
    const data = await res.json();
    state.creators = data.creators || [];
    state.updated = data.updated || "";
  }

  function gate() {
    if (localStorage.getItem(LS.ageOk) !== "1") {
      $("#age-screen").classList.remove("hidden");
      $("#lock-screen").classList.add("hidden");
      $("#app").classList.add("hidden");
      return;
    }
    if (pinEnabled() && sessionStorage.getItem("index_session_ok") !== "1") {
      showLock("enter");
      return;
    }
    unlockApp();
  }

  function bind() {
    bindPinPad();
    $("#btn-age-ok").addEventListener("click", () => {
      localStorage.setItem(LS.ageOk, "1");
      gate();
    });
    $$(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.getAttribute("data-tab")));
    });
    $("#search").addEventListener("input", (e) => {
      state.query = e.target.value;
      renderList();
    });
    $("#sort").addEventListener("change", (e) => {
      state.sort = e.target.value;
      renderList();
    });
    $("#pin-toggle").addEventListener("click", () => {
      if (pinEnabled()) {
        localStorage.setItem(LS.pinEnabled, "0");
        toast("PIN lock off");
        syncPinToggle();
      } else if (localStorage.getItem(LS.pinHash)) {
        localStorage.setItem(LS.pinEnabled, "1");
        toast("PIN lock on");
        syncPinToggle();
      } else {
        showLock("set");
      }
    });
    $("#btn-change-pin").addEventListener("click", () => showLock("change"));
    $("#btn-lock-now").addEventListener("click", () => {
      if (!pinEnabled()) { toast("Enable PIN first"); return; }
      sessionStorage.removeItem("index_session_ok");
      showLock("enter");
    });
    $("#btn-clear-favs").addEventListener("click", () => {
      $("#confirm-clear").classList.remove("hidden");
    });
    $("#confirm-clear-cancel").addEventListener("click", () => {
      $("#confirm-clear").classList.add("hidden");
    });
    $("#confirm-clear-ok").addEventListener("click", () => {
      state.favorites = [];
      localStorage.setItem(LS.favorites, "[]");
      $("#confirm-clear").classList.add("hidden");
      renderList();
      renderFavorites();
      toast("Favorites cleared");
    });
  }

  async function init() {
    state.favorites = loadJSON(LS.favorites, []);
    bind();
    try {
      await loadCreators();
    } catch (err) {
      console.error(err);
      toast("Could not load the directory");
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
    gate();
  }

  init();
})();
