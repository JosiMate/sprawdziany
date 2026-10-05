/* Sprawdzian przy komputerze.
 *
 * Uczeń wczytuje arkusz (plik .json od nauczyciela), odpowiada na stronie
 * i na koniec pobiera jeden dokument Word, który oddaje przez dziennik.
 * Nic nie wychodzi poza komputer ucznia — nie ma tu żadnego serwera.
 *
 * Silnik pól i składania .docx pochodzi z karty pracy (karta.js
 * w serwisach z materiałami). Różnice wynikają z tego, że sprawdzian pisze
 * się w pracowni, na komputerze, przy którym za godzinę usiądzie ktoś inny:
 *
 *  - Odpowiedzi leżą w IndexedDB, nie w localStorage. localStorage ma około
 *    5 MB wspólne dla WSZYSTKICH serwisów pod josimate.github.io — kilka
 *    zrzutów ekranu i sprawdzian stanąłby na „brak miejsca". IndexedDB ma
 *    limit liczony w setkach megabajtów.
 *  - Na komputerze jest miejsce na JEDNĄ pracę. Kto otwiera stronę, a zastaje
 *    cudzą pracę, dostaje pytanie „czy to twoja?" — i albo do niej wraca (bo
 *    przeglądarka się zamknęła), albo ją usuwa i zaczyna od nowa. Praca
 *    starsza niż WAZNOSC_GODZ znika sama.
 *  - Po pobraniu dokumentu uczeń kończy pracę jednym przyciskiem, który
 *    usuwa jego odpowiedzi z komputera.
 *
 * Użycie w Markdownie:   <div id="sprawdzian" class="sprawdzian"></div>
 */
