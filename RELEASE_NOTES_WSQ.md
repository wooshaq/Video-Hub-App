## Video Hub App 3 – wersja WsQ (na bazie oficjalnego v3.3.0)

### Nowe w wsq.12
- **Nowe okno ustawień:** wyśrodkowane, półprzezroczyste, z menu sekcji po lewej (Wygląd, Główne, Wyświetlanie, Wyszukiwanie, Ten HUB, Skróty) i nagłówkiem sekcji. Opcje VHA są w kartach w jednym stylu, przyciski i pola w kolorach motywu, przełączniki podświetlone kolorem akcentu. Otwiera się na ostatnio używanej sekcji; klik obok okna albo Esc zamyka.

### Nowe w wsq.11
- **Stare skróty VHA nie otwierają już starego interfejsu:** Ctrl+F (oraz Ctrl+G, Ctrl+R) przechodzi do wyszukiwarki, Ctrl+B otwiera okienko Filtry, Ctrl+T otwiera nową kartę, Ctrl+0 czyści wszystko (jak przycisk Wszystko). Ctrl+Y, Ctrl+K, Ctrl+I i Ctrl+L nic nie robią (zmieniały układ). Ctrl+N w panelu tagów tworzy tag zamiast nowego huba.
- **Drugi dysk / kolejny folder:** w zakładce Foldery przycisk „+” dodaje folder do bieżącego huba i od razu go skanuje.
- **Ustawienia → WsQ:** wielkość czcionki nazwy pliku, liczba linijek nazwy (1–3) i odstęp między miniaturami. Domyślnie mniejszy odstęp (16 px) i czcionka 12 px.

### Nowe w wsq.10
- **Pasek tagów na górze jest widoczny zawsze**, także bez filtra: pokazuje tagi zebrane z filmów w bieżącym widoku (po folderze, wyszukiwaniu, filtrach) z liczbą filmów, od najczęstszych. Klik = zawiera, Shift/środkowy = unika.

### Nowe w wsq.9
- **Pasek tytułu połączony z paskiem narzędzi** – o 32 px więcej miejsca. Okno przeciąga się za puste miejsca paska, ─ ▢ ✕ są po prawej, logo po lewej (nazwa huba w podpowiedzi), karty i „+” (nowa karta) są obok przycisku Wszystko, postęp importu w pasku stanu.

### Nowe w wsq.8
- Import z Ritt przenosi też **aliasy**, **kolor** (pierwszy z pary kolorów Ritt) i **Dziedzicz** (głębokość, atrybut 6245). Notatki są czytane, jeśli Ritt zapisuje je jako właściwość z „Note/Notes/Description” w nazwie (jeszcze niepotwierdzone).

### Nowe w wsq.7
- Wklejanie tagów (ikona, prawy przycisk, Ctrl+Shift+V) trafia do wszystkich zaznaczonych plików. Prawy przycisk na pliku spoza zaznaczenia wkleja tylko do niego.

### Nowe w wsq.6
- **Motyw i kolor akcentowy:** przycisk z paletą w pasku narzędzi – Ciemny / Jasny i 10 kolorów akcentu (lub własny). Kolor obejmuje zaznaczenia, aktywne tagi, suwaki, ramki itd.
- **Wielozaznaczenie jak w Eksploratorze:** Ctrl+klik, Shift+klik (zakres), ramka myszą od pustego miejsca galerii, Ctrl+A (cały widok), Esc czyści. Kółka w drzewie tagów działają na całe zaznaczenie: pełne = wszystkie mają, kropka = część ma, puste = żaden; klik dodaje do wszystkich albo usuwa ze wszystkich. Prawy panel pokazuje „zaznaczono: N” i tagi z licznikiem 1/2 (klik w licznik dodaje do wszystkich). Skróty 1–0 i kopiuj/wklej też działają na zaznaczenie.
- **Szybkie tagowanie klawiszem T:** okienko z podpowiedziami (nazwy i aliasy), ↑↓ wybór, Enter dodaje/usuwa i zostaje otwarte, Ctrl+Enter dodaje i zamyka, Shift+Enter tworzy dokładnie wpisany tag, Esc zamyka.
- **Liczniki w drzewie według bieżącego widoku:** przy filtrze liczba przy tagu to tyle wyników, ile zostanie po jego dodaniu; tagi bez wyników są wyszarzone (całkowita liczba w podpowiedzi).
- **Zakładka Foldery** w lewym panelu: drzewo folderów huba z licznikami; klik filtruje folder razem z podfolderami, ponowny klik albo ✕ zdejmuje filtr.
- **Karty widoków** na pasku tytułu: każda karta pamięta tagi, wyszukiwanie i folder. „Otwórz w nowej karcie” w menu tagu, środkowy przycisk na tagu lub folderze, „+” kopiuje bieżący widok, środkowy przycisk lub ✕ zamyka kartę. (Środkowy przycisk na tagu w drzewie nie dodaje go już do filtra – do tego jest Ctrl+klik.)
- Wstecz/Dalej pamiętają też filtr folderu.

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
