/* Załączniki do kart pracy i prac klasowych.
 *
 * Uczeń dołącza do karty pliki, o które prosi polecenie (program, arkusz,
 * projekt, dokument). Pliki leżą w IndexedDB tej przeglądarki — nie
 * w localStorage, który ma około 5 MB wspólne dla wszystkich serwisów pod
 * josimate.github.io i nie zmieściłby nawet jednego większego pliku.
 * Do nauczyciela jadą razem z przyciskiem „Wyślij do nauczyciela” (skrypt
 * Google w wersji 8 zapisuje je w podfolderze „Załączniki” folderu tematu).
 *
 * Moduł nie ma własnego znacznika na stronie. Doczytuje go karta.js
 * (i sprawdzian.js na stronie sprawdzianów) i woła:
 *
 *   Zalaczniki.sekcja(kontener, klucz, { wysylka: true })   — ramka z listą plików
 *   await Zalaczniki.lista(klucz)       → [{ nazwa, typ, rozmiar }]
 *   await Zalaczniki.doWysylki(klucz)   → [{ nazwa, typ, b64 }]
 *   await Zalaczniki.zPaczki(klucz, [{ nazwa, typ, b64 }])
 *   await Zalaczniki.wyczysc(klucz)
 *
 * Klucz to „serwis|identyfikator karty” — strony wszystkich serwisów dzielą
 * jedną bazę, więc bez nazwy serwisu dwie karty o tej samej nazwie
 * widziałyby swoje pliki.
 */
