## Video Hub App 3 – wersja WsQ (na bazie oficjalnego v3.3.0)

### Nowe w wsq.5
- **Menu prawego przycisku** (tagi i filmy) jest bardziej zwarte i półprzezroczyste z rozmyciem tła, jak w Windows 11 / Ritt.
- **Wybór ikony jak w Ritt:** bieżąca ikona z koszem, kategorie (Ostatnie, Buźki, Ludzie, Zwierzęta, Jedzenie, Aktywności, Podróże, Przedmioty, Symbole, Flagi), wyszukiwarka po polsku i angielsku (np. „flaga”, „japonia”, „cherry”). Środkowy przycisk myszy usuwa ikonę z ostatnich. Na dole pole **Niestandardowa ikona**: emoji albo tekst, np. `06` jako wiek.
- Ikony tekstowe wyświetlają się zwykłą czcionką (wcześniej cyfry wyglądały jak „0 6”).
- Menu otwiera się dokładnie przy kursorze i nie wchodzi pod pasek stanu.
- Nazwy emoji pochodzą z emojibase-data (MIT, licencja w `assets/emoji`).

### Nowe w wsq.4
- **Kształt kafelków dopasowuje się do zawartości widoku:** gdy większość plików na ekranie ma okładki, kafelki przyjmują proporcje okładek (mediana, np. JAV 800×538), więc okładki nie są przycinane. Bez okładek zostaje 16:9. Klatki przy przewijaniu wypełniają kafelek i są wyśrodkowane.
- **Nazwa w lewym dolnym rogu** (kod typu PPPE-029, a gdy go nie ma – nazwa pliku), tej samej wielkości co czas po prawej; oba znaczniki mają półprzezroczyste tło.
- Prawy panel pokazuje podgląd w proporcjach okładki danego pliku.

### Nowe w wsq.3
- **Dolne zakładki usunięte** (Chmura słów, Tagi, Podobne, Ostatnie, Detale).
- **Ekran główny przebudowany według wizualizacji:**
  - pasek tytułu: „Video Hub App 3 WsQ”, nazwa huba, aktywne tagi na środku;
  - pasek narzędzi: Wstecz / Dalej (historia filtrów), Odśwież, Wszystko, wyszukiwarka, Filtry, sortowanie (także „Data dodania”), widoki, suwak **Rozmiar**, panel, tryb ciemny, •••, ustawienia;
  - lewy panel: zakładki **Huby / Tagi / Ulubione**, ∪/∩, ukryte tagi, sekcja **Zakładki** (zapisane filtry, „+” zapisuje bieżący);
  - kafelki: zaokrąglone, odznaki tagów pod obrazkiem, nazwa pliku w 2 linijkach, kod (np. PPPE-029) na okładce, niebieska ramka po najechaniu i przy zaznaczeniu;
  - prawy panel od nowa: podgląd, tytuł, czas/rozmiar/rozdzielczość/fps, gwiazdki, ramka **Tagi** (usuwanie ✕, dodawanie z podpowiedzią Tab, odziedziczone, kopiuj/wklej), **Ścieżka**, **Klatki**, **Notatki**;
  - pasek stanu na dole: liczba tagów, elementów i zaznaczonych, zoom miniatur i panelu;
  - tryb ciemny domyślnie.

### Nowe w wsq.2
- **Układ jak w Ritt:**
  - pasek narzędzi z jedną wyszukiwarką: nazwa, folder i tag; `OR`, `-wyklucz`, `NOT`, `"fraza"`, `*`;
  - przyciski Odśwież, Filtry i Sortowanie oraz przełączniki widoku;
  - stary panel filtrów (fuzzy, magic, regex, „folder/video name has”) usunięty. Czas, rozmiar, rozdzielczość, gwiazdki, rok i duplikaty są teraz w okienku **Filtry**;
  - prawy **panel szczegółów** z podglądem, tagami, notatkami i klatkami; przewija się osobno, **Ctrl + kółko** powiększa sam panel;
  - **Ctrl + kółko nad galerią** zmienia rozmiar miniatur;
  - pojedynczy klik zaznacza film, podwójny go odtwarza;
  - wszystkie stare przyciski VHA są pod „•••”.
- **Pasek aktywnych tagów:**
  - przy każdym tagu przełącznik **ZAWIERA / UNIKA**;
  - powiązane tagi zajmują maks. 3 linijki, a na końcu 3. linijki jest przycisk „wszystkie (N)”, który otwiera okienko z wyszukiwarką;
  - środkowy przycisk albo Shift+klik = unika.
- **Okładki z metadanych** (załączniki MKV `cover_land` / `cover`, `covr` w MP4) są główną miniaturą:
  - okładka pozioma wypełnia kafelek, pionowa jest na rozmytym tle;
  - po najechaniu kursorem przewijają się klatki, a kreski pokazują pozycję.
- **Wykrywanie zmienionych plików** (rozmiar / data modyfikacji): po dodaniu okładki do pliku tagi zostają, a jeśli wideo się nie zmieniło, klatki też. Niewatchowane foldery są skanowane przy każdym otwarciu huba i przyciskiem Odśwież.
- **Prawy przycisk na filmie:**
  - „Odśwież okładkę” oraz „Sprawdź okładki we wszystkich plikach”;
  - „Kopiuj tagi” i „Wklej tagi”. To samo robią ikony w panelu szczegółów i skróty Ctrl+Shift+C / Ctrl+Shift+V.
- **Import bazy Ritt (.ritt)** (przycisk ⤓ w drzewie tagów):
  - przenosi drzewo, ikony, odznaki, kapsułki, ukryte, skróty i separatory;
  - tagi plików są dopasowywane po nazwie i folderach, tagi folderów zamieniają się w dziedziczenie;
  - czyta bazę także wtedy, gdy Ritt jest otwarty (WAL).
- **Menu tagu jak w Ritt:**
  - Zmień nazwę (F2), Duplikuj, Usuń (Delete);
  - Ikona, Kolor, Alias, Notatki;
  - Atrybuty: Odznaka, Kapsułka, Ukryty, Skrót klawiaturowy, Dziedzicz (głębokość) i „Co to jest?”;
  - Nowy tag (Ctrl+N), Nowy tag podrzędny (Ctrl+M), Nowy separator;
  - Sortuj podrzędne, Sortuj potomków.
- Po zmianie nazwy lub przeniesieniu folderu poza VHA jego tagi przechodzą razem z plikami.
- Usunięte auto-tagowanie.

### Z wsq.1
- Drzewo tagów z zagnieżdżaniem, ikonami/emoji (flagi krajów działają też na Windows), aliasami, odznakami na miniaturach, skrótami 1–0, tagami folderów i trybem część wspólna / suma.

Biblioteka tagów jest wspólna dla wszystkich hubów: `tag-library.json` obok `settings.json` (z kopią `.bak`). Tagi folderów i okładki są zapisywane w pliku huba `.vha2`, okładki w `vha-<hub>/covers/`.

Remote (UI na telefon) zbudowany z whyboris/Video-Hub-App-remote @ 558d899.
