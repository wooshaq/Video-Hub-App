### Nowe w wsq.46
- Szybki pasek (klatki kluczowe) tylko gdy kadry są co najmniej 30 s od siebie (np. 20 kadrów → filmy od ok. 10,5 min). Odstępy zostają równe, bez powtórzonych klatek; krótsze filmy idą dokładnym sposobem.

### Nowe w wsq.45
- Szybsze paski klatek: dla filmów od 3 minut ffmpeg dekoduje tylko najbliższą klatkę kluczową każdego kadru (jeden wątek na kadr) zamiast dekodować wszystko do dokładnego czasu — ok. 5× szybciej (H.264 1080p: 2,6 s → 0,5 s, HEVC: 5,6 s → 1,2 s). Gdy taki pasek nie przejdzie kontroli, robiony jest od razu starym, dokładnym sposobem.

### Nowe w wsq.44
- Szybkie okładki: z MKV (załączniki) i MP4/M4V/MOV (covr) obrazek jest czytany prosto z pliku i skalowany w programie — bez ffprobe/ffmpeg i bez plików tymczasowych (milisekundy zamiast sekund na plik). Inne formaty i nietypowe obrazki (np. webp) idą starą drogą.
- Przeciąganie tagów między grupami: zwinięta grupa rozwija się po przytrzymaniu nad nią tagu, a lista przewija się sama przy górnej/dolnej krawędzi.

### Nowe w wsq.43
- Bezpiecznik pasków klatek: każdy pasek jest robiony do pliku tymczasowego i sprawdzany (czy się czyta i czy klatki nie są czarne), zanim zastąpi stary. Zły pasek jest od razu robiony ponownie (do 3 prób: dłuższy czas dla ffmpeg i przesunięte klatki), zanim wątek weźmie następny plik. Pliki, z których nie dało się zrobić dobrego paska, widać w okienku zadań.
- Limity czasu ffmpeg rosną z liczbą równoległych procesów (przy kilku naraz pasek nie jest już ucinany na czarno).
- Najpierw okładki, potem miniatury i paski: dopóki kolejka okładek ma pracę, wątki pasków czekają (status „czeka na okładki”).

## Video Hub App 3 – wersja WsQ (na bazie oficjalnego v3.3.0)

### Nowe w wsq.42
- **Sprawdzanie pasków klatek:** w okienku „Teraz przerabiane” (klik w „Ten folder” na dole) przycisk „Sprawdź paski w tym folderze”, a w menu kontekstowym „Sprawdź paski klatek (brakujące / czarne)” — dla pliku, zaznaczenia albo całego folderu (prawy klik na kafelku folderu). Paski, których brakuje, są uszkodzone albo całe czarne, idą od razu do ponownego wygenerowania na początku kolejki.
- Pasek, który po wygenerowaniu wyjdzie czarny albo go nie będzie, jest automatycznie generowany jeszcze raz (jedna ponowna próba).

### Nowe w wsq.41
- Z kafelków usunięte ikonki „szczegóły” (prawy górny róg) i „dodaj do kolejki odtwarzania” (prawy dolny róg).

### Nowe w wsq.40
- Pole wyszukiwania ma tę samą szerokość w trybie ciemnym i jasnym (w ciemnym było ucinane do 620 px).

### Nowe w wsq.39
- **Okładki otwartego folderu mają pierwszeństwo:** kolejka okładek też przestawia się na folder, który oglądasz (wcześniej tylko paski klatek), także dla okładek dodanych do kolejki później.

### Nowe w wsq.38
- **Dolny pasek: „Ten folder: X / Y (%)”** — ile plików w otwartym folderze (razem z podfolderami; poza widokiem folderów: cały hub) ma już gotowe miniatury i paski klatek; ✓ gdy komplet.
- **Klik w ten napis** otwiera okienko „Teraz przerabiane”: które pliki są właśnie obrabiane (paski klatek / okładka / sprawdzanie), od ilu sekund, i ile czeka w kolejce.
- **Menu kontekstowe → „Wygeneruj paski klatek ponownie”** — kasuje paski i miniaturę wybranych plików (albo całego zaznaczenia) i generuje je od nowa na początku kolejki.
- Usunięty przycisk widoku „Klipy” z paska narzędzi.

