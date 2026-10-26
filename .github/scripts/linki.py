#!/usr/bin/env python3
"""Sprawdzanie linków zewnętrznych na stronach serwisu.

    python .github/scripts/linki.py            # wszystkie strony w docs/
    python .github/scripts/linki.py --plik docs/dzial-3/operatory.md

Zbiera adresy http(s) ze stron Markdown (linki [tekst](adres), <adres>,
href="…", src="…" i gołe adresy w tekście), pomija bloki kodu i kod
w tekście (tam są przykłady w rodzaju http://localhost/…), i sprawdza każdy
adres raz, nawet gdy występuje na wielu stronach.

Wynik:
  ZEPSUTY       — 404/410, nieznana domena, odmowa połączenia → błąd (czerwony przebieg)
  DO SPRAWDZENIA — 401/403/429/5xx, przekroczony czas, błąd certyfikatu → ostrzeżenie;
                   część serwisów odrzuca automaty, a w przeglądarce działa
  przekierowanie na inny adres → informacja (warto podmienić link)

Na GitHubie: adnotacje przy plikach i tabela w podsumowaniu przebiegu.
Uruchamia to .github/workflows/linki.yml raz w tygodniu — nie blokuje commitów.
Adresy, których nie sprawdzamy: POMIJANE niżej.
"""
import concurrent.futures as cf
import os
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

POMIJANE = re.compile(
    r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|192\.168\.|10\.|example\.(com|org|net)|"
    r"[^/]*\.example\b|[^/]*\.test\b|[^/]*\.local\b|szprycha\b|"
    r"[^/]*[A-Z]{2,}_[A-Z]|"          # zaślepki w rodzaju http://IP_SERWERA/…
    r"bit\.ly/xyz\b)")               # przykład fałszywego SMS-a (inf-tt, cyberbezpieczeństwo)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36 (sprawdzanie linkow serwisu szkolnego)")
LIMIT_CZASU = 20
WATKI = 8

