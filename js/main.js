(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const { s: S, t: T } = I18N; // S("key") interface text, T(value) translated content

  /* ───────── Performance mode ─────────
     "lite" switches off motion and keeps the 3D parts unloaded until asked (printbed.js, workbench.js).
     Defaults to lite for reduced-motion, data-saver or low-memory devices; the visitor's choice is remembered. */
  const PERF = (window.PERF = { lite: false });
  {
    let saved = null;
    try { saved = localStorage.getItem("perf"); } catch {}
    const weak = navigator.connection?.saveData || (navigator.deviceMemory && navigator.deviceMemory <= 2);
    PERF.lite = saved ? saved === "lite" : reduced || !!weak;
  }
  const perfBtn = $("[data-perf]");
  function setPerf(lite, save) {
    PERF.lite = lite;
    document.documentElement.classList.toggle("lite", lite);
    perfBtn.setAttribute("aria-pressed", lite);
    perfBtn.querySelector("b").textContent = lite ? "Lite" : "Full";
    if (save) try { localStorage.setItem("perf", lite ? "lite" : "full"); } catch {}
    document.dispatchEvent(new CustomEvent("perfchange"));
  }
  setPerf(PERF.lite, false);
  perfBtn.addEventListener("click", () => setPerf(!PERF.lite, true));

  /* ───────── Text splitting ───────── */
  function splitChars(el, text = el.textContent) {
    el.textContent = "";
    [...text].forEach((c, i) => {
      const s = document.createElement("span");
      s.className = "ch";
      s.style.setProperty("--i", i);
      s.textContent = c === " " ? " " : c;
      el.appendChild(s);
    });
    return $$(".ch", el);
  }

  function splitWords(el, text = el.textContent) {
    const words = text.trim().split(/\s+/);
    el.textContent = "";
    let i = 0;
    words.forEach((w, wi) => {
      const wd = document.createElement("span");
      wd.className = "wd";
      [...w].forEach((c) => {
        const s = document.createElement("span");
        s.className = "ch";
        s.style.setProperty("--i", i++);
        s.textContent = c;
        wd.appendChild(s);
      });
      el.appendChild(wd);
      if (wi < words.length - 1) el.appendChild(document.createTextNode(" "));
    });
  }

  /* ───────── Render content from data.js (re-run on language change) ───────── */
  const chips = (tags) => `<ul class="chips">${tags.map((t) => `<li>${esc(T(t))}</li>`).join("")}</ul>`;

  function renderCAD() {
    const term = $(".tabs [aria-selected=true]").dataset.term;
    $("[data-cad]").innerHTML = CAD.map((p, i) => {
      const cover = p.pages[0];
      const model = p.pages.length > 1 ? p.pages[p.pages.length - 1] : null;
      const hide = term !== "all" && p.term !== term ? " hide" : "";
      return `
        <button class="card rise${hide}" data-term="${p.term}" data-cad-i="${i}" style="--d:${(i % 5) * 60}ms" aria-label="${esc(S("card.open"))}: ${esc(T(p.title))}">
          <div class="card__media">
            <span class="card__tag ${p.final ? "final" : ""}">${p.final ? S("card.final") : p.n} · ${p.term === "ws" ? "WS 25/26" : "SS 26"}</span>
            <img src="${cover.sm}" alt="${esc(cover.alt)} — poster" loading="lazy" decoding="async" width="640" height="1357" />
            ${model ? `<img class="alt" src="${model.sm}" alt="" loading="lazy" decoding="async" width="640" height="1357" /><span class="card__swap">${S("card.model")}</span>` : ""}
          </div>
          <div class="card__info">
            <div>
              <div class="card__title">${esc(T(p.title))}</div>
              <div class="card__line">${esc(T(p.line))}</div>
            </div>
            <span class="card__n mono">${p.pages.length}p</span>
          </div>
        </button>`;
    }).join("");
  }

  function renderProducts() {
    $("[data-products]").innerHTML = PRODUCTS.map((p, i) => `
      <article class="case${p.cutout ? " case--cutout" : ""}" data-gallery="products:${i}" style="--ratio:${p.ratio || "4 / 3"}">
        <button class="case__media layer" data-open="0" aria-label="${esc(S("card.open"))}: ${esc(T(p.title))}">
          <img src="${p.images[0].src}" alt="${esc(p.images[0].alt)}" loading="lazy" decoding="async" />
          <span class="open">${S("case.images", { n: p.images.length })}</span>
        </button>
        <div class="case__body rise">
          <span class="case__kicker mono">${esc(T(p.kicker))}</span>
          <h3 class="case__title">${esc(T(p.title))}</h3>
          <p class="case__text">${esc(T(p.text))}</p>
          ${chips(p.tags)}
          <div class="thumbs">${p.images.slice(1).map((im, j) => `
            <button data-open="${j + 1}" aria-label="${j + 2}"><img src="${im.sm}" alt="" loading="lazy" decoding="async" /></button>`).join("")}
          </div>
        </div>
      </article>`).join("");
  }

  function renderSOS() {
    $("[data-sos]").innerHTML = SOS.map((p, i) => `
      <article class="sos__item rise" data-gallery="sos:${i}" style="--d:${i * 120}ms">
        <button class="browser" data-open="0" aria-label="${esc(S("card.open"))}: ${esc(p.title)}">
          <div class="browser__bar"><i></i><i></i><i></i><span>${esc(p.title.toLowerCase())} — ${S("sos.screens", { n: p.images.length })}</span></div>
          <img src="${p.images[0].sm}" alt="${esc(p.images[0].alt)}" loading="lazy" decoding="async" />
        </button>
        <div class="sos__meta"><h3 class="sos__title">${esc(p.title)}</h3><span class="sos__place mono">${esc(p.place)}</span></div>
        <p class="sos__text">${esc(T(p.text))}</p>
        <div class="sos__row">
          ${chips(p.tags)}
          ${p.play ? `<button class="playbtn mono" data-play="${esc(p.play)}">${S("sos.play")}</button>` : ""}
        </div>
        ${p.extra ? `
        <button class="extra" data-gallery="sosx:${i}" data-open="0" aria-label="${esc(S("card.open"))}: ${esc(p.extra.title)}">
          <img src="${p.extra.images[0].sm}" alt="" loading="lazy" decoding="async" />
          <span><b class="mono">${S("sos.also")} · ${esc(p.extra.title)}</b>${esc(T(p.extra.line))}</span>
          <span class="mono">↗</span>
        </button>` : ""}
      </article>`).join("");
  }

  function renderTools() {
    $("[data-tools]").innerHTML = TOOLS.map((t, i) => `
      <button class="tool rise" data-gallery="tools:${i}" data-open="0" style="--d:${(i % 4) * 70}ms" aria-label="${esc(S("card.open"))}: ${esc(t.title)}">
        <div class="tool__shot">
          <span class="tool__idx">${String(i + 1).padStart(2, "0")}</span>
          <img src="${t.images[0].sm}" alt="${esc(t.title)} screenshot" loading="lazy" decoding="async" />
        </div>
        <div class="tool__name"><span>${esc(t.title)}</span><span>↗</span></div>
        <p class="tool__line">${esc(T(t.line))}</p>
      </button>`).join("");
  }

  function renderLinks() {
    const links = [["GitHub", SITE.github]];
    const email = [].concat(SITE.email || []).join("@");
    if (email) links.unshift([S("contact.write"), `mailto:${email}`]);
    if (SITE.instagram) links.push(["Instagram", SITE.instagram]);
    if (SITE.linkedin) links.push(["LinkedIn", SITE.linkedin]);
    $("[data-links]").innerHTML = links
      .map(([l, h]) => `<a href="${esc(h)}" ${h.startsWith("http") ? 'target="_blank" rel="noopener"' : ""}>${esc(l)} ↗</a>`)
      .join("");
    $(".contact__big").href = email ? `mailto:${email}` : SITE.github;
  }

  /* ───────── Clicks (bound once, survive re-renders) ───────── */
  $("[data-cad]").addEventListener("click", (e) => {
    const card = e.target.closest("[data-cad-i]");
    if (!card) return;
    const p = CAD[card.dataset.cadI];
    openViewer(p.pages, `${T(p.title)} — ${T(p.line)}`);
  });

  $$(".tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
      const t = b.dataset.term;
      $$("[data-cad] .card").forEach((c) => c.classList.toggle("hide", t !== "all" && c.dataset.term !== t));
    })
  );

  const GALLERIES = { products: PRODUCTS, sos: SOS, sosx: SOS.map((p) => p.extra), tools: TOOLS };
  document.addEventListener("click", (e) => {
    const play = e.target.closest("[data-play]");
    if (play) return openGame(play.dataset.play);
    const btn = e.target.closest("[data-open]");
    if (!btn) return;
    const host = btn.closest("[data-gallery]");
    const [group, idx] = host.dataset.gallery.split(":");
    const item = GALLERIES[group][idx];
    openViewer(item.images, T(item.title), +btn.dataset.open);
  });

  /* ───────── Viewer ───────── */
  const viewer = $(".viewer:not(.game)");
  const track = $(".viewer__track");
  let current = 0;

  function openViewer(images, title, start = 0) {
    $(".viewer__title").textContent = title;
    track.innerHTML = images
      .map((im, i) => `<img src="${im.src}" alt="${esc(im.alt || title)}" ${i === start ? "" : 'loading="lazy"'} decoding="async" />`)
      .join("");
    viewer.showModal();
    document.body.classList.add("locked");
    current = start;
    updateCount();
    requestAnimationFrame(() => track.children[start]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" }));
    track.focus({ preventScroll: true });
  }

  function updateCount() {
    $(".viewer__count").textContent = `${String(current + 1).padStart(2, "0")} / ${String(track.children.length).padStart(2, "0")}`;
  }

  function go(d) {
    current = Math.max(0, Math.min(track.children.length - 1, current + d));
    track.children[current].scrollIntoView({ inline: "center", block: "nearest", behavior: reduced ? "instant" : "smooth" });
    updateCount();
  }

  track.addEventListener("scroll", () => {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0, bestD = Infinity;
    [...track.children].forEach((el, i) => {
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
      if (d < bestD) (bestD = d), (best = i);
    });
    if (best !== current) (current = best), updateCount();
  }, { passive: true });

  $(".viewer__prev").addEventListener("click", () => go(-1));
  $(".viewer__next").addEventListener("click", () => go(1));
  $(".viewer__close").addEventListener("click", () => viewer.close());
  viewer.addEventListener("close", () => document.body.classList.remove("locked"));
  viewer.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") e.preventDefault(), go(1);
    if (e.key === "ArrowLeft") e.preventDefault(), go(-1);
  });
  // Vertical wheel scrolls the strip sideways
  track.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      track.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });

  /* ───────── Game player ───────── */
  const game = $(".game");
  const frame = $(".game__frame");
  function openGame(url) {
    frame.src = url;
    $(".game__newtab").href = url;
    game.showModal();
    document.body.classList.add("locked");
    frame.focus();
  }
  $(".game__close").addEventListener("click", () => game.close());
  game.addEventListener("close", () => {
    frame.src = "about:blank"; // stops the game and its sound
    document.body.classList.remove("locked");
  });

  /* ───────── Hero: stretchy letters, crosshair, coordinates ───────── */
  let resplitContact = () => {};
  function hero() {
    const heroEl = $(".hero");
    const lines = $$(".hero__line");
    const chars = [];
    lines.forEach((l, row) => splitChars(l).forEach((c) => (c.style.setProperty("--row", row), chars.push(c))));
    const big = $(".contact__big");
    let contactChars = [];
    resplitContact = () => {
      contactChars = splitChars($(".contact [data-stretch]"), S("contact.big"));
      contactChars.forEach((c) => (c.style.transition = "font-variation-settings .4s cubic-bezier(.2,.8,.2,1)"));
    };
    resplitContact();

    // Cache centres at rest so width changes don't feed back into distances
    let centres = [];
    const measure = () => (centres = chars.map((c) => { const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2 + scrollY]; }));
    const state = chars.map(() => ({ w: 100, t: 100 }));
    let pointer = null, visible = true, raf = 0;

    const xEl = $("[data-x]"), yEl = $("[data-y]");
    heroEl.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      pointer = [e.clientX, e.clientY + scrollY];
      const r = heroEl.getBoundingClientRect();
      heroEl.style.setProperty("--mx", `${e.clientX - r.left}px`);
      heroEl.style.setProperty("--my", `${e.clientY - r.top}px`);
      heroEl.classList.add("has-pointer");
      xEl.textContent = ((e.clientX - r.left) / 3.78).toFixed(1).padStart(5, "0");
      yEl.textContent = ((e.clientY - r.top) / 3.78).toFixed(1).padStart(5, "0");
      kick();
    });
    heroEl.addEventListener("pointerleave", () => { pointer = null; heroEl.classList.remove("has-pointer"); kick(); });

    function frame(t) {
      raf = 0;
      let moving = false;
      chars.forEach((c, i) => {
        const s = state[i];
        if (pointer) {
          const d = Math.hypot(pointer[0] - centres[i][0], (pointer[1] - centres[i][1]) * 1.4);
          const f = Math.max(0, 1 - d / 420);
          s.t = 92 + 33 * f * f;
        } else if (!finePointer) {
          s.t = 100 + 18 * Math.sin(t / 700 + i * 0.55); // touch: a slow wave
          moving = true;
        } else s.t = 100;
        s.w += (s.t - s.w) * 0.14;
        if (Math.abs(s.t - s.w) > 0.2) moving = true;
        c.style.setProperty("--w", s.w.toFixed(1));
      });
      if (moving && visible) kick();
    }
    const kick = () => { if (!raf && !PERF.lite) raf = requestAnimationFrame(frame); };
    document.addEventListener("perfchange", () => {
      if (!PERF.lite) return kick();
      state.forEach((s) => (s.w = s.t = 100)); // lite: letters back to rest
      chars.forEach((c) => c.style.setProperty("--w", 100));
    });

    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }).observe(heroEl);
    // wait for the print-in animation and fonts before measuring
    document.fonts.ready.then(() => { measure(); kick(); });
    addEventListener("load", measure);
    addEventListener("resize", measure);
    heroEl.addEventListener("pointerenter", () => { if (!pointer) measure(); });

    // Contact: letters widen in a ripple on hover
    big.addEventListener("pointerenter", () => !PERF.lite && contactChars.forEach((c, i) => setTimeout(() => c.style.setProperty("--w", 125), i * 35)));
    big.addEventListener("pointerleave", () => contactChars.forEach((c, i) => setTimeout(() => c.style.setProperty("--w", 100), i * 35)));
  }

  /* ───────── Rotating verb ───────── */
  function renderHeroTag() {
    const words = S("hero.words").split(",");
    $("[data-hero-tag]").innerHTML = S("hero.tag").replace("{swap}", `<span class="swap">${esc(words[0])}</span>`);
  }
  function swap() {
    let i = 0;
    setInterval(() => {
      const el = $(".swap");
      const words = S("hero.words").split(",");
      if (PERF.lite || !el) return;
      el.classList.add("out");
      setTimeout(() => {
        i = (i + 1) % words.length;
        el.textContent = words[i];
        el.classList.remove("out");
        el.classList.add("in");
        setTimeout(() => el.classList.remove("in"), 400);
      }, 250);
    }, 2000);
  }

  /* ───────── Scroll: statement words light up ───────── */
  const st = $("[data-words-reveal]");
  let ws = [];
  function renderStatement() {
    st.innerHTML = S("statement").trim().split(/\s+/)
      .map((w) => `<span class="w${/CAD|AI|KI|printer|stampante|Drucker|software|Software/.test(w) ? " hl" : ""}">${esc(w)}</span>`)
      .join(" ");
    ws = $$(".w", st);
    updateStatement();
  }
  function updateStatement() {
    const r = st.getBoundingClientRect();
    const sp = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35)));
    const on = Math.round(sp * ws.length);
    ws.forEach((w, i) => w.classList.toggle("on", i < on));
  }
  let ticking = false;
  addEventListener("scroll", () => { if (!ticking) (ticking = true), requestAnimationFrame(() => ((ticking = false), updateStatement())); }, { passive: true });

  /* ───────── Reveal on scroll ───────── */
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }),
    { rootMargin: "0px 0px -10% 0px" }
  );
  const observe = (root = document) => $$(".rise, .layer, [data-split]", root).forEach((el) => io.observe(el));

  /* ───────── Language ───────── */
  function applyStatic() {
    const html = document.documentElement;
    html.lang = I18N.lang;
    document.title = S("meta.title");
    $('meta[name="description"]').content = S("meta.desc");
    $$("[data-i18n]").forEach((el) => {
      // split headings keep their per-letter animation: re-split with the new text
      if (el.matches("[data-split]")) splitWords(el, S(el.dataset.i18n));
      else el.textContent = S(el.dataset.i18n);
    });
    $$("[data-i18n-html]").forEach((el) => (el.innerHTML = S(el.dataset.i18nHtml)));
    $$("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", S(el.dataset.i18nAria)));
    $$("[data-i18n-title]").forEach((el) => (el.title = S(el.dataset.i18nTitle)));
    $$("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === I18N.lang));
  }

  function renderAll() {
    renderCAD();
    renderProducts();
    renderSOS();
    renderTools();
    renderLinks();
    renderHeroTag();
    renderStatement();
  }

  function setLang(lang) {
    if (lang === I18N.lang) return;
    I18N.lang = lang;
    try { localStorage.setItem("lang", lang); } catch {}
    applyStatic();
    renderAll();
    resplitContact();
    // the reader is mid-page: show re-rendered content straight away
    $$(".rise, .layer, [data-split]").forEach((el) => el.classList.add("in"));
    document.dispatchEvent(new CustomEvent("langchange"));
  }
  $$("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));

  /* ───────── Start ───────── */
  $$("[data-split]:not([data-i18n])").forEach((el) => splitWords(el));
  applyStatic();
  renderAll();
  hero();
  swap();
  observe();
})();