### Nowe w wsq.37
- **Mniejsze okładki:** nowe okładki są zapisywane od razu w szerokości max 480 px (wcześniej do 960 px) – to trochę więcej niż kafelek przy 4 miniaturach w rzędzie.
- **Zmniejszanie starych okładek:** po otwarciu huba program najpierw przeskalowuje już zapisane okładki do 480 px (postęp na dolnym pasku), a dopiero potem wraca do wyciągania okładek i miniatur. Robi to raz na hub.
- **„Właściwości” w menu pod prawym przyciskiem** otwierają systemowe okno Właściwości pliku (to samo co w Eksploratorze) na wierzchu.
- **Domyślnie po polsku:** po aktualizacji program raz przełącza się na polski (później obowiązuje język wybrany w Ustawieniach).

### Nowe w wsq.36
- **Ritt jako baza tagów VHA** (Ustawienia → Ritt → wybierz plik .ritt). Plik .ritt trzyma wszystko, co Ritt umie: drzewo tagów (kolejność, zagnieżdżenie, separatory), ustawienia tagów (ikona, kolor, aliasy, notatki, ukrycie, „pokazuj w podtagach”, plakietka, skrót 0–9, dziedziczenie), tagi plików i folderów oraz **notatki plików, folderów i tagów**. VHA nie trzyma już własnej kopii tych danych — w hubie zostają tylko miniatury, okładki, informacje o filmach i tagi plików, których Ritt nie zna.
  - Zmiany z VHA trafiają do .ritt po ok. 1,5 s, zmiany z Ritta VHA sprawdza co 15 s.
  - Gdy Ritt jest otwarty, VHA nie zapisuje do pliku — zrobi to po jego zamknięciu. Kopia .ritt przed każdym zapisem (10 ostatnich, `ritt-backups` obok huba).
  - Pliki dopasowywane po ścieżce: nazwa folderu źródłowego VHA = nazwa folderu podpiętego w Ritt.
  - **Gwiazdki = tagi oceny:** w ustawieniach Ritt wybierasz tag, którego podtagi są ocenami (1. podtag = 1 gwiazdka …). Kliknięcie gwiazdek nadaje tag oceny (także na zaznaczonych plikach), liczba gwiazdek = liczba ocen w grupie.
  - Wyłączenie pliku .ritt przywraca trzymanie tagów w VHA (dane z Ritta zostają wtedy zapisane w hubie).
- **Efekt szkła:** galeria przewija się pod paskiem tagów i ścieżką folderów, które są półprzezroczyste i rozmyte (rozmywane są tylko te dwa cienkie paski, więc nie obciąża to procesora).
- **Jednolite, cienkie suwaki** w całym programie (3 px); rozszerzają się do 8 px, gdy kursor zbliży się do krawędzi, a pod kursorem podświetlają się kolorem akcentu.

### Nowe w wsq.35
- **Synchronizacja tagów z Ritt (w obie strony):** Ustawienia → Ritt → „Wybierz plik .ritt…”. VHA i Ritt mają wtedy te same tagi: drzewo tagów (nazwy, ikony, kolory, aliasy, nowe i usunięte tagi) oraz przypisania tagów do plików i folderów. Miniatury, okładki i reszta danych zostają w VHA — nic nie jest skanowane od nowa.
  - Automatycznie po otwarciu huba i co 3 minuty, gdy w VHA coś się zmieniło; przycisk „Synchronizuj teraz”.
  - Dodane / usunięte w jednym programie → dodane / usunięte w drugim. Przy sprzecznej zmianie nazwy, ikony lub koloru wygrywa VHA. Pliki dopasowywane po ścieżce.
  - Gdy Ritt jest otwarty, VHA tylko pobiera jego zmiany; swoje zapisze przy następnej synchronizacji.
  - Przed każdym zapisem kopia .ritt (10 ostatnich) w folderze `ritt-backups` obok huba.
  - Nowa biblioteka: sql.js 1.15.2 (SQLite w WebAssembly, MIT).

