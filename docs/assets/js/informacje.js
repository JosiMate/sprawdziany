/*
 * „Moje informacje zwrotne” — uczeń wpisuje klasę, numer w dzienniku i kod
 * z karteczki (ten sam co przy „Wyślij do nauczyciela”) i widzi komentarze
 * nauczyciela do swoich kart pracy i prac klasowych ze wszystkich serwisów.
 *
 * Dane leżą na Dysku nauczyciela; odczytuje je jego skrypt Google (adres
 * w ODBIOR) po sprawdzeniu kodu. Na komputerze ucznia nic nie zostaje poza
 * kodem w sessionStorage tej karty przeglądarki (znika po jej zamknięciu)
 * i klasą z numerem — też tylko w sessionStorage.
 *
 * Ocen tu nie ma — oceny są w dzienniku VULCAN.
 */
(function () {
  "use strict";

  const ODBIOR = "https://script.google.com/macros/s/AKfycbwhTDRRQxYs5eECosEyMZ-r0B-jSORYTbSuxw5_c2pepxbGe1MFf_IJgrShjLCM8utm/exec";
  const KLUCZ_KODU = "kp-kod-ucznia";        // wspólny z karta.js
  const KLUCZ_UCZNIA = "iz-uczen";           // klasa i numer, tylko na czas karty przeglądarki

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const zSesji = (k) => { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } };
  const doSesji = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* bez pamięci */ } };
  const ladnie = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || "") ? ymd.split("-").reverse().join(".") : "");
  const dzien = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("pl-PL"); };
  const akapity = (t) => esc(t).split(/\n{2,}/).map((a) => `<p>${a.replace(/\n/g, "<br>")}</p>`).join("");

  const KOMUNIKATY = {
    zly_kod: "Ten kod nie pasuje do tego numeru i klasy. Sprawdź wszystkie trzy pola.",
    zablokowane: "Za dużo złych kodów dla tego numeru — odczyt jest zablokowany na godzinę. Zawołaj nauczyciela.",
    za_czesto: "Za dużo odczytów w krótkim czasie. Odczekaj kilka minut.",
    brak_danych: "Wpisz klasę, numer w dzienniku i 5-znakowy kod z karteczki.",
    nieskonfigurowane: "Informacje zwrotne nie są jeszcze włączone.",
  };

  async function zapytaj(dane) {
    const resp = await fetch(ODBIOR, {
      method: "POST", body: JSON.stringify(dane),
      // text/plain — przeglądarka nie pyta skryptu Google o zgodę (CORS)
      headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow",
    });
    return resp.json();
  }

  function zbuduj(host) {
    if (host.dataset.gotowe) return;
    host.dataset.gotowe = "1";
    let uczen = {};
    try { uczen = JSON.parse(zSesji(KLUCZ_UCZNIA) || "{}") || {}; } catch { uczen = {}; }
    host.innerHTML = `
      <form class="iz-form" autocomplete="off">
        <label>Klasa<input name="klasa" required maxlength="8" placeholder="np. 1TT" value="${esc(uczen.klasa || "")}"></label>
        <label>Numer w dzienniku<input name="numer" required type="number" min="1" max="60" value="${esc(uczen.numer || "")}"></label>
        <label>Kod z karteczki<input name="kod" required maxlength="7" spellcheck="false" placeholder="np. K7MPQ"
          value="${esc(zSesji(KLUCZ_KODU))}" style="text-transform:uppercase;letter-spacing:.12em"></label>
        <button type="submit" class="md-button md-button--primary">Pokaż moje informacje zwrotne</button>
      </form>
      <p class="iz-status" role="status" aria-live="polite"></p>
      <div class="iz-lista"></div>`;
    const form = host.querySelector(".iz-form");
    const status = host.querySelector(".iz-status");
    const lista = host.querySelector(".iz-lista");
    let ostatnie = null;

    const pokazStatus = (t, rodzaj = "") => { status.innerHTML = t; status.className = "iz-status" + (rodzaj ? " iz-" + rodzaj : ""); };

    function dane() {
      const f = new FormData(form);
      return {
        klasa: String(f.get("klasa") || "").toUpperCase().replace(/\s+/g, ""),
        numer: String(f.get("numer") || "").trim(),
        kod: String(f.get("kod") || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
      };
    }

    function rysuj(informacje) {
      if (!informacje.length) {
        lista.innerHTML = "";
        pokazStatus("Na razie nie ma dla Ciebie informacji zwrotnych. Zajrzyj tu po sprawdzeniu kolejnej pracy.");
        return;
      }
      const nowe = informacje.filter((x) => !x.przeczytano).length;
      pokazStatus(`Informacji zwrotnych: <strong>${informacje.length}</strong>` +
        (nowe ? ` · nowych: <strong>${nowe}</strong>` : " · wszystkie przeczytane") + ".", "ok");
      lista.innerHTML = informacje.map((x, i) => `
        <article class="iz-karta${x.przeczytano ? "" : " iz-nowa"}">
          <header>
            <span class="iz-rodzaj">${esc(x.rodzaj === "praca klasowa" ? "Praca klasowa" : "Karta pracy")}${x.serwis ? " · " + esc(x.serwis) : ""}</span>
            <h3>${esc(x.tytul || x.id)}</h3>
            <span class="iz-data">${x.opublikowano ? "dodano " + esc(dzien(x.opublikowano)) : ""}${x.przeczytano ? "" : ' <span class="iz-znacznik">nowa</span>'}</span>
          </header>
          ${x.stan ? `<div class="iz-stan"><strong>Co sprawdziłem</strong><ul>${x.stan.split(/\n|\s·\s/).map((s) => s.trim()).filter(Boolean).map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>` : ""}
          ${x.komentarz ? `<div class="iz-komentarz"><strong>Komentarz</strong>${akapity(x.komentarz)}</div>` : ""}
          ${x.link || x.termin_poprawy ? `<p class="iz-dalej">
            ${x.link ? `<a href="${esc(x.link)}" class="md-button" target="_blank" rel="noopener">Powtórz ten temat</a>` : ""}
            ${x.termin_poprawy ? `<span>Poprawa do <strong>${esc(ladnie(x.termin_poprawy))}</strong></span>` : ""}</p>` : ""}
          <p class="iz-przeczytane">${x.przeczytano
            ? `Przeczytano ${esc(x.przeczytano)}`
            : `<button type="button" class="md-button iz-przeczytalem" data-i="${i}">Przeczytałem</button>`}</p>
        </article>`).join("");
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const d = dane();
      if (!d.klasa || !d.numer || d.kod.length !== 5) { pokazStatus(KOMUNIKATY.brak_danych, "blad"); return; }
      doSesji(KLUCZ_KODU, d.kod);
      doSesji(KLUCZ_UCZNIA, JSON.stringify({ klasa: d.klasa, numer: d.numer }));
      const btn = form.querySelector("button"); btn.disabled = true;
      pokazStatus("Wczytuję…");
      try {
        const w = await zapytaj({ akcja: "informacje", ...d });
        if (w && w.ok) { ostatnie = { d, lista: w.informacje || [] }; rysuj(ostatnie.lista); }
        else {
          lista.innerHTML = "";
          pokazStatus((KOMUNIKATY[w && w.blad] || "Serwer nauczyciela nie odpowiedział poprawnie. Spróbuj za chwilę.") +
            (w && w.blad === "zly_kod" && w.pozostalo != null ? ` Zostało prób: ${esc(w.pozostalo)}.` : ""), "blad");
        }
      } catch {
        pokazStatus("Nie udało się połączyć z serwerem nauczyciela. Sprawdź internet i spróbuj jeszcze raz.", "blad");
      } finally { btn.disabled = false; }
    });

    lista.addEventListener("click", async (e) => {
      const b = e.target.closest(".iz-przeczytalem");
      if (!b || !ostatnie) return;
      const x = ostatnie.lista[Number(b.dataset.i)];
      b.disabled = true; b.textContent = "Zapisuję…";
      try {
        const w = await zapytaj({ akcja: "przeczytalem", ...ostatnie.d, id: x.id, wersja: x.opublikowano });
        if (w && w.ok) { x.przeczytano = w.przeczytano || "teraz"; rysuj(ostatnie.lista); return; }
        b.textContent = "Nie udało się — spróbuj jeszcze raz"; b.disabled = false;
      } catch { b.textContent = "Brak połączenia — spróbuj jeszcze raz"; b.disabled = false; }
    });
  }

  /* Style tylko tego widżetu i przycisku na belce — wstrzykiwane raz, żeby nie ruszać wspólnego extra.css
     i żeby działały tak samo w każdym serwisie (także w sprawdzianach). */
  function style() {
    if (document.getElementById("iz-style")) return;
    const st = document.createElement("style");
    st.id = "iz-style";
    st.textContent = `
      .iz-form { display: flex; flex-wrap: wrap; gap: .6rem 1rem; align-items: end; margin: 1rem 0; }
      .iz-form label { display: grid; gap: .2rem; font-size: .75rem; color: var(--md-default-fg-color--light); }
      .iz-form input { font: inherit; font-size: .85rem; padding: .35em .6em; border: 1px solid var(--md-default-fg-color--lighter);
        border-radius: .3rem; background: var(--md-default-bg-color); color: var(--md-default-fg-color); width: 9rem; }
      .iz-form .md-button { margin: 0; }
      .iz-status { min-height: 1.2em; }
      .iz-status.iz-blad { color: #c62828; }
      .iz-lista { display: grid; gap: 1rem; }
      .iz-karta { border: 1px solid var(--md-default-fg-color--lightest); border-left: 4px solid var(--md-default-fg-color--lighter);
        border-radius: .4rem; padding: .8rem 1rem; }
      .iz-karta.iz-nowa { border-left-color: var(--md-accent-fg-color); }
      .iz-karta header { display: grid; gap: .1rem; margin-bottom: .4rem; }
      .iz-karta h3 { margin: 0 !important; font-size: .95rem; }
      .iz-rodzaj, .iz-data { font-size: .7rem; color: var(--md-default-fg-color--light); }
      .iz-znacznik { background: var(--md-accent-fg-color); color: var(--md-accent-bg-color); border-radius: 999px; padding: 0 .5em; font-weight: 700; }
      .iz-stan ul { margin: .2rem 0 .6rem; }
      .iz-komentarz p { margin: .3rem 0; }
      .iz-dalej { display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: center; }
      .iz-dalej .md-button, .iz-przeczytane .md-button { margin: 0; font-size: .75rem; padding: .3em 1em; }
      .iz-przeczytane { font-size: .75rem; color: var(--md-default-fg-color--light); margin: .4rem 0 0; }
      .iz-naglowek { display: inline-flex; align-items: center; gap: .35rem; flex-shrink: 0; margin: 0 .4rem;
        padding: .3rem .6rem; border-radius: .3rem; color: inherit; font-size: .7rem; font-weight: 700; white-space: nowrap; }
      .iz-naglowek:hover, .iz-naglowek:focus-visible { color: inherit; background: rgba(255, 255, 255, .12); }
      .iz-naglowek.iz-tu { background: rgba(255, 255, 255, .2); }
      .iz-naglowek svg { width: 1.2rem; height: 1.2rem; fill: currentColor; }
      @media screen and (max-width: 59.984em) { .iz-naglowek span { display: none; } .iz-naglowek { margin: 0 .2rem; padding: .4rem; } }`;
    document.head.appendChild(st);
  }

  /* Stały przycisk na górnej belce (przed wyszukiwarką) — widoczny na każdej
     stronie serwisu, prowadzi do „Moje informacje zwrotne”. Wstawiany z JS,
     żeby nie trzeba było nadpisywać szablonu Material w 7 serwisach. */
  const IKONA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2m-9.5 12L7 10.5l1.41-1.41 2.09 2.08 5.09-5.08L17 7.5z"/></svg>';

  function adresStrony() {
    try { if (typeof __md_scope !== "undefined") return new URL("informacje-zwrotne/", __md_scope).href; } catch { /* dalej */ }
    const zMenu = document.querySelector('a.md-nav__link[href$="informacje-zwrotne/"]');
    return zMenu ? zMenu.href : new URL("informacje-zwrotne/", document.baseURI).href;
  }

  function przyciskWNaglowku() {
    const belka = document.querySelector(".md-header__inner");
    if (!belka) return;
    let a = belka.querySelector(".iz-naglowek");
    if (!a) {
      a = document.createElement("a");
      a.className = "iz-naglowek";
      a.href = adresStrony();
      a.title = "Moje informacje zwrotne — komentarze nauczyciela do Twoich prac";
      a.innerHTML = IKONA + "<span>Informacje zwrotne</span>";
      const przed = belka.querySelector('label.md-header__button[for="__search"]') ||
        belka.querySelector(".md-search") || belka.querySelector(".md-header__source");
      if (przed) belka.insertBefore(a, przed); else belka.appendChild(a);
    }
    const tu = /\/informacje-zwrotne\/?(index\.html)?$/.test(location.pathname);
    a.classList.toggle("iz-tu", tu);
    if (tu) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }

  function start() {
    style();
    przyciskWNaglowku();
    document.querySelectorAll(".informacje-zwrotne").forEach(zbuduj);
  }
  // Material przeładowuje treść bez odświeżania strony — trzeba wpiąć się w document$
  if (typeof document$ !== "undefined") document$.subscribe(start);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
