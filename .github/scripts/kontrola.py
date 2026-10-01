#!/usr/bin/env python3
"""Kontrole repozytorium serwisu MkDocs.

  kontrola.py sekrety          klucze i scenariusze nie mogą być w repozytorium
  kontrola.py struktura        poprawność identyfikatorów w kartach pracy (JSON)
  kontrola.py klucze --base S  nic, co trzyma postęp uczniów, nie zniknęło od commita S

Postęp uczniów siedzi w localStorage pod kluczami zbudowanymi z:
  - id karty i id pól w docs/assets/karty/*.json,
  - tytułów wierszy (pierwsza kolumna) w tabelach .spis-tematow na stronach indeksu
    oraz atrybutu data-postep.
Zmiana któregokolwiek z nich po cichu kasuje uczniom zaznaczenia, więc kontrola
zatrzymuje taką zmianę. Jeśli zmiana jest zamierzona, dopisz do opisu PR albo do
komunikatu commita znacznik  [zmiana-kluczy]  — wtedy kontrola tylko ostrzeże.
"""
import json
import os
import re
import subprocess
import sys

ZNACZNIK = "[zmiana-kluczy]"
KARTY = re.compile(r"^docs/assets/karty/[^/]+\.json$")
ZAKAZANE = [
    (re.compile(r"(^|/)KLUCZ-"), "klucz odpowiedzi (miejsce: _materialy-nauczycielskie/<klasa>)"),
    (re.compile(r"(^|/)Scenariusz-"), "scenariusz lekcji (miejsce: _materialy-nauczycielskie/<klasa>)"),
    (re.compile(r"(^|/)_materialy-nauczycielskie(/|$)"), "folder materiałów nauczyciela"),
]

bledy = []      # zatrzymują zawsze
ostrzezenia = []  # zatrzymują tylko bez znacznika [zmiana-kluczy]


def git(*args, tekst=True):
    r = subprocess.run(["git", *args], capture_output=True)
    if r.returncode != 0:
        return None
    return r.stdout.decode("utf-8") if tekst else r.stdout


def pliki(rewizja):
    out = git("ls-tree", "-r", "--name-only", rewizja)
    return out.splitlines() if out else []


def tresc(rewizja, sciezka):
    return git("show", f"{rewizja}:{sciezka}") or ""


def adnotacja(poziom, plik, tekst):
    print(f"::{poziom} file={plik}::{tekst}" if plik else f"::{poziom}::{tekst}")


# ------------------------------------------------------------------ sekrety
def sekrety():
    znalezione = 0
    for sciezka in (git("ls-files") or "").splitlines():
        for wzorzec, opis in ZAKAZANE:
            if wzorzec.search(sciezka):
                adnotacja("error", sciezka, f"W publicznym repozytorium nie może być: {opis}.")
                znalezione += 1
    if znalezione:
        print(f"\nZnaleziono {znalezione} plik(ów), których nie wolno publikować. "
              "Usuń je z repozytorium (git rm --cached), a historię sprawdź osobno.")
    else:
        print("Kontrola „sekrety”: OK.")
    return znalezione == 0


# ------------------------------------------------------------ karty pracy
def id_pol(karta):
    """Wszystkie identyfikatory pól karty: pola z `id` oraz pierwszy element wiersza tabeli."""
    wynik = []
    for zad in karta.get("zadania", []):
        for pole in zad.get("pola", []):
            if pole.get("typ") == "tabela":
                wynik += [str(w[0]) for w in pole.get("wiersze", []) if w]
            elif "id" in pole:
                wynik.append(str(pole["id"]))
    return wynik


def wczytaj_karty(rewizja):
    karty = {}
    for sciezka in pliki(rewizja):
        if not KARTY.match(sciezka):
            continue
        try:
            d = json.loads(tresc(rewizja, sciezka))
        except ValueError as e:
            bledy.append((sciezka, f"Plik nie jest poprawnym JSON-em: {e}"))
            continue
        if "id" not in d:
            bledy.append((sciezka, "Karta nie ma pola „id”."))
            continue
        if d["id"] in karty:
            bledy.append((sciezka, f"Id karty „{d['id']}” jest już użyte w {karty[d['id']]['plik']}."))
            continue
        karty[d["id"]] = {"plik": sciezka, "pola": id_pol(d), "poprzedni": d.get("idPoprzedni")}
    return karty


def nazwa_repo():
    return (os.environ.get("GITHUB_REPOSITORY") or os.path.basename(os.getcwd())).split("/")[-1]


def struktura():
    karty = wczytaj_karty("HEAD")
    przedrostek = nazwa_repo() + "-"
    for id_, k in karty.items():
        if not id_.startswith(przedrostek):
            bledy.append((k["plik"], f"Id karty „{id_}” powinno zaczynać się od „{przedrostek}” — "
                          "serwisy dzielą jeden localStorage, więc nazwy ogólne się zderzają."))
        powtorzone = sorted({p for p in k["pola"] if k["pola"].count(p) > 1})
        if powtorzone:
            bledy.append((k["plik"], "Powtórzone id pól w jednej karcie: " + ", ".join(powtorzone)))