### Nowe w wsq.34
- **Nowy wygląd „Grafit” (tryb ciemny):** jedna rodzina grafitowych szarości + kolor akcentu, ujednolicone wysokości przycisków i pól, zaokrąglone „pigułki” tagów.
- **Górny pasek:** logo w kolorze akcentu, wyszukiwarka z lupą i podpowiedzią Ctrl F, przyciski widoku (miniatury / lista / klipy) w jednej grupie.
- **Lewy panel:** zakładki jako jeden przełącznik, nagłówki sekcji wielkimi literami, wiersze tagów 24 px z liczbami wyrównanymi do prawej.
- **Kafelki:** pod nazwą linijka „rok · rozdzielczość”, ikonki tagów po prawej, zaznaczenie z obwódką i znaczkiem ✓. Foldery jako karta z podglądem zawartości (własne ikony z desktop.ini działają dalej).
- **Panel szczegółów:** kod JAV + gwiazdki, sam tytuł filmu (bez aktorki i kodu), ścieżka, informacje o pliku w jednej linijce, przyciski Odtwórz / folder / kopiuj tagi / wklej tagi / więcej, tagi, klatki w 4 kolumnach, notatki.
- **Dolny pasek:** postęp generowania z paskiem w kolorze akcentu.

### Nowe w wsq.33
- **Menu kontekstowe → Przenieś do kosza:** zawsze dostępne (bez włączania w ustawieniach), działa na pojedynczy plik albo na całe zaznaczenie (liczba w nawiasie), z potwierdzeniem i listą plików. Gdy w ustawieniach jest włączone „usuwanie z pominięciem kosza”, pozycja zmienia się na „Usuń trwale”.
- **Menu kontekstowe → Właściwości:** otwiera systemowe okno właściwości pliku Windows.

### Nowe w wsq.32
- **Poprawka brakujących okładek przy generowaniu równoległym:** kolejka okładek i kolejka miniatur mogły naraz wyciągać okładkę z tego samego pliku — jedna drugiej kasowała plik tymczasowy i plik dostawał „brak okładki”. Teraz jeden plik = jedno wyciąganie naraz. Gdy dysk nie zdąży odpowiedzieć (timeout przy dużym obciążeniu), okładka jest ponawiana później (do 3 razy), a nie oznaczana na stałe jako brak. Odczyt metadanych max 2 procesy naraz, dłuższy limit czasu.
- **Szybszy start dużego huba:** pomiar kształtu okładek nie odświeża już całego okna przy każdym obrazku, pasek postępu odświeża się max 4× na sekundę, ikony folderów są czytane po kawałku (okno nie zamarza).
- **Panel tagów:** ciaśniejsze wiersze (22 px) i własne powiększenie Ctrl + kółko myszy nad drzewem tagów / folderów (70–160%, zapamiętywane, widoczne na dolnym pasku).
- „Odśwież okładkę” z menu kontekstowego idzie teraz na początek kolejki.

### Nowe w wsq.31
- **Kształt kafelków z okładek JAV:** stała proporcja miniatur liczy się teraz tylko z okładek plików z kodem JAV (te, które wyglądały dobrze), a nie ze wszystkich okładek huba — koniec z obniżonymi kafelkami. Inne okładki decydują tylko wtedy, gdy w hubie nie ma żadnych JAV.

### Nowe w wsq.30
- **Stały kształt kafelków:** proporcje miniatur bierze się z okładek całego huba (np. JAV) i są takie same w każdym folderze i w widoku folderów — przechodzenie między folderami już nie przeskalowuje siatki. Kształt jest zapamiętywany, więc od startu programu jest od razu właściwy.

### Nowe w wsq.29
- **Równoległe generowanie:** Ustawienia → Wygląd → „Równoległe procesy” (1, 2, 3, 4, 6, 8; domyślnie 3). Tyle okładek, pasków klatek i odczytów nowych plików robi się jednocześnie (wcześniej zawsze po jednym). Zmiana działa od razu, także w trakcie generowania. HDD: najlepiej 2–3, SSD/NVMe: 4–6.

### Nowe w wsq.28
- Kształt kafelków bierze się z okładek zawsze, gdy w widoku jest choć jedna okładka (wcześniej dopiero przy połowie plików z okładką – w folderach z mniejszą liczbą okładek kafelki były 16:9, a okładki pomniejszone z rozmytymi pasami po bokach). Klatki plików bez okładki są przycinane tak, żeby wypełniały kafelek.

