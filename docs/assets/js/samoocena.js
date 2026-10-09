/*
 * Samoocena przy kryteriach sukcesu + strona „Mój postęp”.
 *
 * Przy każdym punkcie ramki „Kryteria sukcesu” uczeń zaznacza: umiem /
 * częściowo / jeszcze nie. Zapis tylko w localStorage tej przeglądarki
 * (klucz „samoocena-v1”, wspólny dla wszystkich serwisów na josimate.github.io),
 * więc strona „Mój postęp” pokazuje samoocenę ze wszystkich przedmiotów.
 * Nic nie jest wysyłane — to narzędzie ucznia, nie ocena.
 *
 * Kryterium rozpoznajemy po treści (skrót z tekstu), a nie po numerze,
 * więc dopisanie nowego punktu nie przesuwa starych zaznaczeń.
 */
(function () {
  "use strict";

  const KLUCZ = "samoocena-v1";
  const OPCJE = [
    { w: "umiem", et: "umiem", tytul: "Umiem to zrobić samodzielnie" },
    { w: "czesciowo", et: "częściowo", tytul: "Umiem z pomocą albo nie wszystko" },
    { w: "nie", et: "jeszcze nie", tytul: "Jeszcze tego nie umiem — do powtórki" },
  ];
  const NAZWY_SERWISOW = { "inf-lo": "Informatyka (LO)", "inf-tt": "Informatyka (technikum)", "wiai": "Witryny i aplikacje internetowe",
    "asso": "ASSO", "inf-sb": "Informatyka (branżowa)", "lsbd": "Lokalne systemy baz danych", "sprawdziany": "Sprawdziany" };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const czysc = (t) => String(t || "").replace(/\s+/g, " ").trim();
  function skrot(t) {               // FNV-1a, 8 znaków szesnastkowych
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }
  function wczytaj() { try { return JSON.parse(localStorage.getItem(KLUCZ) || "{}") || {}; } catch { return {}; } }
  function zapiszWszystko(d) { try { localStorage.setItem(KLUCZ, JSON.stringify(d)); return true; } catch { return false; } }
  const sciezka = () => location.pathname.replace(/index\.html$/, "");
  const serwisZe = (u) => (String(u).split("/").filter(Boolean)[0] || "");
  function korzenSerwisu() {
    try { if (typeof __md_scope !== "undefined") return new URL(".", __md_scope).href; } catch { /* dalej */ }
    return new URL("/" + serwisZe(location.pathname) + "/", location.origin).href;
  }
  function tytulStrony() {
    const h = document.querySelector("article h1");
    if (!h) return czysc(document.title.split(" - ")[0]);
    const k = h.cloneNode(true); k.querySelectorAll(".headerlink").forEach((x) => x.remove());
    return czysc(k.textContent);
  }

  /* ---------- ramka „Kryteria sukcesu” na stronie tematu ---------- */
  function ramkiKryteriow() {
    return [...document.querySelectorAll("article .admonition.success, article details.success")].filter((r) =>
      /^kryteria sukcesu/i.test(czysc(r.querySelector(":scope > .admonition-title, :scope > summary")?.textContent)));
  }
  function zbudujRamke(ramka) {
    if (ramka.dataset.samoocena) return;
    const punkty = [...ramka.querySelectorAll(":scope > ol > li, :scope > ul > li")];
    if (!punkty.length) return;
    ramka.dataset.samoocena = "1";
    const dane = wczytaj();
    const strona = sciezka(), tytul = tytulStrony();
    punkty.forEach((li) => {
      const tekst = czysc(li.textContent);
      const id = strona + "#" + skrot(tekst);
      li.dataset.soId = id;
      li.dataset.soTekst = tekst.slice(0, 300);
      const gr = document.createElement("span");
      gr.className = "so-grupa"; gr.setAttribute("role", "group"); gr.setAttribute("aria-label", "Samoocena");
      gr.innerHTML = OPCJE.map((o) => `<button type="button" class="so-opcja so-${o.w}" data-w="${o.w}" title="${esc(o.tytul)}" aria-pressed="${dane[id]?.o === o.w}">${esc(o.et)}</button>`).join("");
      li.appendChild(gr);
    });
    const pasek = document.createElement("p");
    pasek.className = "so-pasek";
    ramka.appendChild(pasek);
    ramka.addEventListener("click", (e) => {
      const b = e.target.closest(".so-opcja"); if (!b) return;
      const li = b.closest("li"); const id = li.dataset.soId;
      const d = wczytaj();
      if (d[id]?.o === b.dataset.w) delete d[id];
      else d[id] = { o: b.dataset.w, t: li.dataset.soTekst, s: tytul, u: strona, d: new Date().toISOString() };
      if (!zapiszWszystko(d)) { pasek.textContent = "Ta przeglądarka nie pozwala zapisać samooceny (tryb prywatny?)."; return; }
      li.querySelectorAll(".so-opcja").forEach((x) => x.setAttribute("aria-pressed", String(d[id]?.o === x.dataset.w)));
      odswiezPasek(ramka);
    });
    odswiezPasek(ramka);
  }
  function odswiezPasek(ramka) {
    const d = wczytaj();
    const ids = [...ramka.querySelectorAll("li[data-so-id]")].map((li) => li.dataset.soId);
    const ile = (w) => ids.filter((id) => d[id]?.o === w).length;
    const ocenione = ids.filter((id) => d[id]).length;
    const pasek = ramka.querySelector(".so-pasek");
    pasek.innerHTML = (ocenione
      ? `Umiem <b>${ile("umiem")}</b> z ${ids.length}` + (ile("czesciowo") ? ` · częściowo <b>${ile("czesciowo")}</b>` : "") +
        (ile("nie") ? ` · do powtórki <b>${ile("nie")}</b>` : "")
      : "Na koniec tematu zaznacz przy każdym punkcie, jak Ci idzie. Widzisz to tylko Ty.") +
      ` · <a href="${esc(korzenSerwisu())}moj-postep/">Mój postęp</a>`;
  }

  /* ---------- strona „Mój postęp” ---------- */
  function zbudujPostep(host) {
    if (host.dataset.gotowe) return;
    host.dataset.gotowe = "1";
    host.innerHTML = `<div class="so-filtry">
        <label><input type="checkbox" class="so-tylko"> tylko do powtórki (częściowo i jeszcze nie)</label>
        <label><input type="checkbox" class="so-wszystkie"> ze wszystkich przedmiotów</label>
      </div><div class="so-lista"></div>
      <p class="so-stopka"><button type="button" class="md-button so-wyczysc">Wyczyść moją samoocenę</button></p>`;
    const rysuj = () => {
      const d = wczytaj();
      const tylko = host.querySelector(".so-tylko").checked;
      const wszystkie = host.querySelector(".so-wszystkie").checked;
      const tu = serwisZe(location.pathname);
      const wpisy = Object.entries(d).map(([id, v]) => ({ id, ...v })).filter((v) => v.u && (wszystkie || serwisZe(v.u) === tu));
      const lista = host.querySelector(".so-lista");
      if (!wpisy.length) {
        lista.innerHTML = `<p>Nie masz jeszcze samooceny${wszystkie ? "" : " w tym przedmiocie"}. Przy ramce <b>„Kryteria sukcesu”</b> w temacie zaznacz przy każdym punkcie: umiem, częściowo albo jeszcze nie.</p>`;
        return;
      }
      const strony = new Map();
      for (const v of wpisy) { if (!strony.has(v.u)) strony.set(v.u, { u: v.u, s: v.s, w: [] }); strony.get(v.u).w.push(v); }
      const kol = { nie: 0, czesciowo: 1, umiem: 2 };
      const poSerwisach = new Map();
      for (const s of strony.values()) { const k = serwisZe(s.u); if (!poSerwisach.has(k)) poSerwisach.set(k, []); poSerwisach.get(k).push(s); }
      lista.innerHTML = [...poSerwisach.entries()].map(([serwis, str]) => `
        ${wszystkie ? `<h2>${esc(NAZWY_SERWISOW[serwis] || serwis)}</h2>` : ""}
        ${str.sort((a, b) => a.s.localeCompare(b.s, "pl")).map((s) => {
          const ile = (w) => s.w.filter((x) => x.o === w).length;
          const pokaz = s.w.filter((x) => !tylko || x.o !== "umiem").sort((a, b) => kol[a.o] - kol[b.o]);
          if (!pokaz.length) return "";
          return `<section class="so-temat">
            <h3><a href="${esc(new URL(s.u, location.origin).href)}">${esc(s.s || s.u)}</a></h3>
            <div class="so-belka" aria-hidden="true">${["umiem", "czesciowo", "nie"].map((w) => ile(w) ? `<span class="so-${w}" style="flex:${ile(w)}"></span>` : "").join("")}</div>
            <p class="so-liczby">umiem ${ile("umiem")} · częściowo ${ile("czesciowo")} · jeszcze nie ${ile("nie")}</p>
            <ul>${pokaz.map((x) => `<li class="so-wpis-${x.o}"><span class="so-znacznik so-${x.o}">${esc(OPCJE.find((o) => o.w === x.o)?.et || x.o)}</span> ${esc(x.t)}</li>`).join("")}</ul>
          </section>`;
        }).join("")}`).join("") || `<p>Wszystko, co oceniłeś, zaznaczyłeś jako „umiem”. Świetnie!</p>`;
    };
    host.addEventListener("change", rysuj);
    const wyczysc = host.querySelector(".so-wyczysc");
    let potwierdz = false;
    wyczysc.addEventListener("click", () => {
      if (!potwierdz) { potwierdz = true; wyczysc.textContent = "Na pewno? Kliknij jeszcze raz"; setTimeout(() => { potwierdz = false; wyczysc.textContent = "Wyczyść moją samoocenę"; }, 4000); return; }
      const tu = serwisZe(location.pathname), d = wczytaj(), wszystkie = host.querySelector(".so-wszystkie").checked;
      for (const [id, v] of Object.entries(d)) if (wszystkie || serwisZe(v.u) === tu) delete d[id];
      zapiszWszystko(d); potwierdz = false; wyczysc.textContent = "Wyczyść moją samoocenę"; rysuj();
    });
    rysuj();
  }

  function style() {
    if (document.getElementById("so-style")) return;
    const st = document.createElement("style");
    st.id = "so-style";
    st.textContent = `
      :root { --so-umiem: #2e7d32; --so-czesciowo: #b26a00; --so-nie: #c62828; }
      [data-md-color-scheme="slate"] { --so-umiem: #81c784; --so-czesciowo: #ffb74d; --so-nie: #ef9a9a; }
      .so-grupa { display: inline-flex; flex-wrap: wrap; gap: .25rem; margin-left: .4rem; vertical-align: middle; }
      .so-opcja { font: inherit; font-size: .62rem; line-height: 1.4; padding: .05em .55em; border-radius: 999px; cursor: pointer;
        border: 1px solid var(--md-default-fg-color--lighter); background: transparent; color: var(--md-default-fg-color--light); }
      .so-opcja:hover { border-color: currentColor; }
      .so-umiem[aria-pressed="true"] { background: var(--so-umiem); border-color: var(--so-umiem); color: #fff; }
      .so-czesciowo[aria-pressed="true"] { background: var(--so-czesciowo); border-color: var(--so-czesciowo); color: #fff; }
      .so-nie[aria-pressed="true"] { background: var(--so-nie); border-color: var(--so-nie); color: #fff; }
      [data-md-color-scheme="slate"] .so-opcja[aria-pressed="true"] { color: #111; }
      .so-pasek { font-size: .7rem; color: var(--md-default-fg-color--light); margin-top: .6em !important; }
      .so-filtry { display: flex; flex-wrap: wrap; gap: .4rem 1.2rem; font-size: .75rem; margin: .8rem 0; }
      .so-temat { border: 1px solid var(--md-default-fg-color--lightest); border-radius: .4rem; padding: .6rem .9rem; margin: .8rem 0; }
      .so-temat h3 { margin: 0 0 .4rem !important; font-size: .9rem; }
      .so-belka { display: flex; height: .45rem; border-radius: 999px; overflow: hidden; background: var(--md-default-fg-color--lightest); }
      .so-belka span.so-umiem { background: var(--so-umiem); } .so-belka span.so-czesciowo { background: var(--so-czesciowo); } .so-belka span.so-nie { background: var(--so-nie); }
      .so-liczby { font-size: .68rem; color: var(--md-default-fg-color--light); margin: .3rem 0 !important; }
      .so-temat ul { margin: .2rem 0 0 !important; }
      .so-temat li { font-size: .75rem; }
      .so-znacznik { display: inline-block; font-size: .6rem; font-weight: 700; padding: 0 .5em; border-radius: 999px; color: #fff; margin-right: .3em; }
      .so-znacznik.so-umiem { background: var(--so-umiem); } .so-znacznik.so-czesciowo { background: var(--so-czesciowo); } .so-znacznik.so-nie { background: var(--so-nie); }
      [data-md-color-scheme="slate"] .so-znacznik { color: #111; }
      .so-stopka .md-button { font-size: .7rem; }
      @media print { .so-grupa, .so-pasek { display: none !important; } }`;
    document.head.appendChild(st);
  }

  /* Dla karty pracy („Wyślij do nauczyciela”): samoocena kryteriów z tej strony. */
  window.Samoocena = {
    naStronie() {
      const d = wczytaj();
      return [...document.querySelectorAll("li[data-so-id]")]
        .map((li) => ({ t: li.dataset.soTekst || "", o: d[li.dataset.soId]?.o || "" }))
        .filter((x) => x.t && x.o);
    },
  };

  function start() {
    const ramki = ramkiKryteriow();
    const hosty = document.querySelectorAll(".moj-postep");
    if (!ramki.length && !hosty.length) return;
    style();
    ramki.forEach(zbudujRamke);
    hosty.forEach(zbudujPostep);
  }
  if (typeof document$ !== "undefined") document$.subscribe(start);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