# ---------------------------------------------------------- strony indeksu
def czysty(komorka):
    s = re.sub(r":[A-Za-z0-9_-]+:(\{[^}]*\})?", "", komorka)
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"[*`]", "", s)
    return s.strip()[:60]


def spisy(rewizja):
    """{klucz spisu: {tytuły wierszy}} dla wszystkich .spis-tematow w docs/**.md"""
    wynik = {}
    for sciezka in pliki(rewizja):
        if not (sciezka.startswith("docs/") and sciezka.endswith(".md")):
            continue
        tekst = tresc(rewizja, sciezka)
        if "spis-tematow" not in tekst:
            continue
        for m in re.finditer(r'<div\s+[^>]*class="spis-tematow"[^>]*>', tekst):
            koniec = tekst.find("</div>", m.end())
            obszar = tekst[m.end(): koniec if koniec != -1 else len(tekst)]
            nazwa = re.search(r'data-postep="([^"]+)"', m.group(0))
            klucz = nazwa.group(1) if nazwa else f"(brak data-postep) {sciezka}"
            tytuly = wynik.setdefault(klucz, set())
            for blok in re.split(r"\n\s*\n", obszar):
                linie = [l.strip() for l in blok.splitlines() if l.strip().startswith("|")]
                # pierwszy wiersz to nagłówek, drugi — separator
                if len(linie) >= 3 and re.match(r"^\|\s*:?-{3,}", linie[1]):
                    for l in linie[2:]:
                        pierwsza = l.strip().strip("|").split("|")[0]
                        t = czysty(pierwsza)
                        if t:
                            tytuly.add(t)
    return wynik


# ------------------------------------------------------------- porównanie
def klucze(baza):
    if not baza or set(baza) == {"0"} or subprocess.run(
            ["git", "cat-file", "-e", f"{baza}^{{commit}}"], capture_output=True).returncode != 0:
        print("Brak commita bazowego (pierwszy push, nowa gałąź albo force-push) — pomijam porównanie.")
        return
    stare, nowe = wczytaj_karty(baza), wczytaj_karty("HEAD")
    po_starym = {k["poprzedni"]: id_ for id_, k in nowe.items() if k["poprzedni"]}

    for id_, k in stare.items():
        if id_ in nowe:
            cel = nowe[id_]
        elif id_ in po_starym:          # przeniesienie przez idPoprzedni — karta.js kopiuje odpowiedzi
            cel = nowe[po_starym[id_]]
        else:
            ostrzezenia.append((k["plik"], f"Karta „{id_}” zniknęła albo zmieniła id bez pola „idPoprzedni”. "
                                "Uczniowie stracą wpisane odpowiedzi."))
            continue
        brak = sorted(set(k["pola"]) - set(cel["pola"]))
        if brak:
            ostrzezenia.append((cel["plik"], f"W karcie „{id_}” zniknęły pola: {', '.join(brak)}. "
                                "Odpowiedzi uczniów w tych polach przepadną."))

    s_stare, s_nowe = spisy(baza), spisy("HEAD")
    for klucz, tytuly in s_stare.items():
        if klucz not in s_nowe:
            ostrzezenia.append((None, f"Spis tematów „{klucz}” zniknął albo zmieniło się jego data-postep. "
                                "Uczniowie stracą zaznaczenia przerobionych tematów."))
            continue
        brak = sorted(tytuly - s_nowe[klucz])
        if brak:
            ostrzezenia.append((None, f"W spisie „{klucz}” zmieniły się albo zniknęły tytuły wierszy: "
                                + "; ".join(brak) + ". Zaznaczenia przy nich przepadną."))


def znacznik_obecny(baza):
    opis = os.environ.get("OPIS_PR", "")
    if baza:
        opis += "\n" + (git("log", f"{baza}..HEAD", "--format=%B") or "")
    return ZNACZNIK.lower() in opis.lower()


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("sekrety", "struktura", "klucze"):
        print(__doc__)
        return 2
    tryb = sys.argv[1]
    baza = sys.argv[sys.argv.index("--base") + 1] if "--base" in sys.argv else ""

    if tryb == "sekrety":
        return 0 if sekrety() else 1
    if tryb == "struktura":
        struktura()
    else:
        klucze(baza)

    zamierzone = tryb == "klucze" and znacznik_obecny(baza)
    for plik, opis in bledy:
        adnotacja("error", plik, opis)
    for plik, opis in ostrzezenia:
        adnotacja("warning" if zamierzone else "error", plik, opis)
    if zamierzone and ostrzezenia:
        print(f"\nZnaleziono {ZNACZNIK} — zmiany kluczy uznane za zamierzone.")
    zatrzymaj = bool(bledy) or (bool(ostrzezenia) and not zamierzone)
    if zatrzymaj:
        print(f"\nKontrola „{tryb}” nie przeszła.")
        if tryb == "klucze":
            print(f"Jeśli zmiana kluczy jest zamierzona, dopisz {ZNACZNIK} do opisu PR albo komunikatu commita.")
    else:
        print(f"Kontrola „{tryb}”: OK.")
    return 1 if zatrzymaj else 0


if __name__ == "__main__":
    sys.exit(main())