LINK_MD = re.compile(r"\]\(\s*<?(https?://[^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
LINK_AUTO = re.compile(r"<(https?://[^>\s]+)>")
LINK_ATR = re.compile(r"""(?:href|src)\s*=\s*["'](https?://[^"']+)["']""", re.I)
LINK_GOLY = re.compile(r"(?<![(<\"'=/])\bhttps?://[^\s)<>\]\"'`]+")


def bez_kodu(tekst):
    """Usuwa bloki ``` / ~~~ i kod w tekście, zostawiając liczbę wierszy."""
    wynik, w_bloku, plot = [], False, ""
    for linia in tekst.split("\n"):
        s = linia.strip()
        m = re.match(r"(```+|~~~+)", s)
        if m and (not w_bloku or s.startswith(plot)):
            if w_bloku:
                w_bloku = False
            else:
                w_bloku, plot = True, m.group(1)
            wynik.append("")
            continue
        if w_bloku:
            wynik.append("")
            continue
        wynik.append(re.sub(r"`[^`\n]*`", "", linia))
    return "\n".join(wynik)


def oczysc(url):
    url = html_unescape(url).rstrip(".,;:!?")
    while url.endswith(")") and url.count("(") < url.count(")"):
        url = url[:-1]
    return url


def html_unescape(s):
    return s.replace("&amp;", "&")


def zbierz(pliki):
    """{adres: [(plik, nr wiersza), …]}"""
    adresy = {}
    for p in pliki:
        tekst = bez_kodu(p.read_text(encoding="utf-8", errors="replace"))
        for nr, linia in enumerate(tekst.split("\n"), 1):
            znalezione = set()
            for wz in (LINK_MD, LINK_AUTO, LINK_ATR):
                znalezione.update(oczysc(m.group(1)) for m in wz.finditer(linia))
            # gołe adresy, których nie złapały wzorce wyżej
            reszta = LINK_ATR.sub("", LINK_AUTO.sub("", LINK_MD.sub("", linia)))
            znalezione.update(oczysc(m.group(0)) for m in LINK_GOLY.finditer(reszta))
            for u in znalezione:
                if POMIJANE.match(u) or "{" in u or "$" in u:
                    continue
                adresy.setdefault(u, []).append((p.as_posix(), nr))
    return adresy


def sprawdz(url):
    """(stan, kod lub opis, adres końcowy) — stan: ok / zepsuty / sprawdz"""
    adres = url.split("#")[0]
    ostatni = None
    for proba in range(2):
        for metoda in ("HEAD", "GET"):
            zad = urllib.request.Request(adres, method=metoda, headers={
                "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                "Accept-Language": "pl,en;q=0.8"})
            try:
                with urllib.request.urlopen(zad, timeout=LIMIT_CZASU) as odp:
                    return ("ok", odp.status, odp.geturl())
            except urllib.error.HTTPError as e:
                ostatni = ("http", e.code)
                if e.code in (405, 403, 400, 501) and metoda == "HEAD":
                    continue                    # część serwerów nie lubi HEAD — próba GET
                if e.code in (404, 410):
                    return ("zepsuty", e.code, None)
                break
            except urllib.error.URLError as e:
                powod = e.reason
                if isinstance(powod, socket.gaierror):
                    ostatni = ("zepsuty", "nieznana domena")       # druga próba po 2 s
                elif isinstance(powod, ConnectionRefusedError):
                    ostatni = ("zepsuty", "odmowa połączenia")
                elif isinstance(powod, ssl.SSLError):
                    ostatni = ("inne", f"błąd certyfikatu ({powod.reason or powod})")
                else:
                    ostatni = ("inne", str(powod)[:80])
                break
            except (TimeoutError, socket.timeout):
                ostatni = ("inne", f"brak odpowiedzi w {LIMIT_CZASU} s")
                break
            except Exception as e:              # np. zerwane połączenie
                ostatni = ("inne", type(e).__name__)
                break
        if proba == 0:
            time.sleep(2)
    if ostatni and ostatni[0] == "zepsuty":
        return ("zepsuty", ostatni[1], None)
    return ("sprawdz", ostatni[1] if ostatni else "?", None)


def adnotacja(poziom, plik, linia, tekst):
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::{poziom} file={plik},line={linia}::{tekst}")
    else:
        print(f"{'✗' if poziom == 'error' else '!' if poziom == 'warning' else '·'} {plik}:{linia}  {tekst}")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    if "--plik" in sys.argv:
        pliki = [Path(sys.argv[sys.argv.index("--plik") + 1])]
    else:
        pliki = sorted(Path("docs").rglob("*.md"))
    adresy = zbierz(pliki)
    print(f"Stron: {len(pliki)}, różnych adresów zewnętrznych: {len(adresy)}")

    wyniki = {}
    with cf.ThreadPoolExecutor(WATKI) as ex:
        for url, w in zip(adresy, ex.map(sprawdz, adresy)):
            wyniki[url] = w

    zepsute = [(u, w) for u, w in wyniki.items() if w[0] == "zepsuty"]
    do_spr = [(u, w) for u, w in wyniki.items() if w[0] == "sprawdz"]
    przek = [(u, w) for u, w in wyniki.items()
             if w[0] == "ok" and w[2] and urllib.parse.urlsplit(w[2]).netloc != urllib.parse.urlsplit(u).netloc]

    for u, w in zepsute:
        for plik, nr in adresy[u]:
            adnotacja("error", plik, nr, f"Zepsuty link ({w[1]}): {u}")
    for u, w in do_spr:
        for plik, nr in adresy[u]:
            adnotacja("warning", plik, nr, f"Link do sprawdzenia ręcznie ({w[1]}): {u}")
    for u, w in przek:
        plik, nr = adresy[u][0]
        adnotacja("notice", plik, nr, f"Przekierowanie na inną domenę: {u} → {w[2]}")

    podsumowanie = os.environ.get("GITHUB_STEP_SUMMARY")
    if podsumowanie:
        with open(podsumowanie, "a", encoding="utf-8") as f:
            f.write(f"## Linki zewnętrzne\n\nSprawdzone adresy: **{len(wyniki)}** · "
                    f"zepsute: **{len(zepsute)}** · do sprawdzenia ręcznie: **{len(do_spr)}** · "
                    f"przekierowania na inną domenę: **{len(przek)}**\n\n")
            for tytul, lista in (("Zepsute", zepsute), ("Do sprawdzenia ręcznie", do_spr)):
                if lista:
                    f.write(f"### {tytul}\n\n| Adres | Wynik | Gdzie |\n| --- | --- | --- |\n")
                    for u, w in sorted(lista):
                        gdzie = "<br>".join(f"`{p}:{n}`" for p, n in adresy[u][:5])
                        f.write(f"| {u} | {w[1]} | {gdzie} |\n")
                    f.write("\n")
            if przek:
                f.write("### Przekierowania na inną domenę\n\n| Adres | Prowadzi do |\n| --- | --- |\n")
                for u, w in sorted(przek):
                    f.write(f"| {u} | {w[2]} |\n")

    print(f"\nOK: {len(wyniki) - len(zepsute) - len(do_spr)}, zepsute: {len(zepsute)}, "
          f"do sprawdzenia: {len(do_spr)}, przekierowania: {len(przek)}")
    return 1 if zepsute else 0


if __name__ == "__main__":
    sys.exit(main())