(function () {
  "use strict";

  // Ścieżka do katalogu, z którego wczytano ten skrypt — obok leży docx.umd.js.
  const KATALOG = (document.currentScript && document.currentScript.src)
    ? document.currentScript.src.replace(/[^/]+$/, "") : "";

  const FORMAT = "arkusz-sprawdzianu-pceikz";
  const WERSJA = 1;
  const WAZNOSC_GODZ = 12;

  const POZIOMY_DOMYSLNE = [
    { kod: "K", opis: "wymagania konieczne", ocena: "2" },
    { kod: "P", opis: "wymagania podstawowe", ocena: "3" },
    { kod: "R", opis: "wymagania rozszerzające", ocena: "4" },
    { kod: "D", opis: "wymagania dopełniające", ocena: "5" },
  ];
  const REGULA_DOMYSLNA =
    "Ocenę wyznacza najwyższy poziom zaliczony w całości — razem ze wszystkimi niższymi. " +
    "Poziom jest zaliczony, gdy wykonasz wszystkie jego polecenia z wyjątkiem najwyżej " +
    "jednego; poleceń oznaczonych gwiazdką (★) ta tolerancja nie obejmuje.";

  const TYPY_POL = ["tekst", "tabela", "zrzut", "wybor"];

  /* Biblioteka składająca .docx waży ponad megabajt — doczytujemy ją dopiero
     przy pierwszym kliknięciu „Pobierz jako dokument Word”. */
  let ladowanie = null;
  function zaladujDocx() {
    if (typeof docx !== "undefined") return Promise.resolve();
    if (ladowanie) return ladowanie;
    ladowanie = new Promise((ok, blad) => {
      const s = document.createElement("script");
      s.src = KATALOG + "docx.umd.js";
      s.onload = () => (typeof docx !== "undefined" ? ok() : blad(new Error("moduł wczytany, ale pusty")));
      s.onerror = () => { ladowanie = null; blad(new Error("nie udało się pobrać modułu")); };
      document.head.appendChild(s);
    });
    return ladowanie;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const godzina = (iso) => new Date(iso).toLocaleTimeString("pl-PL",
    { hour: "2-digit", minute: "2-digit" });
  const dataGodzina = (iso) => new Date(iso).toLocaleString("pl-PL",
    { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const toSamDzien = (iso) => new Date(iso).toDateString() === new Date().toDateString();
  const kiedy = (iso) => (toSamDzien(iso) ? "dziś o " + godzina(iso) : dataGodzina(iso));

  /* ─────────────────────────── treść z arkusza ───────────────────────────
     Polecenia w arkuszu mogą mieć proste wyróżnienia: pogrubienie, kursywę,
     kod (adresy, polecenia). Arkusz przychodzi z pliku, więc zostawiamy
     wyłącznie te znaczniki i to bez atrybutów — wszystko inne zamienia się
     w zwykły tekst. Ten sam przefiltrowany kod idzie do dokumentu Word. */
  const DOZWOLONE = new Set(["B", "STRONG", "I", "EM", "U", "CODE", "KBD", "BR", "SUB", "SUP"]);
  const WYRZUCANE = new Set(["SCRIPT", "STYLE", "TEMPLATE", "IFRAME", "OBJECT", "SVG", "MATH"]);

  function oczysc(html) {
    const t = document.createElement("template");
    t.innerHTML = String(html ?? "");
    const przejdz = (wezel) => {
      for (const d of [...wezel.childNodes]) {
        if (d.nodeType === 1) {
          if (WYRZUCANE.has(d.tagName)) { d.remove(); continue; }
          przejdz(d);
          if (DOZWOLONE.has(d.tagName)) {
            for (const a of [...d.attributes]) d.removeAttribute(a.name);
          } else {
            d.replaceWith(...d.childNodes);
          }
        } else if (d.nodeType !== 3) {
          d.remove();
        }
      }
    };
    przejdz(t.content);
    return t.innerHTML;
  }

  /* Ten sam fragment rozłożony na kawałki tekstu z krojem — do dokumentu. */
  function naKawalki(html) {
    const t = document.createElement("template");
    t.innerHTML = oczysc(html);
    const wynik = [];
    const idz = (w, styl) => {
      for (const d of w.childNodes) {
        if (d.nodeType === 3) {
          const tekst = d.textContent.replace(/\s+/g, " ");
          if (tekst) wynik.push({ t: tekst, ...styl });
        } else if (d.nodeType === 1) {
          if (d.tagName === "BR") { wynik.push({ br: true }); continue; }
          const s = { ...styl };
          if (d.tagName === "B" || d.tagName === "STRONG") s.bold = true;
          if (d.tagName === "I" || d.tagName === "EM") s.italics = true;
          if (d.tagName === "U") s.underline = true;
          if (d.tagName === "CODE" || d.tagName === "KBD") s.mono = true;
          if (d.tagName === "SUB") s.sub = true;
          if (d.tagName === "SUP") s.sup = true;
          idz(d, s);
        }
      }
    };
    idz(t.content, {});
    if (wynik.length && wynik[0].t) wynik[0].t = wynik[0].t.replace(/^ /, "");
    return wynik;
  }

  const poziomy = (a) => (Array.isArray(a.poziomy) && a.poziomy.length ? a.poziomy : POZIOMY_DOMYSLNE);
  const maPoziomy = (a) => a.zadania.some((z) => (z.polecenia || []).some((p) => p.poziom));
  const znacznik = (p) => (p.poziom ? p.poziom + (p.kluczowe ? " ★" : "") : "");
  const oznaczenie = (z, p) => `${z.nr}${p.nr ?? ""}`;

  function idPol(pole) {
    return pole.typ === "tabela" ? (pole.wiersze || []).map((w) => w && w[0]) : [pole.id];
  }

  /* ─────────────────────────── sprawdzenie arkusza ───────────────────────
     Arkusz pisze nauczyciel ręcznie, więc literówka jest kwestią czasu.
     Lepiej, żeby wyszła przy pierwszym wczytaniu u nauczyciela, z nazwą
     zadania, niż żeby w połowie sprawdzianu jedno pole nadpisywało drugie. */
  function sprawdzArkusz(a) {
    const bledy = [];
    if (!a || typeof a !== "object" || Array.isArray(a)) return ["plik nie zawiera arkusza"];
    if (a.format !== FORMAT) return ["to nie jest arkusz sprawdzianu"];
    if (typeof a.wersja === "number" && a.wersja > WERSJA) {
      return ["arkusz jest w nowszym formacie niż ta strona — odśwież stronę klawiszami Ctrl + F5"];
    }
    if (!a.id) bledy.push("brak identyfikatora arkusza (pole „id”)");
    if (!a.tytul) bledy.push("brak tytułu (pole „tytul”)");
    if (!Array.isArray(a.zadania) || !a.zadania.length) {
      bledy.push("arkusz nie ma żadnego zadania");
      return bledy;
    }
    const kody = new Set(poziomy(a).map((p) => p.kod));
    const zajete = new Set();
    a.zadania.forEach((z, i) => {
      const gdzieZ = `zadanie ${z.nr ?? i + 1}`;
      if (z.nr == null) bledy.push(`${gdzieZ}: brak numeru („nr”)`);
      if (!Array.isArray(z.polecenia) || !z.polecenia.length) {
        bledy.push(`${gdzieZ}: brak poleceń`);
        return;
      }
      z.polecenia.forEach((p, j) => {
        const gdzie = `polecenie ${z.nr ?? i + 1}${p.nr ?? "#" + (j + 1)}`;
        if (p.poziom && !kody.has(p.poziom)) bledy.push(`${gdzie}: nieznany poziom „${p.poziom}”`);
        if (!Array.isArray(p.pola) || !p.pola.length) {
          bledy.push(`${gdzie}: brak pól na odpowiedź`);
          return;
        }
        p.pola.forEach((pole) => {
          const typ = pole.typ || "tekst";
          if (!TYPY_POL.includes(typ)) bledy.push(`${gdzie}: nieznany typ pola „${typ}”`);
          if (typ === "tabela" && (!Array.isArray(pole.wiersze) || !pole.wiersze.length)) {
            bledy.push(`${gdzie}: tabela bez wierszy`);
          }
          if (typ === "wybor" && (!Array.isArray(pole.opcje) || pole.opcje.length < 2)) {
            bledy.push(`${gdzie}: pole wyboru potrzebuje co najmniej dwóch opcji`);
          }
          for (const id of idPol({ ...pole, typ })) {
            if (!id) { bledy.push(`${gdzie}: pole bez identyfikatora`); continue; }
            if (String(id).startsWith("_")) bledy.push(`${gdzie}: identyfikator „${id}” jest zarezerwowany`);
            if (zajete.has(id)) bledy.push(`${gdzie}: identyfikator „${id}” występuje drugi raz`);
            zajete.add(id);
          }
        });
      });
    });
    return bledy;
  }

  /* ─────────────────────────── magazyn ───────────────────────────
     Jedna praca na komputer, w IndexedDB. Gdy przeglądarka nie pozwala
     zapisywać (tryb prywatny w starszym Firefoksie, zablokowane dane
     witryn), praca trzyma się w pamięci karty — i uczeń jest o tym
     uprzedzony, bo zamknięcie karty ją wtedy kasuje. */
  const BAZA = "sprawdziany", SKLEP = "praca", KLUCZ = "biezaca";
  let pamiec = null;
  let bezZapisu = false;
  let polaczenie = null;
  let gotowaBaza = null;   // to samo połączenie, ale dostępne bez czekania

  function baza() {
    if (polaczenie) return polaczenie;
    polaczenie = new Promise((ok, blad) => {
      let r;
      try { r = indexedDB.open(BAZA, 1); } catch (e) { blad(e); return; }
      r.onupgradeneeded = () => r.result.createObjectStore(SKLEP);
      r.onsuccess = () => { gotowaBaza = r.result; ok(r.result); };
      r.onerror = () => blad(r.error || new Error("brak dostępu do bazy"));
      r.onblocked = () => blad(new Error("baza zablokowana przez inną kartę"));
    });
    polaczenie.catch(() => { bezZapisu = true; });
    return polaczenie;
  }

  async function operacja(tryb, wykonaj) {
    if (bezZapisu) return undefined;
    try {
      const db = await baza();
      return await new Promise((ok, blad) => {
        const tx = db.transaction(SKLEP, tryb);
        const zadanie = wykonaj(tx.objectStore(SKLEP));
        tx.oncomplete = () => ok(zadanie.result);
        tx.onerror = () => blad(tx.error);
        tx.onabort = () => blad(tx.error || new Error("przerwany zapis"));
      });
    } catch (e) {
      bezZapisu = true;
      throw e;
    }
  }

  async function odczytaj() {
    try {
      const w = await operacja("readonly", (s) => s.get(KLUCZ));
      return bezZapisu ? pamiec : (w || null);
    } catch { return pamiec; }
  }
  async function zachowaj(rekord) {
    pamiec = rekord;
    try { await operacja("readwrite", (s) => s.put(rekord, KLUCZ)); return !bezZapisu; }
    catch { return false; }
  }
  /* Zapis przy zamykaniu karty. Zwykły zachowaj() zaczyna transakcję dopiero
     po kilku mikrozadaniach, a wtedy strony często już nie ma — ostatnie
     litery przepadały. Tu transakcja rusza od razu, w samym zdarzeniu. */
  function zachowajOdRazu(rekord) {
    pamiec = rekord;
    if (bezZapisu || !gotowaBaza) return;
    try {
      const tx = gotowaBaza.transaction(SKLEP, "readwrite");
      tx.objectStore(SKLEP).put(rekord, KLUCZ);
      if (tx.commit) tx.commit();
    } catch { /* karta i tak się zamyka */ }
  }
  async function usun() {
    pamiec = null;
    try { await operacja("readwrite", (s) => s.delete(KLUCZ)); } catch { /* nic tu nie było */ }
  }

  /* ─────────────────────────── liczenie ─────────────────────────── */
  const maWartosc = (v) => v != null && String(v).trim() !== "";

  function polecenieZrobione(p, odp) {
    return (p.pola || []).some((pole) => idPol(pole).some((id) => maWartosc(odp[id])));
  }
  function bezOdpowiedzi(a, odp) {
    const lista = [];
    for (const z of a.zadania) {
      for (const p of z.polecenia) if (!polecenieZrobione(p, odp)) lista.push(oznaczenie(z, p));
    }
    return lista;
  }
  const wszystkichPolecen = (a) => a.zadania.reduce((n, z) => n + z.polecenia.length, 0);
  const czyPusta = (r) => !r || (!maWartosc(r.odpowiedzi && r.odpowiedzi._nr) &&
    Object.entries(r.odpowiedzi || {}).every(([k, v]) => k.startsWith("_") || !maWartosc(v)));

  /* ─────────────────────────── widoki ─────────────────────────── */
  function pokazPomoc(widoczna) {
    document.querySelectorAll(".sp-pomoc").forEach((el) => { el.hidden = !widoczna; });
    // W trakcie pracy tytułem strony jest tytuł arkusza — ogólny nagłówek znika.
    document.body.classList.toggle("sp-w-pracy", !widoczna);
  }

  function widokStart(host, komunikat) {
    pokazPomoc(true);
    host.innerHTML = `<div class="sp-start">
      <div class="sp-upusc" tabindex="0">
        <button type="button" class="md-button md-button--primary sp-wczytaj">Wczytaj arkusz</button>
        <span class="sp-upusc-opis">albo przeciągnij tutaj plik arkusza (<code>.json</code>)</span>
        <input type="file" class="sp-plik" accept=".json,application/json" hidden>
      </div>
      <p class="kp-status" role="status" aria-live="polite"></p>
    </div>`;
    const status = host.querySelector(".kp-status");
    if (komunikat) { status.innerHTML = komunikat.html; status.className = "kp-status " + (komunikat.klasa || ""); }
    if (bezZapisu) {
      status.innerHTML = "<strong>Ta przeglądarka nie pozwala zapisywać odpowiedzi.</strong> " +
        "Możesz pisać, ale nie zamykaj karty, dopóki nie pobierzesz dokumentu Word.";
      status.className = "kp-status kp-blad";
    }
    const plik = host.querySelector(".sp-plik");
    const strefa = host.querySelector(".sp-upusc");
    host.querySelector(".sp-wczytaj").addEventListener("click", () => plik.click());
    plik.addEventListener("change", () => {
      const f = plik.files && plik.files[0];
      if (f) wczytajPlikArkusza(host, f, status).finally(() => { plik.value = ""; });
    });
    strefa.addEventListener("dragover", (e) => { e.preventDefault(); strefa.classList.add("kp-nad"); });
    strefa.addEventListener("dragleave", () => strefa.classList.remove("kp-nad"));
    strefa.addEventListener("drop", (e) => {
      e.preventDefault(); strefa.classList.remove("kp-nad");
      const f = e.dataTransfer.files[0];
      if (f) wczytajPlikArkusza(host, f, status);
    });
  }

  function blad(status, html) {
    status.innerHTML = html;
    status.className = "kp-status kp-blad";
  }

  async function wczytajPlikArkusza(host, plik, status) {
    if (plik.size > 2 * 1024 * 1024) {
      blad(status, "Ten plik jest za duży jak na arkusz. Sprawdź, czy wskazujesz właściwy plik od nauczyciela.");
      return;
    }
    let arkusz;
    try { arkusz = JSON.parse(await plik.text()); }
    catch {
      blad(status, `Pliku <strong>${esc(plik.name)}</strong> nie da się odczytać jako arkusza. ` +
        "Pobierz arkusz jeszcze raz — przeglądarka mogła zapisać go niekompletnie.");
      return;
    }
    const bledy = sprawdzArkusz(arkusz);
    if (bledy.length) {
      blad(status, `Plik <strong>${esc(plik.name)}</strong> nie jest poprawnym arkuszem:` +
        `<ul class="sp-bledy">${bledy.slice(0, 8).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` +
        (bledy.length > 8 ? `<span>…i jeszcze ${bledy.length - 8}.</span>` : ""));
      return;
    }
    const teraz = new Date().toISOString();
    const rekord = {
      arkusz, odpowiedzi: { _klasa: arkusz.klasa || "" },
      rozpoczeto: teraz, zapisano: teraz, pobrano: null,
    };
    await zachowaj(rekord);
    widokPraca(host, rekord);
  }

  /* Na komputerze zastaliśmy pracę. Uczeń sam mówi, czy jest jego. */
  function widokCudza(host, rekord) {
    pokazPomoc(false);
    const a = rekord.arkusz, odp = rekord.odpowiedzi || {};
    const nr = maWartosc(odp._nr) ? `numer w dzienniku <strong>${esc(odp._nr)}</strong>` : "bez wpisanego numeru";
    const zrobione = wszystkichPolecen(a) - bezOdpowiedzi(a, odp).length;
    const pobrana = rekord.pobrano
      ? `<p><strong>Dokument Word z tej pracy został już pobrany ${esc(kiedy(rekord.pobrano))}.</strong></p>` : "";
    host.innerHTML = `<div class="admonition warning sp-cudza">
      <p class="admonition-title">Na tym komputerze jest rozpoczęta praca</p>
      <p><strong>${esc(a.tytul)}</strong>${a.grupa ? ` · grupa ${esc(a.grupa)}` : ""} · ${nr} ·
        odpowiedzi na ${zrobione} z ${wszystkichPolecen(a)} poleceń · ostatnia zmiana ${esc(kiedy(rekord.zapisano))}.</p>
      ${pobrana}
      <p>Jeżeli to <strong>twoja</strong> praca — na przykład przeglądarka się zamknęła — wróć do niej.
        Jeżeli nie — zacznij od nowa. Tamte odpowiedzi zostaną wtedy usunięte z tego komputera.</p>
      <div class="sp-przyciski">
        <button type="button" class="md-button ${rekord.pobrano ? "" : "md-button--primary"} sp-moja">To moja praca — wracam do niej</button>
        <button type="button" class="md-button ${rekord.pobrano ? "md-button--primary" : ""} sp-nie-moja">To nie moja — zaczynam od nowa</button>
      </div></div>`;
    host.querySelector(".sp-moja").addEventListener("click", () => widokPraca(host, rekord));
    host.querySelector(".sp-nie-moja").addEventListener("click", async () => {
      await usun();
      widokStart(host, { html: "Poprzednia praca została usunięta z tego komputera. Wczytaj swój arkusz." });
    });
  }

  /* ─────────────────────────── pola ─────────────────────────── */
  function poleTekst(p, wart) {
    return `<label class="kp-pole">
      ${p.pytanie ? `<span class="kp-pytanie">${esc(p.pytanie)}</span>` : ""}
      <textarea data-pole="${esc(p.id)}" rows="${p.wiersze || 3}" spellcheck="${p.mono ? "false" : "true"}"
        class="${p.mono ? "sp-mono" : ""}" placeholder="${esc(p.podpowiedz || "")}">${esc(wart || "")}</textarea>
    </label>`;
  }

  function poleTabela(p, odp) {
    const w = p.wiersze.map(([id, etykieta, podp]) => `<tr>
      <th scope="row">${esc(etykieta)}</th>
      <td><input type="text" data-pole="${esc(id)}" value="${esc(odp[id] || "")}"
          class="${p.mono ? "sp-mono" : ""}" spellcheck="${p.mono ? "false" : "true"}"
          placeholder="${esc(podp || "")}"></td></tr>`).join("");
    return `${p.pytanie ? `<span class="kp-pytanie">${esc(p.pytanie)}</span>` : ""}
      <table class="kp-tabela"><tbody>${w}</tbody></table>`;
  }

  function poleWybor(p, wart) {
    const o = p.opcje.map((op) => `<label class="kp-radio">
      <input type="radio" name="${esc(p.id)}" data-pole="${esc(p.id)}"
        value="${esc(op)}" ${wart === op ? "checked" : ""}> ${esc(op)}</label>`).join("");
    return `<div class="kp-pole">
      ${p.pytanie ? `<span class="kp-pytanie">${esc(p.pytanie)}</span>` : ""}
      <div class="kp-radiogrupa">${o}</div></div>`;
  }

  function poleZrzut(p, wart) {
    return `<div class="kp-zrzut" data-pole="${esc(p.id)}" tabindex="0">
      <div class="kp-zrzut-pusty" ${wart ? "hidden" : ""}>
        <strong>Kliknij i wklej zrzut ekranu</strong>
        <span>${esc(p.opis || "")}</span>
        <span class="kp-zrzut-jak">zrób go skrótem Win + Shift + S, wklej przez Ctrl + V —
          albo <button type="button" class="kp-wybierz">wybierz plik</button></span>
        <input type="file" accept="image/*" hidden>
      </div>
      <figure class="kp-zrzut-podglad" ${wart ? "" : "hidden"}>
        <img src="${wart || ""}" alt="Wklejony zrzut ekranu">
        <button type="button" class="kp-usun-zrzut">Usuń zrzut</button>
      </figure></div>`;
  }

  function pole(p, odp) {
    const typ = p.typ || "tekst";
    if (typ === "tabela") return poleTabela(p, odp);
    if (typ === "zrzut") return poleZrzut(p, odp[p.id]);
    if (typ === "wybor") return poleWybor(p, odp[p.id]);
    return poleTekst(p, odp[p.id]);
  }

  function opisPoziomu(a, kod) {
    const p = poziomy(a).find((x) => x.kod === kod);
    return p ? `${p.opis}${p.ocena ? " — ocena " + p.ocena : ""}` : "";
  }

  function renderPraca(host, a, odp) {
    const legenda = maPoziomy(a) ? `<div class="admonition info sp-zasady">
        <p class="admonition-title">Jak liczy się ocena</p>
        <table class="sp-legenda"><tbody>${poziomy(a).map((p) => `<tr>
          <td><span class="sp-poziom">${esc(p.kod)}</span></td><td>${esc(p.opis)}</td>
          <td>${p.ocena ? "ocena " + esc(p.ocena) : ""}</td></tr>`).join("")}</tbody></table>
        <p>${oczysc(a.regula || REGULA_DOMYSLNA)}</p>
      </div>` : "";
    const zasady = Array.isArray(a.zasady) && a.zasady.length ? `<div class="admonition note sp-zasady">
        <p class="admonition-title">Zanim zaczniesz</p>
        <ul>${a.zasady.map((z) => `<li>${oczysc(z)}</li>`).join("")}</ul></div>` : "";

    const zadania = a.zadania.map((z) => {
      const polecenia = z.polecenia.map((p) => `<div class="sp-polecenie" id="polecenie-${esc(oznaczenie(z, p))}"
          data-polecenie="${esc(oznaczenie(z, p))}">
        ${p.przed ? `<div class="sp-przed">${oczysc(p.przed)}</div>` : ""}
        <p class="sp-tresc"><span class="sp-nr">${esc(oznaczenie(z, p))}</span>
          ${p.poziom ? `<span class="sp-poziom${p.kluczowe ? " sp-kluczowe" : ""}"
            title="${esc(opisPoziomu(a, p.poziom))}${p.kluczowe ? " · polecenie kluczowe" : ""}">${esc(znacznik(p))}</span>` : ""}
          <span>${oczysc(p.tresc)}</span></p>
        ${p.pola.map((x) => pole(x, odp)).join("")}
      </div>`).join("");
      return `<section class="kp-zadanie sp-zadanie" id="zadanie-${esc(z.nr)}">
        <h3>Zadanie ${esc(z.nr)}. ${esc(z.tytul || "")}</h3>
        ${z.wstep ? `<p class="kp-polecenie">${oczysc(z.wstep)}</p>` : ""}
        ${polecenia}</section>`;
    }).join("");

    host.innerHTML = `<div class="kp sp">
      <div class="sp-tytul">
        <p class="sp-przedmiot">${esc([a.przedmiot, a.klasa && "klasa " + a.klasa].filter(Boolean).join(" · "))}</p>
        <h2>${esc(a.tytul)}</h2>
        ${a.grupa ? `<p class="sp-grupa">Grupa <strong>${esc(a.grupa)}</strong></p>` : ""}
      </div>
      ${zasady}${legenda}
      <div class="kp-naglowek">
        <table class="kp-tabela"><tbody>
          <tr><th scope="row">Numer w dzienniku</th>
            <td><input type="text" data-pole="_nr" inputmode="numeric" autocomplete="off"
                value="${esc(odp._nr || "")}" placeholder="np. 12"></td></tr>
          <tr><th scope="row">Klasa</th>
            <td><input type="text" data-pole="_klasa" value="${esc(odp._klasa || a.klasa || "")}"></td></tr>
        </tbody></table>
      </div>
      ${zadania}
      <div class="kp-stopka">
        <p class="sp-postep" aria-live="polite"></p>
        <button type="button" class="kp-generuj md-button md-button--primary">Pobierz jako dokument Word</button>
        <span class="kp-luka" aria-hidden="true"></span>
        <button type="button" class="sp-zakoncz md-button">Zakończ i usuń odpowiedzi z tego komputera</button>
        <p class="kp-status" role="status" aria-live="polite"></p>
        <p class="sp-zapis" aria-live="off"></p>
      </div></div>`;
  }

  /* ─────────────────────────── praca ─────────────────────────── */
  function widokPraca(host, rekord) {
    pokazPomoc(false);
    const a = rekord.arkusz;
    const odp = rekord.odpowiedzi = rekord.odpowiedzi || {};
    renderPraca(host, a, odp);
    const status = host.querySelector(".kp-status");
    const zapisInfo = host.querySelector(".sp-zapis");
    const postep = host.querySelector(".sp-postep");

    const odswiezPostep = () => {
      const brak = bezOdpowiedzi(a, odp);
      const wszystkie = wszystkichPolecen(a);
      postep.textContent = `Odpowiedzi na ${wszystkie - brak.length} z ${wszystkie} poleceń.`;
      host.querySelectorAll(".sp-polecenie").forEach((el) => {
        el.classList.toggle("sp-zrobione", !brak.includes(el.dataset.polecenie));
      });
    };
    odswiezPostep();

    const pokazZapis = (ok) => {
      if (ok) {
        zapisInfo.textContent = "Odpowiedzi zapisują się na tym komputerze na bieżąco · ostatni zapis " +
          new Date().toLocaleTimeString("pl-PL");
        zapisInfo.className = "sp-zapis";
      } else {
        zapisInfo.textContent = "Uwaga: przeglądarka nie zapisuje odpowiedzi. Nie zamykaj karty, " +
          "dopóki nie pobierzesz dokumentu Word.";
        zapisInfo.className = "sp-zapis kp-blad";
      }
    };
    pokazZapis(!bezZapisu);

    let czasomierz = null;
    const zapiszTeraz = async () => {
      clearTimeout(czasomierz); czasomierz = null;
      rekord.zapisano = new Date().toISOString();
      pokazZapis(await zachowaj(rekord));
    };
    const zaplanuj = () => { clearTimeout(czasomierz); czasomierz = setTimeout(zapiszTeraz, 350); };
    const zapiszPole = (klucz, wart, odRazu) => {
      odp[klucz] = wart;
      odswiezPostep();
      if (odRazu) zapiszTeraz(); else zaplanuj();
    };
    // Zamknięcie karty w trakcie odliczania nie może zgubić ostatnich liter.
    const przyWyjsciu = () => {
      if (!czasomierz) return;
      clearTimeout(czasomierz); czasomierz = null;
      rekord.zapisano = new Date().toISOString();
      zachowajOdRazu(rekord);
    };
    window.addEventListener("pagehide", przyWyjsciu);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") przyWyjsciu();
    });

    host.addEventListener("input", (e) => {
      const p = e.target.dataset.pole;
      if (p && e.target.type !== "file" && e.target.type !== "radio") zapiszPole(p, e.target.value);
    });
    host.addEventListener("change", (e) => {
      const p = e.target.dataset.pole;
      if (p && e.target.type === "radio") zapiszPole(p, e.target.value, true);
      if (e.target.type === "file" && e.target.files[0]) {
        const strefa = e.target.closest(".kp-zrzut");
        if (strefa) wczytajObraz(e.target.files[0], strefa, zapiszPole);
        e.target.value = "";
      }
    });

    host.querySelectorAll(".kp-zrzut").forEach((strefa) => {
      strefa.addEventListener("paste", (e) => {
        const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
        if (!it) return;
        e.preventDefault();
        wczytajObraz(it.getAsFile(), strefa, zapiszPole);
      });
      strefa.addEventListener("click", (e) => {
        if (e.target.closest(".kp-usun-zrzut")) {
          zapiszPole(strefa.dataset.pole, "", true);
          strefa.querySelector(".kp-zrzut-podglad").hidden = true;
          strefa.querySelector(".kp-zrzut-pusty").hidden = false;
        } else if (e.target.closest(".kp-wybierz")) {
          strefa.querySelector('input[type="file"]').click();
        } else { strefa.focus(); }
      });
      strefa.addEventListener("dragover", (e) => { e.preventDefault(); strefa.classList.add("kp-nad"); });
      strefa.addEventListener("dragleave", () => strefa.classList.remove("kp-nad"));
      strefa.addEventListener("drop", (e) => {
        e.preventDefault(); strefa.classList.remove("kp-nad");
        const f = e.dataTransfer.files[0];
        if (f && f.type.startsWith("image/")) wczytajObraz(f, strefa, zapiszPole);
      });
    });

    host.querySelector(".kp-generuj").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (!maWartosc(odp._nr)) {
        blad(status, "Wpisz najpierw numer w dzienniku — bez niego plik nie będzie miał właściwej nazwy.");
        host.querySelector('[data-pole="_nr"]').focus();
        return;
      }
      btn.disabled = true;
      status.textContent = typeof docx === "undefined"
        ? "Pobieram moduł tworzący dokumenty…" : "Składam dokument…";
      status.className = "kp-status";
      try {
        await zapiszTeraz();
        const nazwa = await generuj(rekord);
        rekord.pobrano = new Date().toISOString();
        await zapiszTeraz();
        const brak = bezOdpowiedzi(a, odp);
        status.innerHTML = `Pobrano plik <strong>${esc(nazwa)}</strong>. Dołącz go w dzienniku VULCAN ` +
          "(Zadania domowe), a gdy już wyślesz — kliknij <strong>Zakończ i usuń odpowiedzi</strong>." +
          (brak.length ? `<br><span class="sp-brak">Bez odpowiedzi: ${esc(brak.join(", "))}. ` +
            "Jeżeli to przeoczenie, uzupełnij i pobierz plik jeszcze raz.</span>" : "");
        status.className = "kp-status kp-ok";
        host.querySelector(".sp-zakoncz").classList.add("sp-po-pobraniu");
      } catch (err) {
        blad(status, "Nie udało się utworzyć dokumentu (" + esc(err.message) + "). " +
          "Twoje odpowiedzi są zapisane — zawołaj nauczyciela.");
      } finally { btn.disabled = false; }
    });

    /* Usunięcie pracy — bez okienka potwierdzenia, ale na dwa kliknięcia:
       pierwsze zamienia napis na pytanie, drugie w ciągu kilku sekund usuwa. */
    const zakoncz = host.querySelector(".sp-zakoncz");
    let uzbrojony = null;
    zakoncz.addEventListener("click", async () => {
      if (!uzbrojony) {
        zakoncz.textContent = rekord.pobrano
          ? "Plik wysłany? Kliknij jeszcze raz, żeby usunąć odpowiedzi"
          : "Nie pobrano jeszcze dokumentu! Kliknij jeszcze raz, żeby mimo to usunąć";
        zakoncz.classList.add("sp-uzbrojony");
        uzbrojony = setTimeout(() => {
          uzbrojony = null;
          zakoncz.textContent = "Zakończ i usuń odpowiedzi z tego komputera";
          zakoncz.classList.remove("sp-uzbrojony");
        }, 6000);
        return;
      }
      clearTimeout(uzbrojony); uzbrojony = null;
      clearTimeout(czasomierz); czasomierz = null;
      window.removeEventListener("pagehide", przyWyjsciu);
      await usun();
      window.scrollTo(0, 0);
      widokStart(host, { html: "<strong>Gotowe.</strong> Twoje odpowiedzi zostały usunięte z tego komputera.",
                         klasa: "kp-ok" });
    });
  }

  /* ─────────────────────────── zrzuty ekranu ───────────────────────────
     Zrzut skalujemy do MAX_PX i zapisujemy jako JPEG — tekst w oknie konsoli
     zostaje czytelny, a dokument Word nie puchnie do kilkunastu megabajtów. */
  const MAX_PX = 1600;
  const JAKOSC = 0.82;

  function zmniejsz(dataUrl) {
    return new Promise((gotowe) => {
      const i = new Image();
      i.onload = () => {
        const skala = Math.min(1, MAX_PX / Math.max(i.naturalWidth, i.naturalHeight));
        if (skala === 1 && dataUrl.length < 300 * 1024) return gotowe(dataUrl);
        const c = document.createElement("canvas");
        c.width = Math.round(i.naturalWidth * skala);
        c.height = Math.round(i.naturalHeight * skala);
        const x = c.getContext("2d");
        x.fillStyle = "#ffffff";
        x.fillRect(0, 0, c.width, c.height);
        x.drawImage(i, 0, 0, c.width, c.height);
        try {
          const maly = c.toDataURL("image/jpeg", JAKOSC);
          gotowe(maly.length < dataUrl.length ? maly : dataUrl);
        } catch { gotowe(dataUrl); }
      };
      i.onerror = () => gotowe(dataUrl);
      i.src = dataUrl;
    });
  }

  function wczytajObraz(plik, strefa, zapiszPole) {
    if (!plik) return;
    if (plik.size > 12 * 1024 * 1024) {
      alert("Ten obraz ma ponad 12 MB. Zrób zrzut samego okna zamiast całego pulpitu.");
      return;
    }
    const r = new FileReader();
    r.onload = async () => {
      const obraz = await zmniejsz(r.result);
      zapiszPole(strefa.dataset.pole, obraz, true);
      const fig = strefa.querySelector(".kp-zrzut-podglad");
      fig.querySelector("img").src = obraz;
      fig.hidden = false;
      strefa.querySelector(".kp-zrzut-pusty").hidden = true;
    };
    r.readAsDataURL(plik);
  }

  const rozmiar = (dataUrl) => new Promise((res) => {
    const i = new Image();
    i.onload = () => {
      const maxW = 600, s = Math.min(1, maxW / i.naturalWidth);
      res({ width: Math.round(i.naturalWidth * s), height: Math.round(i.naturalHeight * s) });
    };
    i.onerror = () => res({ width: 400, height: 300 });
    i.src = dataUrl;
  });

  /* ─────────────────────────── ukryte pola ───────────────────────────
     Właściwości niestandardowe dokumentu Word (Plik → Informacje →
     Właściwości) — te same nazwy co w karcie pracy z serwisów z materiałami
     (karta.js). Czyta je panel „Kontrola kart pracy” i skrypt
     sprawdz_karty.py nauczyciela. Tylko klasa, numer i temat — bez nazwisk.
     Grupy A i B jednej pracy klasowej mają w panelu wspólny temat
     („karta_id”); do sprawdzania kluczem służy „arkusz_id” danej grupy. */
  function wspolneId(a) {
    if (a.sprawdzian) return String(a.sprawdzian);
    const id = String(a.id || "");
    return a.grupa ? id.replace(new RegExp(`[-_]${String(a.grupa).replace(/[^\w]/g, "")}$`, "i"), "") : id;
  }
  function ukrytePola(a, odp) {
    const ids = [];
    a.zadania.forEach((z) => (z.polecenia || []).forEach((p) => (p.pola || []).forEach((pole) =>
      idPol({ ...pole, typ: pole.typ || "tekst" }).forEach((id) => id && ids.push(id)))));
    const wyp = ids.filter((id) => maWartosc(odp[id])).length;
    const tekstOdp = ids.slice().sort().filter((id) => maWartosc(odp[id]))
      .map((id) => `${id}=${String(odp[id]).trim().toLowerCase().replace(/\s+/g, " ")}`).join("\n");
    let skrot = 0x811c9dc5;
    for (let i = 0; i < tekstOdp.length; i++) { skrot ^= tekstOdp.charCodeAt(i); skrot = Math.imul(skrot, 0x01000193) >>> 0; }
    const kopia = Object.fromEntries(ids.filter((id) => maWartosc(odp[id])).map((id) => {
      const w = String(odp[id]);
      return [id, w.startsWith("data:image/") ? "[zrzut]" : w];
    }));
    return [
      ["pceikz_format", "sprawdzian-1"],
      ["karta_id", wspolneId(a)],
      ["arkusz_id", a.id || ""],
      ["grupa", a.grupa || ""],
      ["karta_sufiks", String(a.plik || "").toUpperCase()],
      ["karta_tytul", `${a.rodzaj || "Sprawdzian"}: ${a.tytul || ""}`],
      ["serwis", (location.pathname.split("/").filter(Boolean)[0]) || location.hostname],
      ["klasa", odp._klasa || a.klasa || ""],
      ["numer", odp._nr || ""],
      ["wygenerowano", new Date().toISOString()],
      ["wypelnione", String(wyp)],
      ["wszystkie", String(ids.length)],
      ["odpowiedzi_skrot", tekstOdp ? skrot.toString(16) : ""],
      ["odpowiedzi_json", JSON.stringify(kopia)],
    ].map(([name, value]) => ({ name, value: String(value) || "-" }));
  }

  /* ─────────────────────────── dokument Word ─────────────────────────── */
  async function generuj(rekord) {
    await zaladujDocx();
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
            ImageRun, AlignmentType, BorderStyle, HeadingLevel, Footer, PageNumber } = docx;
    const a = rekord.arkusz, odp = rekord.odpowiedzi;

    const W = 9638, ACCENT = "991B1B", SZARY = "7F7F7F";
    const T = (t, o = {}) => new TextRun({ text: String(t ?? ""), bold: o.bold,
      italics: o.italics, size: o.size ?? 21, color: o.color,
      font: o.mono ? "Consolas" : "Calibri" });
    const P = (t, o = {}) => new Paragraph({ alignment: o.align,
      indent: o.indent ? { left: o.indent } : undefined,
      spacing: { before: o.before ?? 0, after: o.after ?? 100, line: 264 },
      children: Array.isArray(t) ? t : [T(t, o)] });
    const kawalki = (html, o = {}) => naKawalki(html).map((k) => (k.br
      ? new TextRun({ break: 1 })
      : new TextRun({ text: k.t, bold: k.bold || o.bold, italics: k.italics || o.italics,
          underline: k.underline ? {} : undefined, subScript: k.sub, superScript: k.sup,
          font: k.mono ? "Consolas" : "Calibri", size: o.size ?? 20, color: o.color })));
    const komorka = (dzieci, szer, fill) => new TableCell({
      width: { size: szer, type: WidthType.DXA },
      shading: fill ? { type: "clear", fill, color: "auto" } : undefined,
      margins: { top: 70, bottom: 70, left: 110, right: 110 }, children: dzieci });
    const wiersz2 = (etk, wart, fill, mono) => new TableRow({ children: [
      komorka([P(etk, { bold: true, size: 20, after: 0 })], 3400, fill),
      komorka([P(maWartosc(wart) ? wart : "—", { size: 20, after: 0, mono })], W - 3400, fill)] });

    const dzieci = [];
    dzieci.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 },
      children: [T([a.przedmiot, a.klasa && "klasa " + a.klasa].filter(Boolean).join(" · "),
        { size: 19, color: SZARY })] }));
    dzieci.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 60 },
      children: [T((a.rodzaj || "Sprawdzian").toUpperCase(), { bold: true, size: 30, color: ACCENT })] }));
    dzieci.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 6 } },
      children: [T(a.tytul, { size: 24 })] }));

    const teraz = new Date().toISOString();
    const naglowek = [
      wiersz2("Numer w dzienniku", odp._nr),
      wiersz2("Klasa", odp._klasa || a.klasa, "F2F2F2"),
    ];
    if (a.grupa) naglowek.push(wiersz2("Grupa", a.grupa));
    naglowek.push(wiersz2("Rozpoczęto", dataGodzina(rekord.rozpoczeto), a.grupa ? "F2F2F2" : null));
    naglowek.push(wiersz2("Plik utworzony", dataGodzina(teraz), a.grupa ? null : "F2F2F2"));
    dzieci.push(new Table({ columnWidths: [3400, W - 3400], width: { size: W, type: WidthType.DXA },
      rows: naglowek }));

    for (const z of a.zadania) {
      dzieci.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 360, after: 80 },
        keepNext: true,
        children: [T(`Zadanie ${z.nr}. ${z.tytul || ""}`, { bold: true, size: 25, color: ACCENT })] }));
      if (z.wstep) dzieci.push(new Paragraph({ spacing: { after: 120 }, children: kawalki(z.wstep) }));

      for (const p of z.polecenia) {
        if (p.przed) {
          dzieci.push(new Paragraph({ spacing: { before: 120, after: 80 }, indent: { left: 280 },
            children: kawalki(p.przed, { italics: true, color: "404040" }) }));
        }
        dzieci.push(new Paragraph({ spacing: { before: 200, after: 90 }, keepNext: true,
          children: [
            T(oznaczenie(z, p) + (p.poziom ? "  ·  " + znacznik(p) : "") + "   ",
              { bold: true, size: 20, color: ACCENT }),
            ...kawalki(p.tresc, { color: "404040" }),
          ] }));

        for (const x of p.pola) {
          const typ = x.typ || "tekst";
          if (typ === "tabela") {
            if (x.pytanie) dzieci.push(P(x.pytanie, { bold: true, size: 20, before: 60, after: 60 }));
            dzieci.push(new Table({ columnWidths: [3400, W - 3400], width: { size: W, type: WidthType.DXA },
              rows: x.wiersze.map(([id, et], i) => wiersz2(et, odp[id], i % 2 ? "F2F2F2" : null, x.mono)) }));
            dzieci.push(P("", { after: 60 }));
          } else if (typ === "zrzut") {
            const d = odp[x.id];
            if (d && d.startsWith("data:image")) {
              const [nag, b64] = d.split(",");
              const bin = atob(b64);
              const bajty = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bajty[i] = bin.charCodeAt(i);
              const wym = await rozmiar(d);
              dzieci.push(new Paragraph({ spacing: { after: 160 }, children: [
                new ImageRun({ type: /png/.test(nag) ? "png" : "jpg", data: bajty, transformation: wym })] }));
            } else {
              dzieci.push(P(`[brak zrzutu ekranu: ${x.opis || x.id}]`,
                { italics: true, color: "C00000", size: 19, after: 120 }));
            }
          } else {
            if (x.pytanie) dzieci.push(P(x.pytanie, { bold: true, size: 20, before: 60, after: 60 }));
            const tresc = String(odp[x.id] || "").trim();
            if (tresc) {
              tresc.split(/\n/).forEach((l) => dzieci.push(P(l, { size: 21, after: 40, mono: x.mono })));
              dzieci.push(P("", { after: 60 }));
            } else {
              dzieci.push(P("[brak odpowiedzi]", { italics: true, color: "C00000", size: 19, after: 120 }));
            }
          }
        }
      }
    }

    /* Karta oceny na końcu dokumentu — nauczyciel zaznacza w niej spełnione
       polecenia wprost w pliku ucznia i odsyła go z oceną. */
    if (maPoziomy(a)) {
      dzieci.push(new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: true,
        spacing: { after: 80 },
        children: [T("Ocena — wypełnia nauczyciel", { bold: true, size: 25, color: ACCENT })] }));
      dzieci.push(P("Wpisz „+” przy spełnionym poleceniu. ★ — polecenie kluczowe: tolerancja go nie obejmuje.",
        { size: 18, color: SZARY, after: 140 }));
      const kol = [1300, 1300, 1700, 5338];
      const naglowekKarty = new TableRow({ tableHeader: true, children:
        ["Polecenie", "Poziom", "Kryterium", "Spełnione / uwagi"].map((t, i) =>
          komorka([P(t, { bold: true, size: 19, after: 0, color: "FFFFFF" })], kol[i], ACCENT)) });
      const wiersze = [naglowekKarty];
      for (const poz of poziomy(a)) {
        const naPoziomie = [];
        for (const z of a.zadania) for (const p of z.polecenia) if (p.poziom === poz.kod) naPoziomie.push([z, p]);
        if (!naPoziomie.length) continue;
        // Wiersz z nazwą poziomu ma jedną komórkę na całą szerokość tabeli.
        wiersze.push(new TableRow({ children: [new TableCell({
          columnSpan: kol.length, width: { size: W, type: WidthType.DXA },
          shading: { type: "clear", fill: "F2F2F2", color: "auto" },
          margins: { top: 70, bottom: 70, left: 110, right: 110 },
          children: [P(`${poz.kod} — ${poz.opis}` + (poz.ocena ? ` (ocena ${poz.ocena})` : ""),
            { bold: true, size: 19, after: 0 })] })] }));
        naPoziomie.forEach(([z, p]) => wiersze.push(new TableRow({ children: [
          komorka([P(oznaczenie(z, p), { size: 19, after: 0 })], kol[0]),
          komorka([P(znacznik(p), { size: 19, after: 0 })], kol[1]),
          komorka([P(p.kryterium || "", { size: 19, after: 0, color: SZARY })], kol[2]),
          komorka([P("", { size: 19, after: 0 })], kol[3]),
        ] })));
      }
      dzieci.push(new Table({ columnWidths: kol, width: { size: W, type: WidthType.DXA }, rows: wiersze }));
      dzieci.push(P("Poziom zaliczony: ………………        Ocena: ………………", { size: 21, before: 240 }));
    }

    const stopkaTekst = [a.rodzaj || "Sprawdzian", odp._klasa || a.klasa,
      "nr " + odp._nr, a.grupa && "grupa " + a.grupa].filter(Boolean).join(" · ");
    const doc = new Document({
      customProperties: ukrytePola(a, odp),
      creator: a.przedmiot || "Sprawdzian", title: `${a.rodzaj || "Sprawdzian"} — ${a.tytul}`,
      styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
      sections: [{
        properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
          children: [new TextRun({ children: [stopkaTekst + "  ·  s. ", PageNumber.CURRENT, " z ",
            PageNumber.TOTAL_PAGES], font: "Calibri", size: 16, color: SZARY })] })] }) },
        children: dzieci,
      }],
    });

    const blob = await Packer.toBlob(doc);
    const bezOgonkow = (s) => String(s)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l").replace(/Ł/g, "L")
      .replace(/[^\w-]/g, "");
    const nr = bezOgonkow(odp._nr) || "brak-numeru";
    const nazwa = `nr${nr}-${bezOgonkow(a.plik || a.id) || "sprawdzian"}.docx`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = nazwa; document.body.appendChild(link); link.click();
    link.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    return nazwa;
  }

  /* ─────────────────────────── start ─────────────────────────── */
  async function start() {
    const host = document.getElementById("sprawdzian");
    if (!host || host.dataset.gotowe) return;
    host.dataset.gotowe = "1";
    let rekord = null;
    try { await baza(); } catch { /* bezZapisu ustawione — pracujemy w pamięci */ }
    rekord = await odczytaj();

    if (rekord && (!rekord.arkusz || sprawdzArkusz(rekord.arkusz).length)) {
      await usun();
      rekord = null;
    }
    if (rekord && czyPusta(rekord)) {
      await usun();
      rekord = null;
    }
    if (rekord) {
      const wiek = (Date.now() - new Date(rekord.zapisano).getTime()) / 36e5;
      if (!(wiek < WAZNOSC_GODZ)) {
        const opis = dataGodzina(rekord.zapisano);
        await usun();
        widokStart(host, { html: `Usunięto pracę pozostawioną na tym komputerze (ostatnia zmiana ${esc(opis)}).` });
        return;
      }
      widokCudza(host, rekord);
      return;
    }
    widokStart(host);
  }

  // Na potrzeby testów i narzędzi nauczyciela — te same reguły co na stronie.
  window.Sprawdzian = { FORMAT, WERSJA, sprawdzArkusz, oczysc };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
