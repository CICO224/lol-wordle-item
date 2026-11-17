(() => {
  "use strict";

  const { version, components, items } = window.GAME_DATA;
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

  const byId = new Map([...components, ...items].map((x) => [x.id, x]));
  const recipeKey = (ids) => [...ids].sort().join("+");
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
  const shuffle = (arr, r) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

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
  const tagsHtml = (arr) => arr.map((t) => `<span class="tag">${esc(t)}</span>`).join(" ");

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
  const tileLabel = (name, cost) => h("span", { class: "name" }, name, h("span", { class: "g" }, cost));

  // ---------- puzzle generation ----------
  function makePuzzle(seed, m) {
    const r = rng(seed);
    const item = items[Math.floor(r() * items.length)];
    const recipe = item.from;
    const p = { seed, mode: m, itemId: item.id, recipe, missing: null, imposter: null };

    if (m === "build") {
      p.board = shuffle(recipe.map((id) => ({ kind: "real", id })), r);
    } else if (m === "missing") {
      const missingIdx = Math.floor(r() * recipe.length);
      p.missing = recipe[missingIdx];
      const shown = recipe.filter((_, i) => i !== missingIdx).map((id) => ({ kind: "real", id }));
      p.board = shuffle([...shown, { kind: "missing" }], r);
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
      p.board = shuffle([...recipe.map((id) => ({ kind: "real", id })), { kind: "imposter", id: p.imposter }], r);
    }
    return p;
  }

  // ---------- state ----------
  let mode = store.get("rr:mode", "imposter");
  if (!MODES[mode]) mode = "imposter";
  let puzzle, game, sel, active;
  const stats = store.get("rr:stats:v2", {});
  const statFor = (m) => (stats[m] ||= { played: 0, wins: 0, streak: 0, best: 0, guesses: 0, dist: [0, 0, 0, 0, 0, 0] });
  const objectives = () => MODES[mode].objectives;
  const uses = (k) => objectives().includes(k);

  function freshGame() {
    return { guesses: [], solved: { imp: null, miss: null, item: null }, verified: [], done: false, won: false, gaveUp: false };
  }

  function loadGame() {
    const saved = store.get(`rr:game:${mode}`, null);
    if (saved && !saved.game.done) {
      puzzle = makePuzzle(saved.seed, mode);
      game = saved.game;
    } else {
      puzzle = makePuzzle((Math.random() * 2 ** 32) >>> 0, mode);
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
    store.set(`rr:game:${mode}`, null);
    loadGame();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function save() { store.set(`rr:game:${mode}`, { seed: puzzle.seed, game }); }

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

  function renderBoard() {
    tilesEl.replaceChildren();
    const branch = (el, state = "") => tilesEl.append(h("li", { class: `branch ${state}` }, el));
    puzzle.board.forEach((t, i) => {
      if (t.kind === "missing") {
        const found = game.solved.miss || (game.done && puzzle.missing);
        const el = h("div", { class: `tile missing ${found ? "found" : ""}`, "aria-label": "Missing component" });
        if (found) { const c = byId.get(found); el.append(icon(c), tileLabel(c.name, gold(c.cost))); }
        else el.append("?", tileLabel("Missing", "?g"));
        branch(el, found ? "ok" : "pending");
        return;
      }
      const c = byId.get(t.id);
      if (mode !== "imposter") {
        branch(h("div", { class: "tile" }, icon(c), tileLabel(c.name, gold(c.cost))));
        return;
      }
      const caught = game.solved.imp === i || (game.done && t.kind === "imposter");
      const verified = game.verified.includes(i) || (game.solved.imp != null && t.kind === "real") || (game.done && t.kind === "real");
      const el = h("button", {
        class: `tile ${sel.imp === i && !caught ? "selected" : ""} ${caught ? "caught" : ""} ${verified ? "verified" : ""}`,
        "aria-label": `${c.name}, ${gold(c.cost)}${caught ? " (imposter)" : verified ? " (in recipe)" : ""}`,
        "aria-pressed": String(sel.imp === i),
        disabled: game.done || game.solved.imp != null || verified,
        onclick: () => { sel.imp = sel.imp === i ? null : i; renderBoard(); renderSlots(); if (sel.imp != null) focusNext(); },
      }, icon(c), tileLabel(c.name, gold(c.cost)));
      branch(el, caught ? "cut" : verified ? "ok" : "");
    });

    finalEl.replaceChildren();
    const found = game.solved.item || (game.done && puzzle.itemId);
    const f = h("div", { class: `tile missing ${found ? "found pop" : ""}` });
    if (found) { const it = byId.get(puzzle.itemId); f.append(icon(it), tileLabel(it.name, gold(it.cost))); }
    else f.append("?", tileLabel("Finished item", "?g"));
    finalEl.append(f);
    $("#tree").classList.toggle("solved", !!found);

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
    if (game.done) return closeSuggest();
    if (!active) {
      // Typing goes to the first open text slot (the imposter is picked by tapping).
      const k = open().find((s) => s !== "imp" && sel[s] == null) || open().find((s) => sel[s] == null);
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
      })
      .slice(0, 40);
    hl = 0;
    suggest.replaceChildren();
    if (!opts.length) suggest.append(h("div", { class: "empty" }, "No match. Try another name."));
    opts.forEach((x, i) => {
      const name = term ? esc(x.name).replace(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"), "<mark>$1</mark>") : esc(x.name);
      suggest.append(h("button", { class: `opt ${i === hl ? "hl" : ""} ${tried(active, x) ? "tried" : ""}`, role: "option", onmousedown: (e) => e.preventDefault(), onclick: () => choose(x) },
        mini(x), h("span", {}, html(name)), h("span", { class: "cost" }, gold(x.cost))));
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
    q.value = "";
    renderBoard();
    focusNext();
  }

  function closeSuggest() { suggest.hidden = true; }

  q.addEventListener("focus", () => !game.done && updateSuggest());
  q.addEventListener("input", updateSuggest);
  q.addEventListener("blur", () => setTimeout(closeSuggest, 120));
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveHl(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveHl(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (!suggest.hidden && q.value.trim() && opts[hl]) choose(opts[hl]);
      else if (!$("#send").disabled) submit();
      else if (!suggest.hidden && opts[hl]) choose(opts[hl]);
    } else if (e.key === "Escape") { closeSuggest(); q.blur(); }
    else if (e.key === "Tab" && !e.shiftKey) {
      const order = open();
      if (order.length > 1) { e.preventDefault(); setActive(order[(order.indexOf(active) + 1) % order.length]); }
    }
  });
  document.querySelectorAll(".slot").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.slot;
    if (game.solved[k] != null) return;
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
    // Any item with exactly the same recipe counts.
    res.item = recipeKey(byId.get(g.item).from) === recipeKey(realItem.from);
    return res;
  }

  let busy = false;
  async function submit() {
    if (busy || game.done || $("#send").disabled) return;
    busy = true;
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
    renderBoard();
    if (game.done) { renderMiniStats(); await oracle(endMessage(), endActions()); }
    else focusNext();
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
    finish(false);
    save();
    closeSuggest();
    renderAll();
    await oracle(endMessage(), endActions());
    busy = false;
  }
  $("#btn-giveup").addEventListener("click", giveUp);

  // ---------- Oracle (assistant) ----------
  const asNode = (c) => (typeof c === "string" ? html(c) : c);
  function oracleNode(content, extra) {
    const body = h("div", { class: "body" }, h("div", { class: "who" }, "Oracle"));
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
    chips.push(chip("Item", it, g.res.item, g.res.item ? null : arrow(it, byId.get(puzzle.itemId))));
    const node = h("div", { class: "msg user" }, h("div", { class: "bubble" }, chips));
    if (instant) node.style.animation = "none";
    feed.append(node);
    scrollFeed();
  }

  function costPhrase(guess, ans) {
    if (ans.cost === guess.cost) return `costs the <b>same</b> (${gold(ans.cost)})`;
    return `costs <b>${ans.cost > guess.cost ? "more" : "less"}</b> than ${esc(guess.name)} (${gold(guess.cost)})`;
  }

  function feedbackFor(g, n) {
    const lines = [];
    const first = (k) => g.res[k] && !game.guesses.slice(0, n - 1).some((p) => p.res[k]);
    const itemAns = byId.get(puzzle.itemId);

    if (uses("imp")) {
      const imp = byId.get(puzzle.board[g.imp].id);
      if (first("imp")) lines.push(`Good eye — <b>${esc(imp.name)}</b> is the imposter. It doesn't belong in this recipe.`);
      else if (!g.res.imp) lines.push(`<b>${esc(imp.name)}</b> is legit — it really is part of the recipe. Look elsewhere for the imposter.`);
    }

    if (uses("miss")) {
      const miss = byId.get(g.miss), missAns = byId.get(puzzle.missing);
      if (first("miss")) lines.push(`<b>${esc(miss.name)}</b> slots right in. That's the missing piece.`);
      else if (!g.res.miss) {
        const shared = statSet(miss).filter((s) => statSet(missAns).includes(s));
        lines.push(`<b>${esc(miss.name)}</b> isn't missing. The missing piece ${costPhrase(miss, missAns)}${shared.length ? ` and also gives ${tagsHtml(shared)}` : " and gives different stats"}.`);
      }
    }

    const item = byId.get(g.item);
    if (first("item")) lines.push(`Yes — it builds into <b>${esc(itemAns.name)}</b> (${gold(itemAns.cost)}).`);
    else if (!g.res.item) {
      const shared = statSet(item).filter((s) => statSet(itemAns).includes(s));
      const pool = [...itemAns.from];
      const common = item.from.filter((id) => { const j = pool.indexOf(id); return j >= 0 && pool.splice(j, 1); }).length;
      lines.push(`Not <b>${esc(item.name)}</b>. The answer ${costPhrase(item, itemAns)}. ${shared.length ? `Shared stats: ${tagsHtml(shared)}.` : "No shared stats."} ${common ? `Its recipe overlaps on ${common} component${common > 1 ? "s" : ""}.` : ""}`);
    }

    if (n === 3 && !g.res.item) lines.push(`<span class="muted">Hint: the finished item grants ${tagsHtml(statSet(itemAns))}.</span>`);
    if (n === MAX_TRIES - 1 && !objectives().every((k) => g.res[k])) lines.push(`<span class="muted">Last attempt. Make it count.</span>`);
    return lines.map((l) => `<p>${l}</p>`).join("");
  }

  function endMessage() {
    const it = byId.get(puzzle.itemId);
    const twins = items.filter((x) => x.id !== it.id && recipeKey(x.from) === recipeKey(it.from));
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
    if (twins.length) notes.push(`${twins.map((t) => esc(t.name)).join(", ")} share${twins.length > 1 ? "" : "s"} this exact recipe, so ${twins.length > 1 ? "they were" : "it was"} accepted too.`);
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
    const text = `Recipe Rift · ${MODES[mode].label} ${game.won ? game.guesses.length : "X"}/${MAX_TRIES} · streak ${s.streak}\n${objectives().map((k) => SHARE_ICON[k]).join("")}\n${rows}`;
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
    store.set("rr:mode", m);
    closeSuggest();
    q.value = "";
    loadGame();
    window.scrollTo({ top: 0 });
  }

  document.querySelectorAll(".topbar .seg button").forEach((b) => b.addEventListener("click", () => switchMode(b.dataset.mode)));
  $("#btn-help").addEventListener("click", () => $("#dlg-help").showModal());
  $("#btn-stats").addEventListener("click", openStats);
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

  loadGame();
  if (!store.get("rr:seenHelp", false)) { store.set("rr:seenHelp", true); $("#dlg-help").showModal(); }
})();
