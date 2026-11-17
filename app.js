(() => {
  "use strict";

  const { version, components, parts = [], items } = window.GAME_DATA;
  const MAX_TRIES = 6;
  const IMG_DIR = "assets/items/";

  // Three endless modes. Each has its own objectives, saved game and stats.
  const MODES = {
    imposter: {
      label: "Imposter",
      objectives: ["imp", "item"],
      intro: "Here's a full recipe, but I slipped an <b>imposter</b> component in. Find it, and tell me what the real recipe builds into.",
      tip: "Tap the imposter tile, then type the finished item.",
    },
    missing: {
      label: "Missing",
      objectives: ["miss", "item"],
      intro: "One component of this recipe is <b>missing</b>. Name it, and tell me what the full recipe builds into.",
      tip: "Type the missing component, then the finished item.",
    },
    build: {
      label: "Build",
      objectives: ["item"],
      intro: "Here's a complete recipe. What does it <b>build into</b>?",
      tip: "Type the finished item.",
    },
  };
  const OBJ_TEXT = {
    imp: "Spot the <b>imposter</b> component",
    miss: "Name the <b>missing</b> component",
    item: "Guess the <b>finished item</b>",
  };
  const SHARE_ICON = { imp: "🕵️", miss: "🧩", item: "⚔️" };

  // Base parts only appear as leaves in the tree; they are never answers.
  const byId = new Map([...components, ...parts, ...items].map((x) => [x.id, x]));
  const gold = (n) => `${n.toLocaleString("en-US")}g`;

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k === "style") el.style.cssText = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const html = (s) => { const t = document.createElement("template"); t.innerHTML = s.trim(); return t.content; };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- sound effects (synthesized with Web Audio, no files needed) ----------
  const sfx = (() => {
    let ctx = null, master = null, muted = store.get("rr:muted", false);
    const ac = () => {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    };
    // One enveloped oscillator note, optionally sliding to another pitch.
    const tone = ({ f = 440, to, type = "sine", dur = 0.12, vol = 0.15, at = 0, attack = 0.006 }) => {
      const c = ac(); if (!c) return;
      const t = c.currentTime + at;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.03);
    };
    // Filtered noise burst, used for the "send" whoosh.
    const whoosh = ({ dur = 0.28, vol = 0.12, from = 400, to = 2600 } = {}) => {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
      src.buffer = buf;
      bp.type = "bandpass"; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(from, t);
      bp.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(master);
      src.start(t);
    };
    const notes = (list, opts) => list.forEach(([f, at], i) => tone({ f, at: at ?? i * 0.08, ...opts }));
    const play = (fn) => (...a) => { if (!muted) try { fn(...a); } catch { /* audio unavailable */ } };
    return {
      get muted() { return muted; },
      setMuted(v) { muted = v; store.set("rr:muted", v); },
      click: play(() => tone({ f: 1100, type: "triangle", dur: 0.045, vol: 0.06 })),
      select: play(() => tone({ f: 520, to: 780, type: "triangle", dur: 0.09, vol: 0.1 })),
      pick: play(() => notes([[660], [990, 0.05]], { type: "sine", dur: 0.08, vol: 0.09 })),
      send: play(() => whoosh()),
      blip: play(() => tone({ f: 880, to: 1320, type: "sine", dur: 0.06, vol: 0.035 })),
      correct: play(() => notes([[784], [1047], [1319]], { type: "triangle", dur: 0.16, vol: 0.12 })),
      partial: play(() => notes([[660], [880]], { type: "triangle", dur: 0.14, vol: 0.1 })),
      wrong: play(() => { tone({ f: 220, to: 130, type: "sawtooth", dur: 0.28, vol: 0.07 }); tone({ f: 110, to: 80, type: "square", dur: 0.22, vol: 0.04, at: 0.02 }); }),
      hint: play(() => notes([[1568, 0], [2093, 0.07], [2637, 0.14], [3136, 0.21]], { type: "sine", dur: 0.22, vol: 0.06 })),
      win: play(() => {
        notes([[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3]], { type: "triangle", dur: 0.22, vol: 0.13 });
        notes([[1047, 0.42], [1319, 0.42], [1568, 0.42]], { type: "sine", dur: 0.7, vol: 0.07 });
        notes([[2093, 0.5], [2637, 0.58], [3136, 0.66], [4186, 0.74]], { type: "sine", dur: 0.18, vol: 0.03 });
      }),
      lose: play(() => notes([[392, 0], [330, 0.18], [262, 0.36], [196, 0.54]], { type: "triangle", dur: 0.3, vol: 0.11 })),
      mode: play(() => tone({ f: 440, to: 660, type: "sine", dur: 0.12, vol: 0.08 })),
    };
  })();

  // Seeded RNG so a saved puzzle regenerates identically after a reload.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Friendly stat names for hints.
  const TAG = {
    Damage: "Attack Damage", SpellDamage: "Ability Power", AttackSpeed: "Attack Speed", CriticalStrike: "Crit",
    Health: "Health", Armor: "Armor", SpellBlock: "Magic Resist", MagicResist: "Magic Resist", Mana: "Mana",
    ManaRegen: "Mana Regen", HealthRegen: "Health Regen", LifeSteal: "Life Steal", SpellVamp: "Omnivamp",
    AbilityHaste: "Ability Haste", CooldownReduction: "Ability Haste", NonbootsMovement: "Move Speed",
    ArmorPenetration: "Lethality / Armor Pen", MagicPenetration: "Magic Pen", OnHit: "On-Hit", Active: "Active",
    Slow: "Slow", Aura: "Aura", Tenacity: "Tenacity", Vision: "Vision", GoldPer: "Gold Income",
  };
  const statSet = (x) => [...new Set(x.tags.map((t) => TAG[t]).filter(Boolean))];

  // ---------- icons ----------
  function icon(x, cls = "") {
    const wrap = h("span", { class: cls });
    const hue = [...x.name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
    const ph = () => {
      const initials = x.name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
      return h("span", { class: "ph", style: `--h:${hue}` }, initials);
    };
    const img = h("img", { src: `${IMG_DIR}${x.slug}.png`, alt: x.name, loading: "lazy", draggable: "false" });
    img.addEventListener("error", () => img.replaceWith(ph()), { once: true });
    wrap.append(img);
    return wrap;
  }
  const mini = (x) => icon(x, "mini");
  // Short stat names so they fit inside the boxes; the hint panel uses the full names.
  const SHORT = {
    "Ability Power": "AP", "Attack Damage": "AD", "Attack Speed": "AS", "Ability Haste": "AH", Health: "HP",
    "Magic Resist": "MR", "Move Speed": "MS", "Base Mana Regen": "Mana Regen", "Base Health Regen": "HP Regen",
    "Magic Penetration": "Magic Pen", "Armor Penetration": "Armor Pen", "Critical Strike Chance": "Crit",
    "Critical Strike Damage": "Crit Dmg", "Heal and Shield Power": "Heal & Shield",
  };
  const splitStat = (line) => { const m = line.match(/^([\d.]+%?) (.+)$/); return m ? [m[1], m[2]] : ["", line]; };
  const shortStat = (line) => { const [n, k] = splitStat(line); return `${n} ${SHORT[k] || k}`.trim(); };
  const statLines = (x) => h("span", { class: "st" }, x.stats.map((l) => h("span", {}, shortStat(l))));
  // A tree node: icon box on top, caption (name, gold, stats) below.
  const caption = (name, cost, x) => h("span", { class: "cap" }, h("span", { class: "nm" }, name), h("span", { class: "g" }, cost), x ? statLines(x) : null);
  const node = (tag, attrs, tileCls, tileKids, cap) => h(tag, { class: "node", ...attrs }, h("span", { class: `tile ${tileCls}` }, tileKids), cap);

  // ---------- puzzle generation ----------
  // The hint panel stays locked for the first guesses, so a puzzle must have a single answer
  // from the board alone: exactly one (item, missing/imposter) pair fits the shown components.
  const minus = (from, shown) => { const p = [...from]; for (const id of shown) { const j = p.indexOf(id); if (j < 0) return null; p.splice(j, 1); } return p; };
  function solutionCount(p) {
    const pool = items;
    const ids = p.board.filter((t) => t.kind !== "missing").map((t) => t.id);
    if (p.mode === "build") return pool.filter((x) => minus(x.from, ids)?.length === 0).length;
    if (p.mode === "missing") return pool.filter((x) => minus(x.from, ids)?.length === 1).length;
    let n = 0;
    ids.forEach((_, i) => { const rest = ids.filter((__, j) => j !== i); n += pool.filter((x) => minus(x.from, rest)?.length === 0).length; });
    return n;
  }

  // `avoid` holds recently seen finished items; they are skipped unless nothing else fits.
  function makePuzzle(seed, m, avoid = new Set()) {
    const r = rng(seed);
    for (let tries = 0; tries < 400; tries++) {
      const p = buildPuzzle(r, seed, m);
      if (avoid.has(p.itemId)) continue;
      if (solutionCount(p) === 1) return p;
    }
    for (let tries = 0; tries < 200; tries++) {
      const p = buildPuzzle(r, seed, m);
      if (solutionCount(p) === 1) return p;
    }
    return buildPuzzle(r, seed, m);
  }

  function buildPuzzle(r, seed, m) {
    const item = items[Math.floor(r() * items.length)];
    const recipe = item.from;
    const p = { seed, mode: m, itemId: item.id, recipe, missing: null, imposter: null };

    // Components keep League's recipe order (the order the in-game shop shows).
    if (m === "build") {
      p.board = recipe.map((id) => ({ kind: "real", id }));
    } else if (m === "missing") {
      const missingIdx = Math.floor(r() * recipe.length);
      p.missing = recipe[missingIdx];
      // The "?" sits exactly where the missing component belongs.
      p.board = recipe.map((id, i) => (i === missingIdx ? { kind: "missing" } : { kind: "real", id }));
    } else {
      // A plausible imposter: not in the recipe, shares stats with the item, similar cost.
      const inRecipe = new Set(recipe);
      const itemStats = new Set(statSet(item));
      const avgCost = recipe.reduce((s, id) => s + byId.get(id).cost, 0) / recipe.length;
      const scored = components
        .filter((c) => !inRecipe.has(c.id))
        .map((c) => ({ c, score: statSet(c).filter((s) => itemStats.has(s)).length * 2 - Math.abs(c.cost - avgCost) / 1000 + r() * 1.5 }))
        .sort((a, b) => b.score - a.score);
      p.imposter = scored[Math.floor(r() * Math.min(6, scored.length))].c.id;
      // Real components in League's order; the imposter is slipped in at a random spot.
      p.board = recipe.map((id) => ({ kind: "real", id }));
      p.board.splice(Math.floor(r() * (recipe.length + 1)), 0, { kind: "imposter", id: p.imposter });
    }
    return p;
  }

  // ---------- state ----------
  let mode = store.get("rr:mode", "imposter");
  if (!MODES[mode]) mode = "imposter";
  let puzzle, game, sel, active;
  const stats = store.get("rr:stats:v2", {});
  const statFor = (m) => (stats[m] ||= { played: 0, wins: 0, streak: 0, best: 0, guesses: 0, dist: [0, 0, 0, 0, 0, 0] });
  const HINT_AT = 3;
  const hintOpen = () => game.done || game.guesses.length >= HINT_AT;
  const objectives = () => MODES[mode].objectives;
  const uses = (k) => objectives().includes(k);

  function freshGame() {
    return { guesses: [], solved: { imp: null, miss: null, item: null }, verified: [], done: false, won: false, gaveUp: false };
  }

  // An item that came up can't come up again until RECENT_LIMIT other puzzles have
  // been played (shared across all modes).
  const RECENT_LIMIT = 10;
  const SAVE_KEY = () => `rr:game:v6:${mode}`;

  function rememberItem(id) {
    const recent = store.get("rr:recent", []).filter((x) => x !== id);
    recent.push(id);
    store.set("rr:recent", recent.slice(-RECENT_LIMIT));
  }

  function loadGame() {
    // The puzzle itself is saved (not just its seed) so it can't change after a reload.
    const saved = store.get(SAVE_KEY(), null);
    const legacy = !saved && store.get(`rr:game:v5:${mode}`, null);
    if (saved && saved.puzzle && !saved.game.done) {
      puzzle = saved.puzzle;
      game = saved.game;
    } else if (legacy && !legacy.game.done) {
      puzzle = makePuzzle(legacy.seed, mode); // older saves only stored the seed
      game = legacy.game;
      store.set(`rr:game:v5:${mode}`, null);
      rememberItem(puzzle.itemId);
      save();
    } else {
      puzzle = makePuzzle((Math.random() * 2 ** 32) >>> 0, mode, new Set(store.get("rr:recent", [])));
      rememberItem(puzzle.itemId);
      game = freshGame();
      save();
    }
    sel = { imp: null, miss: null, item: null };
    active = null;
    for (const k of objectives()) if (game.solved[k] != null) sel[k] = game.solved[k];
    renderAll();
    replayFeed();
  }

  function nextPuzzle() {
    sfx.mode();
    store.set(SAVE_KEY(), null);
    loadGame();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function save() { store.set(SAVE_KEY(), { puzzle, game }); }

  // ---------- rendering ----------
  const tilesEl = $("#tiles"), finalEl = $("#final"), feed = $("#feed"), q = $("#q"), suggest = $("#suggest");

  function renderAll() {
    $("#patch").textContent = `Patch ${version} · ${items.length} items`;
    document.querySelectorAll(".topbar .seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
    $("#objectives").replaceChildren(...objectives().map((k) => h("li", { "data-obj": k }, h("span", { class: "dot" }), html(OBJ_TEXT[k]))));
    document.querySelectorAll(".slot").forEach((b) => (b.hidden = !uses(b.dataset.slot)));
    renderBoard();
    renderSlots();
    renderPips();
    renderMiniStats();
  }

  function renderMiniStats() {
    const s = statFor(mode);
    const pct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
    $("#puzzle-label").textContent = `${MODES[mode].label} · #${s.played + (game.done ? 0 : 1)}`;
    $("#mini-stats").replaceChildren(
      h("span", {}, "Streak ", h("b", {}, String(s.streak))),
      h("span", {}, "Best ", h("b", {}, String(s.best))),
      h("span", {}, "Win ", h("b", {}, `${pct}%`)));
    $("#btn-giveup").hidden = game.done;
  }

  // Keeps every major component on one level (so their base rows line up too),
  // and scales wide trees (up to ~10 base components) down to fit narrow screens.
  function fitTree() {
    const wrap = $("#tree-wrap"), tree = $("#tree");
    tree.style.transform = "";
    wrap.style.height = "";
    const majors = [...document.querySelectorAll("#tiles > .branch > .node")];
    majors.forEach((n) => (n.style.minHeight = ""));
    const tallest = Math.max(0, ...majors.map((n) => n.offsetHeight));
    majors.forEach((n) => (n.style.minHeight = `${tallest}px`));
    // Every major column gets the widest column's width, so siblings are evenly spaced —
    // unless that would make the tree too wide to fit even at the smallest zoom (phones).
    const MIN_SCALE = 0.55;
    const columns = [...document.querySelectorAll("#tiles > .branch")];
    columns.forEach((c) => (c.style.width = ""));
    const widest = Math.max(0, ...columns.map((c) => c.getBoundingClientRect().width));
    if (widest * columns.length * MIN_SCALE <= wrap.clientWidth) columns.forEach((c) => (c.style.width = `${Math.ceil(widest)}px`));
    const need = Math.max($("#tiles").offsetWidth, $(".tree-top", tree).scrollWidth), have = wrap.clientWidth;
    if (need > have && have > 0) {
      const k = Math.max(MIN_SCALE, have / need);
      tree.style.transform = `scale(${k})`;
      const pad = parseFloat(getComputedStyle(wrap).paddingTop) + parseFloat(getComputedStyle(wrap).paddingBottom);
      wrap.style.height = `${Math.ceil(tree.offsetHeight * k + pad)}px`;
    }
  }
  let fitRaf = 0;
  window.addEventListener("resize", () => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fitTree); });

  let revealedMissing = null; // seed of the puzzle whose missing piece was already animated in
  function renderBoard() {
    tilesEl.replaceChildren();
    // Base components: a smaller second row under each major component.
    const leaf = (x) => h("li", { class: "branch leaf" },
      h("div", { class: "node small", title: `${x.name} · ${gold(x.cost)}${x.stats.length ? ` · ${x.stats.join(", ")}` : ""}` },
        h("span", { class: "tile" }, icon(x)),
        h("span", { class: "cap" }, h("span", { class: "nm" }, x.name), h("span", { class: "g" }, gold(x.cost)),
          x.stats.length ? h("span", { class: "st1" }, x.stats.map(shortStat).join(" · ")) : null)));
    const subtree = (x) => (x && x.from?.length ? h("ul", { class: "branches sub" }, x.from.map((id) => leaf(byId.get(id)))) : null);
    const branch = (el, state = "", x = null) => tilesEl.append(h("li", { class: `branch major ${state}` }, el, subtree(x)));
    puzzle.board.forEach((t, i) => {
      if (t.kind === "missing") {
        const found = game.solved.miss || (game.done && puzzle.missing);
        const c = found && byId.get(found);
        branch(found
          ? node("div", { "aria-label": `Missing component: ${c.name}` }, "missing found", icon(c), caption(c.name, gold(c.cost), c))
          : node("div", { "aria-label": "Missing component" }, "missing", "?", caption("Missing", "?g")),
          found ? (revealedMissing === puzzle.seed ? "ok" : "ok found-now") : "pending", c || null);
        if (found) revealedMissing = puzzle.seed;
        return;
      }
      const c = byId.get(t.id);
      if (mode !== "imposter") {
        branch(node("div", {}, "", icon(c), caption(c.name, gold(c.cost), c)), "", c);
        return;
      }
      const caught = game.solved.imp === i || (game.done && t.kind === "imposter");
      const verified = game.verified.includes(i) || (game.solved.imp != null && t.kind === "real") || (game.done && t.kind === "real");
      const el = node("button", {
        "aria-label": `${c.name}, ${gold(c.cost)}${caught ? " (imposter)" : verified ? " (in recipe)" : ""}`,
        "aria-pressed": String(sel.imp === i),
        disabled: game.done || game.solved.imp != null || verified,
        onclick: () => { sel.imp = sel.imp === i ? null : i; sel.imp != null ? sfx.select() : sfx.click(); renderBoard(); renderSlots(); if (sel.imp != null) focusNext(); },
      }, `${sel.imp === i && !caught ? "selected" : ""} ${caught ? "caught" : ""} ${verified ? "verified" : ""}`, icon(c), caption(c.name, gold(c.cost), c));
      branch(el, caught ? "cut" : verified ? "ok" : "", c);
    });

    finalEl.replaceChildren();
    const found = game.solved.item || (game.done && puzzle.itemId);
    const it = byId.get(puzzle.itemId);
    finalEl.append(found
      ? node("div", {}, "missing found pop", icon(it), caption(it.name, gold(it.cost)))
      : node("div", {}, "missing", "?", caption("Finished item", hintOpen() ? gold(it.cost) : "?g")));
    // Side hint: the finished item's gold and full stats, locked until HINT_AT guesses.
    const hint = $("#hint");
    const wasOpen = hint.classList.contains("open");
    if (hintOpen()) {
      hint.className = `hint open ${wasOpen ? "" : "unlock"}`;
      hint.replaceChildren(
        h("span", { class: "hint-k" }, "Hint"),
        h("span", { class: "hint-g" }, gold(it.cost)),
        h("ul", {}, it.stats.map((l) => { const [n, k] = splitStat(l); return h("li", {}, h("b", {}, n), " ", k); })));
    } else {
      const n = game.guesses.length;
      hint.className = "hint locked";
      hint.replaceChildren(
        h("span", { class: "hint-k" }, "🔒 Hint locked"),
        h("span", { class: "hint-msg" }, `Gold & stats unlock after ${HINT_AT} guesses`),
        h("span", { class: "hint-prog" }, Array.from({ length: HINT_AT }, (_, i) => h("i", { class: i < n ? "on" : "" }))));
    }
    $("#tree").classList.toggle("solved", !!found);
    fitTree();

    document.querySelectorAll("#objectives li").forEach((li) => li.classList.toggle("done", game.solved[li.dataset.obj] != null));
  }

  function renderPips() {
    $("#pips").replaceChildren(...Array.from({ length: MAX_TRIES }, (_, i) => {
      let c = "pip";
      const n = game.guesses.length;
      if (i < n) c += game.won && i === n - 1 ? " win" : game.done && !game.won && i === n - 1 ? " lose" : " used";
      return h("span", { class: c });
    }));
  }

  const slotName = (k) => {
    const v = sel[k];
    if (v == null) return null;
    const x = k === "imp" ? byId.get(puzzle.board[v].id) : byId.get(v);
    return `${x.name} · ${gold(x.cost)}`;
  };

  function renderSlots() {
    document.querySelectorAll(".slot").forEach((b) => {
      const k = b.dataset.slot;
      const name = slotName(k);
      const locked = game.solved[k] != null;
      b.className = `slot ${name ? "filled" : "empty"} ${locked ? "locked" : ""} ${active === k && !locked ? "active" : ""}`;
      $(".v", b).textContent = name || (k === "imp" ? "tap a tile" : "—");
    });
    $("#send").disabled = !(!game.done && objectives().every((k) => sel[k] != null));
    $("#composer").classList.toggle("locked", game.done);
    q.placeholder = game.done ? "Puzzle complete" :
      active === "imp" ? "Tap the imposter tile above, or type its name…" :
      active === "miss" ? "Which component is missing?" :
      active === "item" ? "What does it build into?" : "Type an item…";
  }

  // ---------- composer & suggestions ----------
  let hl = 0, opts = [];
  const open = () => objectives().filter((k) => game.solved[k] == null);

  function setActive(k) {
    if (game.done || game.solved[k] != null) return;
    active = k;
    renderSlots();
    q.focus();
    updateSuggest();
  }

  function focusNext() {
    const next = open().find((k) => sel[k] == null);
    active = next || null;
    renderSlots();
    if (next) { q.focus(); updateSuggest(); } else closeSuggest();
  }

  function poolFor(k) {
    if (k === "miss") return components;
    if (k === "item") return items;
    if (k === "imp") return puzzle.board.map((t, i) => ({ t, i })).filter(({ i }) => !game.verified.includes(i)).map(({ t, i }) => ({ ...byId.get(t.id), boardIdx: i }));
    return [];
  }
  const tried = (k, x) => game.guesses.some((g) => !g.res[k] && (k === "imp" ? g.imp === x.boardIdx : g[k] === x.id));

  function updateSuggest() {
    clearTimeout(blurTimer); // a pending close from an earlier blur must not hide the list we're opening
    if (game.done) return closeSuggest();
    if (!active) {
      // Typing goes to the first empty slot (the imposter can also be tapped);
      // when every slot is filled, reopen the last one so the answer can be changed.
      const k = open().find((s) => s !== "imp" && sel[s] == null) || open().find((s) => sel[s] == null) || open().slice(-1)[0];
      if (!k) return closeSuggest();
      active = k;
      renderSlots();
    }
    const term = q.value.trim().toLowerCase();
    opts = poolFor(active)
      .filter((x) => !term || x.name.toLowerCase().includes(term))
      .sort((a, b) => {
        const as = a.name.toLowerCase().startsWith(term), bs = b.name.toLowerCase().startsWith(term);
        return (bs - as) || (tried(active, a) - tried(active, b)) || a.name.localeCompare(b.name);
      });
    hl = 0;
    suggest.replaceChildren();
    if (!opts.length) suggest.append(h("div", { class: "empty" }, "No match. Try another name."));
    opts.forEach((x, i) => {
      const name = term ? esc(x.name).replace(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"), "<mark>$1</mark>") : esc(x.name);
      suggest.append(h("button", { class: `opt ${i === hl ? "hl" : ""} ${tried(active, x) ? "tried" : ""}`, role: "option", onmousedown: (e) => e.preventDefault(), onclick: () => choose(x) },
        mini(x), h("span", { class: "on" }, html(name))));
    });
    suggest.hidden = false;
  }

  function moveHl(d) {
    if (!opts.length) return;
    hl = (hl + d + opts.length) % opts.length;
    [...suggest.children].forEach((c, i) => c.classList.toggle("hl", i === hl));
    suggest.children[hl]?.scrollIntoView({ block: "nearest" });
  }

  function choose(x) {
    if (active === "imp") sel.imp = x.boardIdx;
    else sel[active] = x.id;
    sfx.pick();
    q.value = "";
    renderBoard();
    focusNext();
  }

  function closeSuggest() { suggest.hidden = true; }

  let blurTimer = 0;
  q.addEventListener("focus", () => !game.done && updateSuggest());
  // Clicking the box while it already has focus fires no focus event, so reopen on click too.
  q.addEventListener("click", () => { if (!game.done && suggest.hidden) updateSuggest(); });
  q.addEventListener("input", updateSuggest);
  q.addEventListener("blur", () => { clearTimeout(blurTimer); blurTimer = setTimeout(closeSuggest, 150); });
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveHl(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveHl(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (!suggest.hidden && q.value.trim() && opts[hl]) choose(opts[hl]);
      else if (!$("#send").disabled) submit();
      else if (!suggest.hidden && opts[hl]) choose(opts[hl]);
    } else if (e.key === "Escape") { closeSuggest(); q.blur(); }
    else if (e.key === "Tab" && !suggest.hidden && opts.length) {
      // With the list open, Tab / Shift+Tab step through the options (and scroll to them).
      e.preventDefault();
      moveHl(e.shiftKey ? -1 : 1);
    } else if (e.key === "Tab" && !e.shiftKey) {
      // With the list closed, Tab switches to the next answer slot.
      const order = open();
      if (order.length > 1) { e.preventDefault(); setActive(order[(order.indexOf(active) + 1) % order.length]); }
    }
  });
  document.querySelectorAll(".slot").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.slot;
    if (game.solved[k] != null) return;
    sfx.click();
    if (active === k && sel[k] != null) { sel[k] = null; renderBoard(); }
    setActive(k);
  }));
  $("#send").addEventListener("click", submit);

  // ---------- guessing ----------
  function evaluate(g) {
    const realItem = byId.get(puzzle.itemId);
    const res = {};
    if (uses("imp")) res.imp = g.imp != null && puzzle.board[g.imp].kind === "imposter";
    if (uses("miss")) res.miss = g.miss === puzzle.missing;
    res.item = g.item === realItem.id;
    return res;
  }

  let busy = false;
  async function submit() {
    if (busy || game.done || $("#send").disabled) return;
    busy = true;
    sfx.send();
    const g = {};
    for (const k of objectives()) g[k] = sel[k];
    g.res = evaluate(g);
    game.guesses.push(g);
    if (uses("imp")) { if (g.res.imp) game.solved.imp = g.imp; else if (!game.verified.includes(g.imp)) game.verified.push(g.imp); }
    if (g.res.miss) game.solved.miss = g.miss;
    if (g.res.item) game.solved.item = g.item;
    const won = objectives().every((k) => game.solved[k] != null);
    if (won || game.guesses.length >= MAX_TRIES) finish(won);

    for (const k of objectives()) if (game.solved[k] == null) sel[k] = null;
    save();

    userBubble(g);
    renderSlots();
    closeSuggest();
    q.blur();
    renderPips();
    if (objectives().every((k) => !g.res[k])) { $("#composer").classList.add("shake"); setTimeout(() => $("#composer").classList.remove("shake"), 450); }

    await oracle(feedbackFor(g, game.guesses.length));
    const n = game.guesses.length;
    const newlySolved = objectives().filter((k) => g.res[k] && !game.guesses.slice(0, n - 1).some((p) => p.res[k]));
    if (!game.done) {
      if (newlySolved.length) sfx.correct(); else sfx.wrong();
    }
    renderBoard();
    if (n === HINT_AT && !game.done) setTimeout(sfx.hint, 380);
    if (game.done) {
      renderMiniStats();
      game.won ? sfx.win() : sfx.lose();
      await oracle(endMessage(), endActions());
    } else focusNext();
    busy = false;
  }

  function finish(won) {
    game.done = true;
    game.won = won;
    const s = statFor(mode);
    s.played++;
    if (won) { s.wins++; s.streak++; s.best = Math.max(s.best, s.streak); s.dist[game.guesses.length - 1]++; s.guesses += game.guesses.length; }
    else s.streak = 0;
    store.set("rr:stats:v2", stats);
  }

  async function giveUp() {
    if (game.done || busy) return;
    if (!confirm("Give up this puzzle? It counts as a loss and resets your streak.")) return;
    busy = true;
    game.gaveUp = true;
    sfx.lose();
    finish(false);
    save();
    closeSuggest();
    renderAll();
    await oracle(endMessage(), endActions());
    busy = false;
  }
  $("#btn-giveup").addEventListener("click", giveUp);

  // Start the current mode over: clears its stats, streak and puzzle. Not counted as a loss.
  function resetMode() {
    if (busy) return;
    if (!confirm(`Reset ${MODES[mode].label} mode? This clears its stats, streak and current puzzle.`)) return;
    sfx.mode();
    delete stats[mode];
    store.set("rr:stats:v2", stats);
    store.set(SAVE_KEY(), null);
    closeSuggest();
    q.value = "";
    loadGame();
    toast(`${MODES[mode].label} mode reset`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $("#btn-reset-mode").addEventListener("click", resetMode);

  // ---------- Boris (the assistant) ----------
  const asNode = (c) => (typeof c === "string" ? html(c) : c);
  function oracleNode(content, extra) {
    const body = h("div", { class: "body" }, h("div", { class: "who" }, "Boris"));
    const node = h("div", { class: "msg" }, h("span", { class: "orb sm" }), body);
    if (content != null) { body.append(asNode(content)); if (extra) body.append(extra); }
    return { node, body };
  }

  async function oracle(content, extra, instant = false) {
    if (instant) { feed.append(oracleNode(content, extra).node); return; }
    const { node, body } = oracleNode(null);
    const orb = $(".orb", node);
    orb.classList.add("thinking");
    const dots = h("span", { class: "typing" }, h("i"), h("i"), h("i"));
    body.append(dots);
    feed.append(node);
    scrollFeed();
    await wait(550 + Math.random() * 350);
    orb.classList.remove("thinking");
    dots.remove();
    sfx.blip();
    body.append(asNode(content));
    if (extra) body.append(extra);
    scrollFeed();
  }

  const scrollFeed = () => requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));

  function chip(kind, x, ok, hint) {
    return h("span", { class: `chip ${ok ? "ok" : "no"}` }, mini(x),
      h("span", {}, h("span", { class: "k" }, kind), " ", x.name, " ", h("span", { class: "g" }, gold(x.cost))),
      hint ? h("span", { class: "arrowhint" }, hint) : null);
  }

  function userBubble(g, instant = false) {
    const arrow = (guess, ans) => (ans.cost > guess.cost ? "↑" : ans.cost < guess.cost ? "↓" : "=");
    const chips = [];
    if (uses("imp")) chips.push(chip("Imp", byId.get(puzzle.board[g.imp].id), g.res.imp));
    if (uses("miss")) { const x = byId.get(g.miss); chips.push(chip("Miss", x, g.res.miss, g.res.miss ? null : arrow(x, byId.get(puzzle.missing)))); }
    const it = byId.get(g.item);
    chips.push(chip("Item", it, g.res.item));
    const node = h("div", { class: "msg user" }, h("div", { class: "bubble" }, chips));
    if (instant) node.style.animation = "none";
    feed.append(node);
    scrollFeed();
  }

  // ---------- Boris's feedback: one row per answer, with stats and recipe overlap as visuals ----------
  const statName = (line) => splitStat(line)[1];

  // Stat pills of the guess; green when the answer has the same stat.
  function statCompare(guess, ans) {
    const want = new Set(ans.stats.map(statName));
    const pills = guess.stats.map((l) => h("span", { class: `pill ${want.has(statName(l)) ? "hit" : "miss"}` }, shortStat(l)));
    const hits = guess.stats.filter((l) => want.has(statName(l))).length;
    return h("div", { class: "fb-line" }, h("span", { class: "lbl" }, "Stats"), h("span", { class: "pills" }, pills),
      h("span", { class: `count ${hits ? "hit" : ""}` }, `${hits} of ${guess.stats.length} match`));
  }

  // The guess's recipe; components the answer also uses light up.
  function recipeCompare(guess, ans) {
    const pool = [...ans.from];
    const parts = guess.from.map((id) => { const j = pool.indexOf(id); const hit = j >= 0; if (hit) pool.splice(j, 1); return { x: byId.get(id), hit }; });
    const hits = parts.filter((p) => p.hit).length;
    return h("div", { class: "fb-line" }, h("span", { class: "lbl" }, "Recipe"),
      h("span", { class: "pills" }, parts.map(({ x, hit }) => h("span", { class: `rc ${hit ? "hit" : "miss"}`, title: x.name }, mini(x), x.name))),
      h("span", { class: `count ${hits ? "hit" : ""}` }, `${hits} of ${parts.length} match`));
  }

  function goldCompare(guess, ans) {
    const dir = ans.cost > guess.cost ? "up" : ans.cost < guess.cost ? "down" : "same";
    const text = dir === "same" ? "Same price" : `Answer costs ${dir === "up" ? "more" : "less"}`;
    return h("div", { class: "fb-line" }, h("span", { class: "lbl" }, "Gold"),
      h("span", { class: `cmp ${dir}` }, h("b", {}, dir === "up" ? "▲" : dir === "down" ? "▼" : "="), ` ${text} than ${gold(guess.cost)}`));
  }

  function fbRow(label, x, ok, verdict, details = []) {
    return h("div", { class: `fb-row ${ok ? "ok" : "no"}` },
      h("div", { class: "fb-head" },
        h("span", { class: "fb-k" }, label),
        h("span", { class: "fb-item" }, mini(x), h("b", {}, x.name), h("span", { class: "g" }, gold(x.cost))),
        h("span", { class: "fb-v" }, `${ok ? "✓" : "✗"} ${verdict}`)),
      details);
  }

  function feedbackFor(g, n) {
    const out = h("div", { class: "fb" });
    const lines = [];
    const first = (k) => g.res[k] && !game.guesses.slice(0, n - 1).some((p) => p.res[k]);
    const itemAns = byId.get(puzzle.itemId);
    const rows = [];

    if (uses("imp") && (first("imp") || !g.res.imp)) {
      const imp = byId.get(puzzle.board[g.imp].id);
      rows.push(g.res.imp ? fbRow("Imposter", imp, true, "Imposter caught") : fbRow("Imposter", imp, false, "It's part of the recipe"));
    }
    if (uses("miss") && (first("miss") || !g.res.miss)) {
      const miss = byId.get(g.miss), missAns = byId.get(puzzle.missing);
      rows.push(g.res.miss ? fbRow("Missing", miss, true, "That's the missing piece")
        : fbRow("Missing", miss, false, "Not the missing piece", [goldCompare(miss, missAns), statCompare(miss, missAns)]));
    }
    if (first("item") || !g.res.item) {
      const item = byId.get(g.item);
      rows.push(g.res.item ? fbRow("Item", item, true, "That's the item")
        : fbRow("Item", item, false, "Wrong item", [statCompare(item, itemAns), recipeCompare(item, itemAns)]));
    }

    const allRight = objectives().every((k) => g.res[k]);
    const anyNew = objectives().some((k) => first(k));
    out.append(h("p", { class: "fb-lead" }, allRight ? "That's everything!" : anyNew ? "Progress! Here's the breakdown:" : "Not quite. Here's what I can tell you:"), ...rows);

    if (n === HINT_AT && !objectives().every((k) => g.res[k])) {
      lines.push(`<span class="hint-note">🔓 Hint unlocked: I've revealed the finished item's <b>gold</b> and <b>stats</b> next to the tree.</span>`);
    }
    if (n === HINT_AT + 1) {
      const extra = [];
      if (uses("miss") && !g.res.miss) extra.push(`the missing component costs <b>${gold(byId.get(puzzle.missing).cost)}</b>`);
      if (uses("imp") && !g.res.imp) extra.push(`the imposter's name starts with <b>${esc(byId.get(puzzle.imposter).name[0])}</b>`);
      if (!g.res.item) extra.push(`the finished item's name starts with <b>${esc(itemAns.name[0])}</b>`);
      if (extra.length) lines.push(`<span class="muted">Extra hint: ${extra.join(", and ")}.</span>`);
    }
    if (n === MAX_TRIES - 1 && !objectives().every((k) => g.res[k])) lines.push(`<span class="muted">Last attempt. Make it count.</span>`);
    if (lines.length) out.append(html(lines.map((l) => `<p>${l}</p>`).join("")));
    return out;
  }

  function endMessage() {
    const it = byId.get(puzzle.itemId);
    const recipe = it.from.map((id) => byId.get(id));
    const s = statFor(mode);
    const head = game.won
      ? `<p><b>Solved in ${game.guesses.length}/${MAX_TRIES}.</b> ${["Flawless.", "Impressive.", "Clean.", "Nice work.", "Got there.", "Clutch."][game.guesses.length - 1]} Streak: <b>${s.streak}</b>.</p>`
      : `<p><b>${game.gaveUp ? "You gave up." : "Out of attempts."}</b> Here's the real recipe:</p>`;
    const frag = html(head);
    const box = h("div", { class: "reveal" });
    recipe.forEach((c, i) => { if (i) box.append(h("span", { class: "plus" }, "+")); box.append(h("span", { class: "chip ok" }, mini(c), c.name, h("span", { class: "g" }, gold(c.cost)))); });
    const recipeGold = it.cost - recipe.reduce((a, c) => a + c.cost, 0);
    box.append(h("span", { class: "plus" }, `+ ${gold(recipeGold)} →`), h("span", { class: "chip ok" }, mini(it), it.name, h("span", { class: "g" }, gold(it.cost))));
    frag.append(box);
    const notes = [];
    if (puzzle.imposter) notes.push(`The imposter was <b>${esc(byId.get(puzzle.imposter).name)}</b> (${gold(byId.get(puzzle.imposter).cost)}).`);
    if (notes.length) frag.append(html(`<p class="muted">${notes.join(" ")}</p>`));
    return frag;
  }

  function endActions() {
    return h("div", { class: "btn-row" },
      h("button", { class: "btn primary", onclick: nextPuzzle }, "Next puzzle"),
      h("button", { class: "btn", onclick: share }, "Share result"),
      Object.keys(MODES).filter((m) => m !== mode).map((m) => h("button", { class: "btn", onclick: () => switchMode(m) }, `Try ${MODES[m].label}`)));
  }

  function share() {
    const sq = (ok) => (ok ? "🟩" : "🟥");
    const rows = game.guesses.map((g) => objectives().map((k) => sq(g.res[k])).join("")).join("\n");
    const s = statFor(mode);
    const text = `ITEMDLE · ${MODES[mode].label} ${game.won ? game.guesses.length : "X"}/${MAX_TRIES} · streak ${s.streak}\n${objectives().map((k) => SHARE_ICON[k]).join("")}\n${rows}`;
    if (navigator.share && matchMedia("(pointer: coarse)").matches) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => toast("Copied to clipboard"), () => toast("Couldn't copy"));
  }

  function replayFeed() {
    feed.replaceChildren();
    oracle(`<p>${MODES[mode].intro}</p><p class="muted">${MODES[mode].tip} ${MAX_TRIES} attempts. Every puzzle is new — keep your streak alive.</p>`, null, true);
    game.guesses.forEach((g, i) => { userBubble(g, true); oracle(feedbackFor(g, i + 1), null, true); });
    if (game.done) oracle(endMessage(), endActions(), true);
    feed.querySelectorAll(".msg").forEach((m) => (m.style.animation = "none"));
  }

  // ---------- stats modal ----------
  let statsMode = mode;
  function renderStats() {
    const s = statFor(statsMode);
    document.querySelectorAll("#stats-seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === statsMode)));
    $("#stat-grid").replaceChildren(...[
      [s.played, "Played"],
      [s.played ? `${Math.round((s.wins / s.played) * 100)}%` : "0%", "Win rate"],
      [s.streak, "Streak"],
      [s.best, "Best streak"],
      [s.wins, "Wins"],
      [s.played - s.wins, "Losses"],
      [s.wins ? (s.guesses / s.wins).toFixed(1) : "–", "Avg. guesses"],
      [s.dist.findIndex((v) => v > 0) + 1 || "–", "Fastest"],
    ].map(([v, l]) => h("div", {}, h("b", {}, String(v)), h("span", {}, l))));
    const max = Math.max(1, ...s.dist);
    const cur = statsMode === mode && game.won ? game.guesses.length : 0;
    $("#dist").replaceChildren(...s.dist.map((v, i) => h("div", { class: "row" }, String(i + 1),
      h("div", { class: `bar ${cur === i + 1 ? "cur" : ""}`, style: `width:${Math.max(8, (v / max) * 100)}%` }, String(v)))));
  }
  function openStats() { statsMode = mode; renderStats(); $("#dlg-stats").showModal(); }
  document.querySelectorAll("#stats-seg button").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); statsMode = b.dataset.mode; renderStats(); }));
  $("#btn-reset").addEventListener("click", (e) => {
    e.preventDefault();
    if (!confirm(`Reset all ${MODES[statsMode].label} stats?`)) return;
    delete stats[statsMode];
    store.set("rr:stats:v2", stats);
    renderStats();
    renderMiniStats();
  });

  // ---------- misc ----------
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 1800);
  }

  function switchMode(m) {
    if (m === mode || busy) return;
    mode = m;
    sfx.mode();
    store.set("rr:mode", m);
    closeSuggest();
    q.value = "";
    loadGame();
    window.scrollTo({ top: 0 });
  }

  document.querySelectorAll(".topbar .seg button").forEach((b) => b.addEventListener("click", () => switchMode(b.dataset.mode)));
  $("#btn-help").addEventListener("click", () => { sfx.click(); $("#dlg-help").showModal(); });
  $("#btn-stats").addEventListener("click", () => { sfx.click(); openStats(); });
  const muteBtn = $("#btn-sound");
  const renderMute = () => {
    muteBtn.classList.toggle("off", sfx.muted);
    muteBtn.setAttribute("aria-pressed", String(!sfx.muted));
    muteBtn.title = sfx.muted ? "Sound off" : "Sound on";
  };
  muteBtn.addEventListener("click", () => { sfx.setMuted(!sfx.muted); renderMute(); sfx.click(); });
  renderMute();
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

  // ---------- fake ads: ✕ doesn't close the ad, it plays the next one ----------
  const GOAT_AD = { art: "🐐", text: "manson is a goat adc", cta: "Watch now", theme: "goat" };
  document.querySelectorAll(".ad-frame").forEach((frame) => {
    const link = $(".ad-creative", frame);
    const first = { art: $(".ad-art", link).textContent, text: $(".ad-text", link).textContent, cta: $(".ad-cta", link).textContent, theme: link.classList.contains("alt") ? "alt" : "" };
    const playlist = [first, GOAT_AD];
    let at = 0, swapping = false;
    $(".ad-close", frame).addEventListener("click", async () => {
      if (swapping) return;
      swapping = true;
      sfx.select();
      link.classList.add("swap-out");
      await wait(220);
      at = (at + 1) % playlist.length;
      const ad = playlist[at];
      $(".ad-art", link).textContent = ad.art;
      $(".ad-text", link).textContent = ad.text;
      $(".ad-cta", link).textContent = ad.cta;
      link.classList.remove("alt", "goat", "swap-out");
      if (ad.theme) link.classList.add(ad.theme);
      link.classList.add("swap-in");
      await wait(320);
      link.classList.remove("swap-in");
      swapping = false;
    });
  });

  loadGame();
  if (!store.get("rr:seenHelp", false)) { store.set("rr:seenHelp", true); $("#dlg-help").showModal(); }
})();
