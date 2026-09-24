# Sprawdziany

Strona do prac klasowych pisanych przy komputerze — **https://josimate.github.io/sprawdziany/**

Jedna strona, bez menu i bez wyszukiwarki. Uczeń wczytuje plik arkusza od nauczyciela,
odpowiada w polach na stronie (tekst, tabele, wybór, zrzuty ekranu) i pobiera jeden dokument
Word, który oddaje przez *Zadania domowe* w dzienniku VULCAN. Nazwa pliku ustawia się sama
(`nr12-dzial1.docx`), a na końcu dokumentu jest tabela oceny do wypełnienia przez nauczyciela.

## ⚠ Repozytorium jest publiczne

**Prawdziwych arkuszy sprawdzianów nie wolno tu commitować.** Każdy plik z tego repozytorium
jest do pobrania z GitHuba i z GitHub Pages. W repozytorium jest wyłącznie
`docs/przyklad/arkusz-probny.json` — arkusz do przećwiczenia obsługi strony.

Arkusze sprawdzianów trzymaj w `_materialy-nauczycielskie` i udostępniaj uczniom na początku
lekcji (Dysk Google z dostępem ograniczonym albo załącznik w dzienniku).

## Jak przebiega sprawdzian

1. Na początku lekcji uczniowie pobierają plik arkusza swojej grupy (`…-arkusz-A.json`).
2. Wchodzą na stronę, klikają **Wczytaj arkusz** i wskazują plik.
3. Wpisują numer w dzienniku i rozwiązują. Odpowiedzi zapisują się same.
4. Klikają **Pobierz jako dokument Word** i dołączają plik w dzienniku.
5. Klikają **Zakończ i usuń odpowiedzi z tego komputera**.

### Wspólne komputery w pracowni

- Odpowiedzi leżą w przeglądarce ucznia (IndexedDB), nigdzie nie są wysyłane.
- Na komputerze jest miejsce na **jedną** pracę. Kto otworzy stronę i zastanie cudzą pracę,
  dostaje pytanie *„czy to twoja praca?”* z numerem w dzienniku poprzednika — może do niej wrócić
  (przeglądarka się zamknęła) albo ją usunąć i zacząć od nowa.
- Praca bez ani jednej odpowiedzi znika bez pytania; praca starsza niż 12 godzin — też.
- Odpowiedzi nie trafiają do `localStorage`, więc nie mieszają się z kartami pracy z serwisów
  z materiałami i nie zajmują ich miejsca (localStorage ma ~5 MB wspólne dla całego
  `josimate.github.io`).

## Format arkusza

Plik JSON. Treści poleceń mogą zawierać `<strong>`, `<em>`, `<code>`, `<kbd>`, `<br>`,
`<sub>`, `<sup>`, `<u>` — wszystko inne strona zamienia na zwykły tekst.

```json
{
  "format": "arkusz-sprawdzianu-pceikz",
  "wersja": 1,
  "id": "1tt-dzial2-2026-a",
  "rodzaj": "Praca klasowa",
  "tytul": "Wiesz, umiesz, zdasz — Dział II…",
  "przedmiot": "Informatyka, zakres rozszerzony",
  "klasa": "1TT",
  "grupa": "A",
  "plik": "dzial2",
  "zasady": ["Wolno: …", "Nie wolno: …"],
  "zadania": [
    {
      "nr": 1,
      "tytul": "Tytuł zadania",
      "wstep": "Dany jest adres <code>10.0.0.1</code>.",
      "polecenia": [
        {
          "nr": "a",
          "poziom": "K",
          "kluczowe": true,
          "kryterium": "K1",
          "przed": "Sytuacja: … (opcjonalnie, wyświetla się nad poleceniem)",
          "tresc": "Treść polecenia.",
          "pola": [
            { "typ": "tabela", "mono": true, "wiersze": [["z1a_ip", "Adres IPv4", "podpowiedź"]] },
            { "typ": "tekst", "id": "z1a_opis", "pytanie": "Uzasadnienie", "wiersze": 3 },
            { "typ": "wybor", "id": "z1a_rodzaj", "opcje": ["prywatny", "publiczny"] },
            { "typ": "zrzut", "id": "z1a_zrzut", "opis": "co ma być na zrzucie" }
          ]
        }
      ]
    }
  ]
}
```

| Pole | Znaczenie |
|------|-----------|
| `id` | identyfikator arkusza; dla każdej grupy inny |
| `plik` | końcówka nazwy dokumentu: `nr<numer>-<plik>.docx` |
| `poziom` | `K`, `P`, `R`, `D` (albo własne, zdefiniowane w `"poziomy"`) |
| `kluczowe` | polecenie oznaczone ★ — tolerancja go nie obejmuje |
| `kryterium` | identyfikator kryterium z klucza; trafia do tabeli oceny w dokumencie |
| `mono` | odpowiedź czcionką o stałej szerokości (adresy, polecenia) |
| `regula` | własny opis zasady oceniania zamiast domyślnego |
| `poziomy` | własna lista poziomów: `[{"kod": "K", "opis": "…", "ocena": "2"}, …]` |

Identyfikatory pól muszą być unikalne w całym arkuszu i nie mogą zaczynać się od `_`.
Strona sprawdza arkusz przy wczytaniu i wypisuje błędy z numerem polecenia — **wczytaj każdy
nowy arkusz sam przed lekcją**.

## Uruchomienie po raz pierwszy

1. Załóż na GitHubie puste repozytorium `JosiMate/sprawdziany` (publiczne — GitHub Pages).
2. Wypchnij ten katalog:
   ```
   git remote add origin https://github.com/JosiMate/sprawdziany.git
   git push -u origin main
   ```
3. **Settings → Pages → Source: GitHub Actions.** Workflow `.github/workflows/deploy.yml`
   zbuduje i opublikuje stronę przy każdym pushu.

Podgląd lokalny: `pip install -r requirements.txt`, potem `mkdocs serve`.

## Pliki

| Plik | Zawartość |
|------|-----------|
| `docs/index.md` | strona sprawdzianu i instrukcja dla ucznia |
| `docs/assets/js/sprawdzian.js` | cała logika: arkusz, pola, zapis, dokument Word |
| `docs/assets/js/docx.umd.js` | biblioteka składająca .docx, doczytywana przy pierwszym pobraniu |
| `docs/assets/sprawdzian.css` | pola (te same co w kartach pracy) i elementy strony sprawdzianu |
| `docs/stylesheets/extra.css` | wspólna warstwa wyglądu serwisów |
| `docs/stylesheets/motyw.css` | kolory tego serwisu (czerwień) |
| `docs/przyklad/arkusz-probny.json` | arkusz do ćwiczenia — jedyny arkusz w repozytorium |