### Nowe w wsq.27
- **Pliki z okładką nie dostają miniatury (thumbnails):** przy generowaniu program najpierw sprawdza okładkę; jeśli plik ją ma, robi tylko pasek klatek (filmstrip) do przewijania po najechaniu, a pojedynczą miniaturę pomija. Szybsze generowanie i mniej plików w `thumbnails`. Już zrobione miniatury zostają.

### Nowe w wsq.26
- **Wyszukiwarka jak w Ritt:** przy wpisywaniu pod polem pojawia się lista pasujących tagów (nazwy i aliasy) ze ścieżką w drzewie (np. AKTORKI › JAV ›). ↑↓ wybór, Enter dodaje tag do filtra (Shift+Enter = UNIKA), Enter bez wyboru zamienia wpisany tekst w kafelek – kilka kafelków działa razem (AND), Backspace w pustym polu usuwa ostatni, Esc czyści.
- **Wyszukiwanie globalne:** w widoku folderów wyszukiwanie szuka w całym hubie (pokazuje pliki, nie foldery).
- **Duble po kodzie JAV:** nowy przycisk w pasku narzędzi (dwie kartki) z czerwonym licznikiem kodów, które występują więcej niż raz (PPPE-029, PPPE029 i PPPE-29 to ten sam kod). Klik pokazuje tylko te pliki, pogrupowane kodem; ponowny klik albo „Wszystko” wraca.
- **Szybsza nawigacja po folderach:** ikony z desktop.ini wszystkich folderów huba są wczytywane w tle po otwarciu huba, a podglądy folderów na ekranie trafiają do pamięci razem z okładkami.

### Nowe w wsq.25
- **Miniatury pojawiają się od razu, gdy są gotowe:** wcześniej film, dla którego miniatura powstała w trakcie, został z pustym obrazkiem do czasu przewinięcia/ponownego otwarcia. Dotyczy też podglądów w folderach.
- **Priorytet otwartego folderu naprawiony:** w widoku folderów brane były wszystkie pliki huba zamiast plików folderu; teraz najpierw idą pliki widoczne na ekranie, potem cały folder z podfolderami – także pliki dorzucane do kolejki później.
- **„Obserwuj folder” nie zatrzymuje już miniatur i nie przeciąża okna:** pierwsze przejście robi szybki skaner, a obserwator reaguje tylko na późniejsze zmiany (wcześniej przeglądał wszystkie pliki od nowa i wstrzymywał kolejkę miniatur na stałe).
- Od tej wersji wydanie zawiera tylko instalator (Setup).

### Nowe w wsq.24
- **Najpierw otwarty folder:** gdy trwa skanowanie / robienie miniatur, pliki z folderu lub widoku, który właśnie oglądasz (widok folderów, zakładka Foldery, filtr), są przesuwane na początek kolejki – i miniatury, i odczyt nowych plików. Działa też po każdej zmianie folderu w trakcie.

### Nowe w wsq.23
- **Okładki bieżącego widoku trzymane w pamięci:** po wejściu do folderu (lub zmianie filtra) program w tle wczytuje i dekoduje okładki (a bez okładki – miniatury) wszystkich filmów w widoku, do 2500, więc przy przewijaniu nie „wskakują”. Po zmianie widoku pamięć jest zwalniana z tych, których już nie ma.
- Galeria renderuje dodatkowo po 2 rzędy powyżej i poniżej ekranu.
- Rozmyta kopia okładki rysowana tylko wtedy, gdy okładka ma inne proporcje niż kafelek (lżejsze przewijanie).

### Nowe w wsq.22
- **Opóźnienie podglądu po najechaniu:** Ustawienia → Wygląd → „Opóźnienie podglądu po najechaniu” (0–1,5 s, domyślnie 0,25 s). Okładka zostaje, dopóki kursor nie postoi na filmie tyle czasu; potem rusza przewijanie klatek od miejsca, w którym jest kursor.

### Nowe w wsq.21
- Okno ustawień lżejsze dla karty graficznej: przyciemnienie tła bez rozmycia (wcześniej rozmyta warstwa wielokrotnie większa od okna), słabsze rozmycie samego okna. Mogło to zawieszać program przy zamykaniu ustawień.
- Suwaki w Ustawienia → Wygląd przeliczają galerię dopiero po puszczeniu suwaka (przy dużych hubach każde przesunięcie mroziło okno).

