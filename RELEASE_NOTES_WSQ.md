## Video Hub App 3 – wersja WsQ (na bazie oficjalnego v3.3.0)

Tagi w stylu **Ritt** w VHA:

- **Drzewo tagów** po lewej (przycisk „Pokaż drzewo tagów” w pasku): tagi można zagnieżdżać przeciąganiem, mają liczniki, separatory i wyszukiwarkę (szuka też po aliasach).
- **Ikona/emoji** dla każdego tagu (PPM → Ikona…). Flagi krajów działają też na Windows (wbudowana czcionka Twemoji Country Flags).
- **Aliasy** (`@`): dodatkowe nazwy tagu, używane w wyszukiwaniu i auto-tagowaniu (np. `[u]` dla `uncensored`).
- **Atrybuty** (PPM):
  - Odznaka (tarcza): ikona lub nazwa tagu widoczna na miniaturach;
  - Zawieraj podtagi (ikona hierarchii): aktywny tag pokazuje też pliki z podtagów;
  - Ukryty;
  - Skrót klawiszowy 1–0, który włącza i wyłącza tag na bieżącym filmie (albo na zaznaczonych w trybie wsadowym).
- **Filtrowanie**:
  - klik = tylko ten tag, Ctrl+klik / środkowy przycisk = dodaj tag, Shift+klik = wyklucz;
  - przełącznik część wspólna / suma;
  - nad galerią pasek aktywnych tagów i wyszarzonych **tagów powiązanych**.
- **Dziedziczenie z folderów**: przeciągnij tag na folder w widoku folderów, a wszystko w środku go odziedziczy. W szczegółach filmu widać sekcję „Odziedziczone”.
- **Auto-tagowanie**:
  - przycisk ⚡ w drzewie albo PPM → „Auto-taguj tym tagiem” dodaje tagi, których nazwa lub alias występuje w nazwie pliku;
  - w szczegółach filmu jest panel „Auto tagowanie” z propozycjami.
- Tagowanie:
  - przeciągnij tag z drzewa na film;
  - albo kliknij kółko przy tagu (bieżący film);
  - albo w trybie wsadowym kliknij tag, żeby dodać go do zaznaczonych.

Biblioteka tagów jest wspólna dla wszystkich hubów: `tag-library.json` obok `settings.json` (z kopią `.bak`). Tagi folderów są zapisywane w pliku huba `.vha2`, w polu `folderTags`.

Remote (UI na telefon) zbudowany z whyboris/Video-Hub-App-remote @ 558d899.