(function () {
  "use strict";
  if (window.Zalaczniki) return;

  const LIMIT_PLIKOW = 5;
  const LIMIT_BAJTOW = 10 * 1024 * 1024;
  /* Pliki, które się uruchamia, a nie ogląda. Skrypt Google odrzuca je drugi raz. */
  const ZABRONIONE = /\.(exe|msi|bat|cmd|com|scr|pif|vbs|vbe|wsf|ps1|jar|apk|dll|lnk|reg|hta|cpl)$/i;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const wKB = (b) => (b >= 1024 * 1024
    ? (b / 1024 / 1024).toFixed(1).replace(".", ",") + " MB"
    : Math.max(1, Math.round(b / 1024)) + " kB");

  // ------------------------------------------------------------ magazyn
  const BAZA = "kp-zalaczniki", SKLEP = "pliki";
  let polaczenie = null;
  /* Gdy IndexedDB nie działa (np. tryb prywatny w starszym Firefoksie), pliki
     trzymamy w pamięci strony — wyślą się, ale znikną po jej zamknięciu. */
  const zapas = new Map();
  let tylkoPamiec = false;

  function baza() {
    if (polaczenie) return polaczenie;
    polaczenie = new Promise((ok, zle) => {
      let r;
      try { r = indexedDB.open(BAZA, 1); } catch (e) { zle(e); return; }
      r.onupgradeneeded = () => r.result.createObjectStore(SKLEP);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => zle(r.error);
      r.onblocked = () => zle(new Error("baza zablokowana"));
    }).catch((e) => { tylkoPamiec = true; polaczenie = null; throw e; });
    return polaczenie;
  }

  async function odczytaj(klucz) {
    if (!tylkoPamiec) {
      try {
        const db = await baza();
        return await new Promise((ok, zle) => {
          const r = db.transaction(SKLEP, "readonly").objectStore(SKLEP).get(klucz);
          r.onsuccess = () => ok(Array.isArray(r.result) ? r.result : []);
          r.onerror = () => zle(r.error);
        });
      } catch { tylkoPamiec = true; }
    }
    return zapas.get(klucz) || [];
  }

  async function zachowaj(klucz, pliki) {
    if (!tylkoPamiec) {
      try {
        const db = await baza();
        await new Promise((ok, zle) => {
          const tx = db.transaction(SKLEP, "readwrite");
          if (pliki.length) tx.objectStore(SKLEP).put(pliki, klucz);
          else tx.objectStore(SKLEP).delete(klucz);
          tx.oncomplete = ok;
          tx.onerror = () => zle(tx.error);
          tx.onabort = () => zle(tx.error || new Error("przerwano zapis"));
        });
        return true;
      } catch { tylkoPamiec = true; }
    }
    if (pliki.length) zapas.set(klucz, pliki); else zapas.delete(klucz);
    return false;
  }

  // ------------------------------------------------------------ operacje
  const opis = (p) => ({ nazwa: p.nazwa, typ: p.typ, rozmiar: p.rozmiar });

  async function lista(klucz) {
    return (await odczytaj(klucz)).map(opis);
  }

  /* Dodaje pliki z kontrolą limitów. Plik o tej samej nazwie zastępuje
     poprzedni — uczeń poprawił program i dodaje go jeszcze raz. */
  async function dodaj(klucz, pliki) {
    const obecne = await odczytaj(klucz);
    const odrzucone = [];
    for (const f of pliki) {
      const nazwa = String(f.name || "plik").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);
      if (ZABRONIONE.test(nazwa)) { odrzucone.push(`${nazwa} — plików programów (.exe, .bat…) nie można dołączać`); continue; }
      if (!f.size) { odrzucone.push(`${nazwa} — plik jest pusty`); continue; }
      const bez = obecne.filter((p) => p.nazwa !== nazwa);
      if (bez.length >= LIMIT_PLIKOW) { odrzucone.push(`${nazwa} — najwyżej ${LIMIT_PLIKOW} plików`); continue; }
      const suma = bez.reduce((n, p) => n + p.rozmiar, 0) + f.size;
      if (suma > LIMIT_BAJTOW) { odrzucone.push(`${nazwa} — razem byłoby ${wKB(suma)}, a można ${wKB(LIMIT_BAJTOW)}`); continue; }
      obecne.splice(0, obecne.length, ...bez, { nazwa, typ: f.type || "application/octet-stream", rozmiar: f.size, dodano: new Date().toISOString(), blob: f });
    }
    const trwale = await zachowaj(klucz, obecne);
    return { odrzucone, trwale };
  }

  async function usun(klucz, nazwa) {
    await zachowaj(klucz, (await odczytaj(klucz)).filter((p) => p.nazwa !== nazwa));
  }

  async function wyczysc(klucz) { await zachowaj(klucz, []); }

  const naBase64 = (blob) => new Promise((ok, zle) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1] || "");
    fr.onerror = () => zle(fr.error);
    fr.readAsDataURL(blob);
  });

  async function doWysylki(klucz) {
    const pliki = await odczytaj(klucz);
    const wynik = [];
    for (const p of pliki) wynik.push({ nazwa: p.nazwa, typ: p.typ, b64: await naBase64(p.blob) });
    return wynik;
  }

  /* Odtworzenie z pliku postępu (Zapisz → JSON na jednym komputerze, Wczytaj na drugim). */
  async function zPaczki(klucz, paczka) {
    if (!Array.isArray(paczka)) return;
    const pliki = paczka.filter((z) => z && z.nazwa && z.b64).slice(0, LIMIT_PLIKOW).map((z) => {
      const bin = atob(z.b64);
      const bajty = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bajty[i] = bin.charCodeAt(i);
      const blob = new Blob([bajty], { type: z.typ || "application/octet-stream" });
      return { nazwa: String(z.nazwa).slice(0, 120), typ: blob.type, rozmiar: blob.size, dodano: new Date().toISOString(), blob };
    });
    await zachowaj(klucz, pliki);
  }

  // ------------------------------------------------------------ wygląd
  const STYL = `
.kp-zal { margin: 1.4em 0 .6em; padding: .8em 1em; border: 1px solid var(--md-default-fg-color--lightest);
  border-radius: .4rem; }
.kp-zal h3 { margin: 0 0 .3em; font-size: .9rem; }
.kp-zal-opis { margin: 0 0 .6em; font-size: .72rem; color: var(--md-default-fg-color--light); }
.kp-zal-lista { list-style: none; margin: 0 0 .6em; padding: 0; }
.kp-zal-lista li { display: flex; align-items: center; gap: .6em; margin: 0 0 .3em; padding: .3em .5em;
  border-radius: .3rem; background: var(--md-code-bg-color); font-size: .75rem; }
.kp-zal-lista .kp-zal-nazwa { flex: 1; overflow-wrap: anywhere; }
.kp-zal-lista .kp-zal-rozmiar { color: var(--md-default-fg-color--light); white-space: nowrap; }
.kp-zal-lista button { border: 0; background: none; color: var(--md-accent-fg-color); cursor: pointer;
  font-size: .72rem; text-decoration: underline; }
.kp-zal-strefa { padding: .9em; border: 2px dashed var(--md-default-fg-color--lighter); border-radius: .4rem;
  text-align: center; font-size: .75rem; }
.kp-zal-strefa.kp-nad, .kp-zal-strefa:focus-visible { border-color: var(--md-accent-fg-color); outline: none; }
.kp-zal-strefa button { border: 0; background: none; color: var(--md-accent-fg-color); cursor: pointer;
  font: inherit; text-decoration: underline; padding: 0; }
.kp-zal-komunikat { margin: .5em 0 0; font-size: .72rem; }
.kp-zal-komunikat.kp-zal-blad { color: #c62828; }
`;
  function dodajStyl() {
    if (document.getElementById("kp-zal-styl")) return;
    const s = document.createElement("style");
    s.id = "kp-zal-styl";
    s.textContent = STYL;
    document.head.appendChild(s);
  }

  /* Ramka „Załączniki”. opcje.wysylka — czy strona ma przycisk „Wyślij do
     nauczyciela” (bez niego pliki oddaje się w dzienniku). */
  function sekcja(kontener, klucz, opcje = {}) {
    dodajStyl();
    const wysylka = opcje.wysylka !== false;
    kontener.innerHTML = `<section class="kp-zal">
      <h3>Załączniki</h3>
      <p class="kp-zal-opis">Pliki, o które prosi polecenie — program, arkusz, projekt, dokument.
        Najwyżej ${LIMIT_PLIKOW} plików, razem do ${wKB(LIMIT_BAJTOW)}.
        ${wysylka ? "Pojadą do nauczyciela razem z przyciskiem <strong>Wyślij do nauczyciela</strong>."
                  : "Oddaj je w dzienniku VULCAN razem z dokumentem Word."}</p>
      <ul class="kp-zal-lista"></ul>
      <div class="kp-zal-strefa" tabindex="0">Przeciągnij pliki tutaj albo
        <button type="button" class="kp-zal-wybierz">wybierz je z komputera</button>
        <input type="file" class="kp-zal-plik" multiple hidden></div>
      <p class="kp-zal-komunikat" role="status" aria-live="polite"></p>
    </section>`;
    const ul = kontener.querySelector(".kp-zal-lista");
    const strefa = kontener.querySelector(".kp-zal-strefa");
    const wejscie = kontener.querySelector(".kp-zal-plik");
    const komunikat = kontener.querySelector(".kp-zal-komunikat");
    const powiedz = (t, blad) => { komunikat.innerHTML = t; komunikat.className = "kp-zal-komunikat" + (blad ? " kp-zal-blad" : ""); };

    async function odswiez() {
      const pliki = await lista(klucz);
      ul.innerHTML = pliki.map((p) => `<li><span class="kp-zal-nazwa">${esc(p.nazwa)}</span>
        <span class="kp-zal-rozmiar">${wKB(p.rozmiar)}</span>
        <button type="button" data-usun="${esc(p.nazwa)}">usuń</button></li>`).join("");
      strefa.hidden = pliki.length >= LIMIT_PLIKOW;
      if (opcje.poZmianie) opcje.poZmianie(pliki);
    }
    async function przyjmij(pliki) {
      if (!pliki || !pliki.length) return;
      const { odrzucone, trwale } = await dodaj(klucz, [...pliki]);
      await odswiez();
      if (odrzucone.length) powiedz("Nie dodano: " + odrzucone.map(esc).join("; ") + ".", true);
      else if (!trwale) powiedz("Ta przeglądarka nie zapisuje plików na stałe (tryb prywatny?) — " +
        "wyślij kartę, zanim zamkniesz stronę.", true);
      else powiedz("Dodano. Pliki zostają w tej przeglądarce, dopóki ich nie usuniesz.");
    }

    kontener.querySelector(".kp-zal-wybierz").addEventListener("click", () => wejscie.click());
    wejscie.addEventListener("change", async () => {
      const pliki = [...wejscie.files];
      wejscie.value = "";
      await przyjmij(pliki);
    });
    strefa.addEventListener("dragover", (e) => { e.preventDefault(); strefa.classList.add("kp-nad"); });
    strefa.addEventListener("dragleave", () => strefa.classList.remove("kp-nad"));
    strefa.addEventListener("drop", async (e) => {
      e.preventDefault(); strefa.classList.remove("kp-nad");
      await przyjmij(e.dataTransfer.files);
    });
    ul.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-usun]");
      if (!b) return;
      await usun(klucz, b.dataset.usun);
      await odswiez();
      powiedz("Usunięto " + esc(b.dataset.usun) + ".");
    });
    odswiez();
    return odswiez;
  }

  window.Zalaczniki = { LIMIT_PLIKOW, LIMIT_BAJTOW, sekcja, lista, dodaj, usun, wyczysc, doWysylki, zPaczki, wKB };
})();