### Nowe w wsq.20
- Naprawione przyciski ─ ▢ ✕: po połączeniu paska tytułu z paskiem narzędzi obszar przeciągania okna przykrywał je i kliknięcia nie działały.

### Nowe w wsq.19
- **Okładka zawsze w całości** (jak w Ritt): nic nie jest przycinane; jeśli proporcje okładki różnią się od kafelka, wolne miejsce wypełnia rozmyta kopia okładki.
- **Koniec z białym błyskiem przy pasku przewijania:** cały dokument przechodzi w ciemny schemat (natywne paski, tło pod odświeżaniem), tory pasków przewijania są przezroczyste.

### Nowe w wsq.18
- **Własne ikony folderów w rozmiarze folderu:** przezroczyste marginesy ikony są obcinane, więc ikona zajmuje tyle miejsca co rysowany folder.
- **Podgląd w folderze:** najpierw okładka, potem miniatura; gdy pliku jeszcze nie ma (miniatury w trakcie robienia), bierze następny film, a po 15 s próbuje ponownie – zamiast białej kartki z pustym obrazkiem.
- **Pasek stanu pokazuje, ile zostało:** np. „Miniatury 120 / 11 110 · zostało 10 990 · ~1 h 20 min” (oraz „Odczyt plików …” przy imporcie). Dorabianie brakujących miniatur kolejkuje tylko pliki, którym naprawdę czegoś brakuje, więc liczby są prawdziwe.

### Nowe w wsq.17
- **Miniatury nie stają w połowie:** po otwarciu huba brakujące miniatury (np. po zamknięciu / aktualizacji programu w trakcie importu) są robione automatycznie. Kolejka nie zatrzymuje się już, gdy ffmpeg nie może wystartować, gdy folder/dysk jest niedostępny podczas skanowania ani na jednym uszkodzonym pliku (limit 10 min na plik).
- **Płynniejsze animacje bez jasnych błysków:** okno ustawień pojawia się jednym płynnym ruchem (wcześniej skakało), galeria, pasek tagów i okruszki zmieniają rozmiar od razu zamiast „pływać”, tło galerii nie miga na jasno, prawy panel i okienka wsuwają się delikatnie, ciemne paski przewijania.
- Okruszki w widoku folderów w ciemnym, płaskim stylu.

### Nowe w wsq.16
- Foldery w widoku folderów mają proporcje jak w Ritt (216 × 170, nie rozciągają się na szerokość kafelka); podgląd zajmuje górną część folderu, przednia klapka zaczyna się w połowie. Własna ikona z desktop.ini jest w tym samym prostokącie. Pod folderem są odznaki tagów folderu.

### Nowe w wsq.15
- Usunięty suwak „Rozmiar” z paska narzędzi – rozmiar miniatur zmienia Ctrl + kółko myszy nad galerią.

### Nowe w wsq.14
- **Widok folderów jak w Ritt:** przycisk z folderem w pasku narzędzi. Foldery wyglądają jak w Windows 11 – żółty folder z podglądem filmu w środku (po najechaniu przewija do 4 podglądów), liczba plików w rogu, nazwa pod spodem. Dwuklik wchodzi do folderu.
- **Własne ikony folderów:** jeśli folder ma `desktop.ini` z `IconResource`/`IconFile` wskazującym plik .ico / .png / .jpg, kafelek pokazuje tę ikonę. Ikony z .exe/.dll są pomijane. Odśwież (⟳) czyta ikony ponownie.
- W widoku folderów pasek tagów i liczniki w drzewie liczą pliki w folderach.
- Kod w lewym dolnym rogu miniatury pokazuje się tylko dla nazw w stylu JAV (np. PPPE-029) – zwykłe nazwy plików nie są tam wyświetlane; tokeny typu H265/X264 nie są brane za kod.

### Nowe w wsq.13
- **Strona „Ten HUB” od nowa:** karta huba, kafelki (pliki, foldery, łączny czas i rozmiar), lista folderów z filmami jako wiersze ze stanem (obserwowany / nieobserwowany / niepołączony), „Skanuj ponownie”, przełącznik Obserwuj i kosz (z potwierdzeniem) bez trybu „Edytuj foldery”; przycisk **Dodaj folder lub dysk**; statystyki w trzech kartach; serwer VHA Remote w osobnej karcie.

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
