(() => {
  "use strict";

  const { version, components, items } = window.GAME_DATA;
  const MAX_TRIES = 6;
  const IMG_DIR = "assets/items/";
  const EPOCH = Date.UTC(2026, 0, 1);

  const byId = new Map([...components, ...items].map((x) => [x.id, x]));
  const recipeKey = (ids) => [...ids].sort().join("+");

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

  // Seeded RNG so the daily puzzle is the same for everyone.
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

  // ---------- puzzle generation ----------
  function makePuzzle(seed) {
    const r = rng(seed);
    const item = items[Math.floor(r() * items.length)];
    const recipe = item.from;
    const missingIdx = Math.floor(r() * recipe.length);
    const missing = recipe[missingIdx];

    // Imposter: a plausible component that is not in the recipe (shares stats, similar cost).
    const inRecipe = new Set(recipe);
    const itemStats = new Set(statSet(item));
    const scored = components
      .filter((c) => !inRecipe.has(c.id))
      .map((c) => {
        const overlap = statSet(c).filter((s) => itemStats.has(s)).length;
        const costGap = Math.abs(c.cost - byId.get(missing).cost) / 1000;
        return { c, score: overlap * 2 - costGap + r() * 1.5 };
      })
      .sort((a, b) => b.score - a.score);
    const imposter = scored[Math.floor(r() * Math.min(6, scored.length))].c.id;

    const shown = recipe.filter((_, i) => i !== missingIdx).map((id) => ({ kind: "real", id }));
    const board = shuffle([...shown, { kind: "imposter", id: imposter }, { kind: "missing" }], r);
    return { seed, itemId: item.id, recipe, missing, imposter, board };
  }

  const todayIndex = () => {
    const now = new Date();
    return Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - EPOCH) / 86400000);
  };
  const dailySeed = (n) => (n * 2654435761 + 0x9e3779b9) >>> 0;

  // ---------- state ----------
  let mode = store.get("rr:mode", "daily");
  let puzzle, game, sel, active;
  const stats = store.get("rr:stats", {});
  const statFor = (m) => (stats[m] ||= { played: 0, wins: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0] });

  function newGame() {
    if (mode === "daily") {
      const n = todayIndex();
      puzzle = makePuzzle(dailySeed(n));
      puzzle.label = `Daily #${n + 1}`;
      const saved = store.get("rr:daily", null);
      game = saved && saved.n === n ? saved.game : freshGame();
      game.n = n;
    } else {
      const saved = store.get("rr:endless", null);
      if (saved && !saved.game.done) {
        puzzle = makePuzzle(saved.seed);
        game = saved.game;
      } else {
        puzzle = makePuzzle((Math.random() * 2 ** 32) >>> 0);
        game = freshGame();
      }
      puzzle.label = "Endless";
    }
    sel = { imp: null, miss: null, item: null };
    active = null;
    for (const k of ["imp", "miss", "item"]) if (game.solved[k] != null) sel[k] = game.solved[k];
    renderAll();
    replayFeed();
  }

  function freshGame() {
    return { guesses: [], solved: { imp: null, miss: null, item: null }, verified: [], done: false, won: false };
  }

  function save() {
    if (mode === "daily") store.set("rr:daily", { n: game.n, game });
    else store.set("rr:endless", { seed: puzzle.seed, game });
  }

  // ---------- rendering ----------
  const tilesEl = $("#tiles"), finalEl = $("#final"), feed = $("#feed"), q = $("#q"), suggest = $("#suggest");

  function renderAll() {
    $("#patch").textContent = `Patch ${version} · ${items.length} items`;
    $("#puzzle-label").textContent = puzzle.label;
    document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
    renderBoard();
    renderSlots();
    renderPips();
  }

  function renderBoard() {
    tilesEl.replaceChildren();
    puzzle.board.forEach((t, i) => {
      if (t.kind === "missing") {
        const found = game.solved.miss || (game.done && puzzle.missing);
        const el = h("div", { class: `tile missing ${found ? "found" : ""}`, "aria-label": "Missing component" });
        if (found) { const c = byId.get(found); el.append(icon(c), h("span", { class: "name" }, c.name)); }
        else el.append("?");
        tilesEl.append(el);
        return;
      }
      const c = byId.get(t.id);
      const caught = game.solved.imp === i || (game.done && t.kind === "imposter");
      const verified = game.verified.includes(i) || (game.solved.imp != null && t.kind === "real") || (game.done && t.kind === "real");
      const el = h("button", {
        class: `tile ${sel.imp === i && !caught ? "selected" : ""} ${caught ? "caught" : ""} ${verified ? "verified" : ""}`,
        "aria-label": `${c.name}${caught ? " (imposter)" : verified ? " (in recipe)" : ""}`,
        "aria-pressed": String(sel.imp === i),
        disabled: game.done || game.solved.imp != null || verified,
        onclick: () => { sel.imp = sel.imp === i ? null : i; renderBoard(); renderSlots(); if (sel.imp != null) focusNext(); },
      }, icon(c), h("span", { class: "name" }, c.name));
      tilesEl.append(el);
    });

    finalEl.replaceChildren();
    const found = game.solved.item || (game.done && puzzle.itemId);
    const f = h("div", { class: `tile missing ${found ? "found pop" : ""}` });
    if (found) { const it = byId.get(puzzle.itemId); f.append(icon(it), h("span", { class: "name" }, it.name)); }
    else f.append("?");
    finalEl.append(f);

    document.querySelectorAll(".objectives li").forEach((li) => li.classList.toggle("done", game.solved[li.dataset.obj] != null));
  }

  function renderPips() {
    const pips = $("#pips");
    pips.replaceChildren(...Array.from({ length: MAX_TRIES }, (_, i) => {
      let c = "pip";
      if (i < game.guesses.length) c += game.won && i === game.guesses.length - 1 ? " win" : game.done && !game.won && i === MAX_TRIES - 1 ? " lose" : " used";
      return h("span", { class: c });
    }));
  }

  const slotName = (k) => {
    const v = sel[k];
    if (v == null) return null;
    if (k === "imp") return byId.get(puzzle.board[v].id).name;
    return byId.get(v).name;
  };

  function renderSlots() {
    document.querySelectorAll(".slot").forEach((b) => {
      const k = b.dataset.slot;
      const name = slotName(k);
      const locked = game.solved[k] != null;
      b.className = `slot ${name ? "filled" : "empty"} ${locked ? "locked" : ""} ${active === k && !locked ? "active" : ""}`;
      $(".v", b).textContent = name || (k === "imp" ? "tap a tile" : "—");
    });
    const ready = !game.done && ["imp", "miss", "item"].every((k) => sel[k] != null);
    $("#send").disabled = !ready;
    $("#composer").classList.toggle("locked", game.done);
    q.placeholder = game.done ? "Puzzle complete" :
      active === "imp" ? "Tap the imposter tile above, or type its name…" :
      active === "miss" ? "Which component is missing?" :
      active === "item" ? "What does it build into?" : "Type an item…";
  }

  // ---------- composer & suggestions ----------
  let hl = 0, opts = [];

  function setActive(k) {
    if (game.done || game.solved[k] != null) return;
    active = k;
    renderSlots();
    q.focus();
    updateSuggest();
  }

  function focusNext() {
    const next = ["imp", "miss", "item"].find((k) => sel[k] == null && game.solved[k] == null);
    active = next || null;
    renderSlots();
    if (next) { q.focus(); updateSuggest(); } else { closeSuggest(); }
  }

  function poolFor(k) {
    if (k === "miss") return components;
    if (k === "item") return items;
    if (k === "imp") return puzzle.board.map((t, i) => ({ t, i })).filter(({ t, i }) => t.kind !== "missing" && !game.verified.includes(i)).map(({ t, i }) => ({ ...byId.get(t.id), boardIdx: i }));
    return [];
  }
  const tried = (k, x) => game.guesses.some((g) => !g.res[k] && (k === "imp" ? g.imp === x.boardIdx : g[k] === x.id));

  function updateSuggest() {
    if (!active) { const k = ["miss", "item"].find((s) => sel[s] == null && game.solved[s] == null); if (!k) return closeSuggest(); active = k; renderSlots(); }
    const term = q.value.trim().toLowerCase();
    const pool = poolFor(active);
    opts = pool
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
      const b = h("button", { class: `opt ${i === hl ? "hl" : ""} ${tried(active, x) ? "tried" : ""}`, role: "option", onmousedown: (e) => e.preventDefault(), onclick: () => choose(x) },
        mini(x), h("span", {}, html(name)), h("span", { class: "cost" }, `${x.cost}g`));
      suggest.append(b);
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
      const order = ["imp", "miss", "item"].filter((k) => game.solved[k] == null);
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
    return {
      imp: g.imp != null && puzzle.board[g.imp].kind === "imposter",
      miss: g.miss === puzzle.missing,
      item: recipeKey(byId.get(g.item).from) === recipeKey(realItem.from),
    };
  }

  let busy = false;
  async function submit() {
    if (busy || game.done || $("#send").disabled) return;
    busy = true;
    const g = { imp: sel.imp, miss: sel.miss, item: sel.item };
    g.res = evaluate(g);
    game.guesses.push(g);
    if (g.res.imp) game.solved.imp = g.imp; else if (!game.verified.includes(g.imp)) game.verified.push(g.imp);
    if (g.res.miss) game.solved.miss = g.miss;
    if (g.res.item) game.solved.item = g.item;
    const won = g.res.imp && g.res.miss && g.res.item ||
      (game.solved.imp != null && game.solved.miss != null && game.solved.item != null);
    if (won || game.guesses.length >= MAX_TRIES) { game.done = true; game.won = !!won; recordStats(); }

    for (const k of ["imp", "miss", "item"]) if (game.solved[k] == null) sel[k] = null;
    save();

    userBubble(g);
    renderSlots();
    closeSuggest();
    q.blur();
    renderPips();
    if (!g.res.imp && !g.res.miss && !g.res.item) $("#composer").classList.add("shake");
    setTimeout(() => $("#composer").classList.remove("shake"), 450);

    await oracle(feedbackFor(g, game.guesses.length));
    renderBoard();
    if (game.done) await oracle(endMessage(), endActions());
    else focusNext();
    busy = false;
  }

  function recordStats() {
    const s = statFor(mode);
    s.played++;
    if (game.won) { s.wins++; s.streak++; s.best = Math.max(s.best, s.streak); s.dist[game.guesses.length - 1]++; }
    else s.streak = 0;
    store.set("rr:stats", stats);
  }

  // ---------- Oracle (assistant) ----------
  const asNode = (c) => (typeof c === "string" ? html(c) : c);
  function oracleNode(contentHtml, extra) {
    const body = h("div", { class: "body" }, h("div", { class: "who" }, "Oracle"));
    const node = h("div", { class: "msg" }, h("span", { class: "orb sm" }), body);
    if (contentHtml != null) { body.append(asNode(contentHtml)); if (extra) body.append(extra); }
    return { node, body };
  }

  async function oracle(contentHtml, extra, instant = false) {
    if (instant) { feed.append(oracleNode(contentHtml, extra).node); return; }
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
    body.append(asNode(contentHtml));
    if (extra) body.append(extra);
    scrollFeed();
  }

  const scrollFeed = () => requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));

  function chip(kind, x, ok, hint) {
    return h("span", { class: `chip ${ok ? "ok" : "no"}` }, mini(x),
      h("span", {}, h("span", { class: "k" }, kind), " ", x.name), hint ? h("span", { class: "arrowhint" }, hint) : null);
  }

  function userBubble(g, instant = false) {
    const imp = byId.get(puzzle.board[g.imp].id), miss = byId.get(g.miss), item = byId.get(g.item);
    const missAnswer = byId.get(puzzle.missing), itemAnswer = byId.get(puzzle.itemId);
    const arrow = (guess, ans) => (ans.cost > guess.cost ? "↑" : ans.cost < guess.cost ? "↓" : "=");
    const node = h("div", { class: "msg user" }, h("div", { class: "bubble" },
      chip("Imp", imp, g.res.imp),
      chip("Miss", miss, g.res.miss, g.res.miss ? null : arrow(miss, missAnswer)),
      chip("Item", item, g.res.item, g.res.item ? null : arrow(item, itemAnswer))));
    if (instant) node.style.animation = "none";
    feed.append(node);
    scrollFeed();
  }

  function costPhrase(guess, ans) {
    if (ans.cost === guess.cost) return `costs the <b>same</b> (${ans.cost}g)`;
    return `costs <b>${ans.cost > guess.cost ? "more" : "less"}</b> than ${esc(guess.name)} (${guess.cost}g)`;
  }

  function feedbackFor(g, n) {
    const lines = [];
    const imp = byId.get(puzzle.board[g.imp].id);
    const miss = byId.get(g.miss), item = byId.get(g.item);
    const missAns = byId.get(puzzle.missing), itemAns = byId.get(puzzle.itemId);

    const first = (k) => g.res[k] && !game.guesses.slice(0, n - 1).some((p) => p.res[k]);
    if (first("imp")) lines.push(`Good eye — <b>${esc(imp.name)}</b> is the imposter. It doesn't belong in this recipe.`);
    else if (!g.res.imp) lines.push(`<b>${esc(imp.name)}</b> is legit — it really is part of the recipe. Look elsewhere for the imposter.`);

    if (g.res.miss) { if (first("miss")) lines.push(`<b>${esc(miss.name)}</b> slots right in. That's the missing piece.`); }
    else {
      const shared = statSet(miss).filter((s) => statSet(missAns).includes(s));
      lines.push(`<b>${esc(miss.name)}</b> isn't missing. The missing piece ${costPhrase(miss, missAns)}${shared.length ? ` and also gives ${tagsHtml(shared)}` : " and gives different stats"}.`);
    }

    if (g.res.item) { if (first("item")) lines.push(`Yes — it builds into <b>${esc(itemAns.name)}</b>.`); }
    else {
      const shared = statSet(item).filter((s) => statSet(itemAns).includes(s));
      const pool = [...itemAns.from];
      const common = item.from.filter((id) => { const j = pool.indexOf(id); return j >= 0 && pool.splice(j, 1); }).length;
      lines.push(`Not <b>${esc(item.name)}</b>. The answer ${costPhrase(item, itemAns)}. ${shared.length ? `Shared stats: ${tagsHtml(shared)}.` : "No shared stats."} ${common ? `Its recipe overlaps on ${common} component${common > 1 ? "s" : ""}.` : ""}`);
    }

    if (n === 3 && n < MAX_TRIES && !g.res.item) {
      lines.push(`<span class="muted">Hint: the finished item grants ${tagsHtml(statSet(itemAns))}.</span>`);
    }
    if (n === MAX_TRIES - 1 && !(game.won && n === game.guesses.length)) lines.push(`<span class="muted">Last attempt. Make it count.</span>`);
    return lines.map((l) => `<p>${l}</p>`).join("");
  }

  function endMessage() {
    const it = byId.get(puzzle.itemId);
    const twins = items.filter((x) => x.id !== it.id && recipeKey(x.from) === recipeKey(it.from));
    const recipe = it.from.map((id) => byId.get(id));
    const imp = byId.get(puzzle.imposter);
    const head = game.won
      ? `<p><b>Forged in ${game.guesses.length}/${MAX_TRIES}.</b> ${["Flawless.", "Impressive.", "Clean.", "Nice work.", "Got there.", "Clutch."][game.guesses.length - 1]}</p>`
      : `<p><b>Out of attempts.</b> Here's the real recipe:</p>`;
    const frag = html(head);
    const box = h("div", { class: "reveal" });
    recipe.forEach((c, i) => { if (i) box.append(h("span", { class: "plus" }, "+")); box.append(h("span", { class: "chip ok" }, mini(c), c.name)); });
    box.append(h("span", { class: "plus" }, "→"), h("span", { class: "chip ok" }, mini(it), it.name));
    frag.append(box, html(`<p class="muted">The imposter was <b>${esc(imp.name)}</b>.${twins.length ? ` ${twins.map((t) => esc(t.name)).join(", ")} share${twins.length > 1 ? "" : "s"} this exact recipe, so ${twins.length > 1 ? "they were" : "it was"} accepted too.` : ""}</p>`));
    return frag;
  }

  function endActions() {
    const row = h("div", { class: "btn-row" },
      h("button", { class: "btn", onclick: share }, "Share result"));
    if (mode === "endless") row.prepend(h("button", { class: "btn primary", onclick: () => { store.set("rr:endless", null); newGame(); } }, "Next puzzle"));
    else row.append(h("button", { class: "btn", onclick: () => switchMode("endless") }, "Play Endless"));
    return row;
  }

  function share() {
    const sq = (ok) => (ok ? "🟩" : "🟥");
    const rows = game.guesses.map((g) => sq(g.res.imp) + sq(g.res.miss) + sq(g.res.item)).join("\n");
    const text = `Recipe Rift ${puzzle.label} ${game.won ? game.guesses.length : "X"}/${MAX_TRIES}\n🕵️🧩⚔️\n${rows}`;
    const done = () => toast("Copied to clipboard");
    if (navigator.share && matchMedia("(pointer: coarse)").matches) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(done, () => toast("Couldn't copy"));
  }

  function replayFeed() {
    feed.replaceChildren();
    const intro = `<p>${mode === "daily" ? "Today's" : "A new"} recipe has been tampered with. One component is an <b>imposter</b>, one is <b>missing</b>, and I'm hiding what it builds into.</p>
      <p class="muted">Tap the imposter tile, then type the missing component and the finished item. ${MAX_TRIES} attempts.</p>`;
    oracle(intro, null, true);
    // Rebuild the conversation without animation.
    game.guesses.forEach((g, i) => { userBubble(g, true); oracle(feedbackFor(g, i + 1), null, true); });
    if (game.done) oracle(endMessage(), endActions(), true);
    feed.querySelectorAll(".msg").forEach((m) => (m.style.animation = "none"));
  }

  // ---------- modals / misc ----------
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove("show"), 1800);
  }

  function openStats() {
    const s = statFor(mode);
    $("#stat-grid").replaceChildren(...[
      [s.played, "Played"], [s.played ? Math.round((s.wins / s.played) * 100) : 0, "Win %"], [s.streak, "Streak"], [s.best, "Best"],
    ].map(([v, l]) => h("div", {}, h("b", {}, String(v)), h("span", {}, l))));
    const max = Math.max(1, ...s.dist);
    $("#dist").replaceChildren(...s.dist.map((v, i) => h("div", { class: "row" }, String(i + 1),
      h("div", { class: `bar ${game.won && game.guesses.length === i + 1 ? "cur" : ""}`, style: `width:${Math.max(8, (v / max) * 100)}%` }, String(v)))));
    $("#dlg-stats").showModal();
  }

  function switchMode(m) {
    if (m === mode) return;
    mode = m;
    store.set("rr:mode", m);
    newGame();
    window.scrollTo({ top: 0 });
  }

  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => switchMode(b.dataset.mode)));
  $("#btn-help").addEventListener("click", () => $("#dlg-help").showModal());
  $("#btn-stats").addEventListener("click", openStats);
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

  newGame();
  if (!store.get("rr:seenHelp", false)) { store.set("rr:seenHelp", true); $("#dlg-help").showModal(); }
})();
