// All site content lives here. Edit text, add projects, reorder — no build step needed.
// Translated text is written as L(english, italiano, deutsch). Interface strings are in i18n.js.

const L = (en, it, de) => ({ en, it, de });

const SITE = {
  name: "Luca Tomaselli",
  github: "https://github.com/LucaTommy",
  // split so simple spam bots scanning the source don't find the address; joined in main.js
  email: ["lucatomaselli06", "gmail.com"],
  instagram: "", // optional
  linkedin: "https://www.linkedin.com/in/luca-tomaselli-1206043a8/",
};

// Image helper: every asset exists as name.webp (large) and name-sm.webp (grid)
const img = (path, alt = "") => ({ src: `assets/${path}.webp`, sm: `assets/${path}-sm.webp`, alt });
const pages = (book, list, alt) => list.map((n) => img(`cad/${book}/p${String(n).padStart(2, "0")}`, alt));

const SS = "ss-2026-tomaselli-luca";
const SSF = "ss-2026-tomaselli-luca-final";
const WS = "ws-2025-26-tomaselli-luca";
const WSF = "ws-2025-26-tomaselli-luca-final";

// Drawing 3D CAD — each exercise: an ad poster + the model sheet
const CAD = [
  { n: "01", title: "Lego", line: L("Technical drawing of a brick", "Disegno tecnico di un mattoncino", "Technische Zeichnung eines Steins"), term: "ws", pages: pages(WS, [1], "Lego brick technical drawing") },
  { n: "02", title: "La Tarsina", line: L("Craft beer bottle & glass", "Bottiglia e bicchiere di birra artigianale", "Craft-Beer-Flasche & Glas"), term: "ws", pages: pages(WS, [2, 3, 4], "La Tarsina beer bottle and glass") },
  { n: "03", title: L("Fountain Pen", "Stilografica", "Füllfederhalter"), line: L("Two-for-one pen campaign", "Campagna penna due per uno", "Zwei-für-eins-Kampagne"), term: "ws", pages: pages(WS, [5, 6, 7], "Fountain pen") },
  { n: "04", title: L("Chronograph", "Cronografo", "Chronograph"), line: L("Swiss watch, gold and lapis", "Orologio svizzero, oro e lapislazzuli", "Schweizer Uhr, Gold und Lapis"), term: "ws", pages: pages(WS, [8, 9, 10], "Chronograph watch") },
  { n: "05", title: "Aero 100", line: L("Ergonomic office chair", "Sedia da ufficio ergonomica", "Ergonomischer Bürostuhl"), term: "ws", pages: pages(WS, [11, 12, 13], "Ergonomic office chair") },
  { n: "06", title: "Citrus", line: L("Lemon squeezer with pitcher", "Spremiagrumi con brocca", "Zitruspresse mit Kanne"), term: "ws", pages: pages(WS, [14, 15, 16], "Lemon squeezer") },
  { n: "F", title: "Metro-Cook", line: L("Final — countertop microwave", "Finale — forno a microonde", "Final — Mikrowelle"), term: "ws", final: true, pages: pages(WSF, [1, 2, 3], "Microwave") },
  { n: "01", title: "Curvature", line: L("Spoons that bend to your will", "Cucchiai che si piegano al tuo volere", "Löffel, die sich deinem Willen beugen"), term: "ss", pages: pages(SS, [1, 2, 3], "Curved spoons") },
  { n: "03", title: "L'Or", line: L("Perfume bottle, perforated cap", "Flacone di profumo, tappo traforato", "Parfümflakon mit gelochter Kappe"), term: "ss", pages: pages(SS, [4, 5, 6], "Perfume bottle") },
  { n: "04", title: "Amber Tower", line: L("Modular stacking lamp", "Lampada modulare impilabile", "Modulare Stapelleuchte"), term: "ss", pages: pages(SS, [7, 8, 9], "Amber tower lamp") },
  { n: "05", title: L("Ceiling", "Soffitto", "Decke"), line: L("Parametric ceiling installation", "Installazione parametrica a soffitto", "Parametrische Deckeninstallation"), term: "ss", pages: pages(SS, [10, 11, 12], "Ceiling installation") },
  { n: "06", title: L("Attractors", "Attrattori", "Attraktoren"), line: L("Point-attractor wall pattern", "Parete con pattern ad attrattori", "Wandmuster mit Punkt-Attraktoren"), term: "ss", pages: pages(SS, [13, 14, 15], "Attractor wall") },
  { n: "07", title: "Ambient", line: L("Studio speaker", "Cassa da studio", "Studiolautsprecher"), term: "ss", pages: pages(SS, [16, 17, 18], "Speaker") },
  { n: "08", title: "Laser", line: L("Laser-cut pattern study", "Studio di pattern per taglio laser", "Musterstudie für den Laserschnitt"), term: "ss", pages: pages(SS, [19], "Laser cut pattern") },
  { n: "F", title: "Arctic", line: L("Final — bladeless air cooler", "Finale — raffrescatore senza pale", "Final — flügelloser Luftkühler"), term: "ss", final: true, pages: pages(SSF, [1, 2, 3], "Air cooler") },
];

const PRODUCTS = [
  {
    id: "arco",
    ratio: "4 / 5",
    title: L("Arco, in paper", "Arco, di carta", "Arco aus Papier"),
    kicker: L("Product · unibz", "Prodotto · unibz", "Produkt · unibz"),
    text: L(
      "A study model of Achille Castiglioni's Arco lamp (1962), rebuilt at small scale from card. Perforated shade, the arc, and the heavy base block — re-engineered so a flat sheet can carry the same tension and balance.",
      "Un modello di studio della lampada Arco di Achille Castiglioni (1962), ricostruita in piccola scala con il cartoncino. Il paralume forato, l'arco e il pesante blocco di base — riprogettati perché un foglio piatto regga la stessa tensione e lo stesso equilibrio.",
      "Ein Studienmodell von Achille Castiglionis Arco-Leuchte (1962), im kleinen Maßstab aus Karton nachgebaut. Gelochter Schirm, der Bogen und der schwere Sockel — so umkonstruiert, dass ein flacher Bogen dieselbe Spannung und Balance trägt."
    ),
    tags: [L("Cardboard", "Cartone", "Karton"), L("Model making", "Modellismo", "Modellbau"), L("Reverse design", "Reverse design", "Reverse Design")],
    images: [1965, 1966, 1971, 1979, 1982, 1983, 1984].map((n) =>
      img(`product-achille-castiglioni-arco-lamp/wup-documentazione${n}`, "Cardboard model of the Arco lamp")
    ),
  },
  {
    id: "chocolate",
    cutout: true, // transparent PNGs: show whole, no crop
    ratio: "5 / 4",
    title: "Hex Bar",
    kicker: L("Product · unibz", "Prodotto · unibz", "Produkt · unibz"),
    text: L(
      "A chocolate bar you make yourself. A silicone mould of hexagonal cells — pour, set, snap. The packaging tray follows the same honeycomb.",
      "Una tavoletta di cioccolato da fare da sé. Uno stampo in silicone a celle esagonali — versa, lascia solidificare, spezza. Anche la confezione segue lo stesso nido d'ape.",
      "Eine Schokoladentafel zum Selbermachen. Eine Silikonform mit Sechseckzellen — gießen, fest werden lassen, abbrechen. Die Verpackung folgt derselben Wabe."
    ),
    tags: [L("Mould", "Stampo", "Gussform"), L("Silicone", "Silicone", "Silikon"), L("Packaging", "Packaging", "Verpackung")],
    images: [
      img("product-chocolate/meme4", "Hexagonal chocolate bar close up"),
      img("product-chocolate/meme", "Hexagonal chocolate bar"),
      img("product-chocolate/meme3", "Silicone hexagonal mould"),
      img("product-chocolate/meme2", "Chocolate bar in its box"),
    ],
  },
  {
    id: "filmclub",
    ratio: "1287 / 910",
    title: L("Filmclub Invite", "Invito Filmclub", "Filmclub-Einladung"),
    kicker: L("Typography · unibz", "Tipografia · unibz", "Typografie · unibz"),
    text: L(
      "A small folded programme for a week at the Filmclub in Bolzano. Stacked masthead, strict columns, three languages living on one grid.",
      "Un piccolo programma pieghevole per una settimana al Filmclub di Bolzano. Testata impilata, colonne rigorose, tre lingue che convivono sulla stessa griglia.",
      "Ein kleines gefaltetes Programm für eine Woche im Filmclub Bozen. Gestapelter Titel, strenge Spalten, drei Sprachen auf einem Raster."
    ),
    tags: [L("Editorial", "Editoria", "Editorial"), L("Grid", "Griglia", "Raster"), L("Print", "Stampa", "Druck")],
    images: [img("typo/film-invite/p01", "Filmclub programme outside"), img("typo/film-invite/p02", "Filmclub programme inside")],
  },
];

const SOS = [
  {
    id: "tuturama",
    title: "Tuturama",
    place: "Tuturano, Brindisi",
    play: "/Tuturama/", // the game itself, served from its own repo on the same domain
    text: L(
      "A 1-bit pixel adventure set in Tuturano: walk the village, find the bar, the castle and the people who live there. Made during Scuola Open Source.",
      "Un'avventura in pixel art a 1 bit ambientata a Tuturano: gira per il paese, trova il bar, il castello e le persone che ci vivono. Realizzato durante Scuola Open Source.",
      "Ein 1-Bit-Pixel-Abenteuer in Tuturano: Lauf durchs Dorf, finde die Bar, das Schloss und die Menschen, die dort leben. Entstanden bei der Scuola Open Source."
    ),
    tags: [L("Game", "Gioco", "Spiel"), "Pixel art"],
    images: [
      img("personal-sos-tuturano/tuturama", "Tuturama game map"),
      img("personal-sos-tuturano/tuturama-2", "Tuturama dialogue"),
    ],
    // a small side project, shown as a footnote under the main one
    extra: {
      title: "Galahouse",
      line: L(
        "Concept website for a small part of Tuturano — the old covered market.",
        "Sito concept per una piccola parte di Tuturano — il vecchio mercato coperto.",
        "Konzept-Website für einen kleinen Teil von Tuturano — die alte Markthalle."
      ),
      images: [
        img("personal-sos-tuturano/concept-galahouse", "Galahouse website hero"),
        img("personal-sos-tuturano/concept-galahouse2", "Galahouse website about"),
      ],
    },
  },
  {
    id: "luce",
    title: "Luce",
    place: "Loro Piceno, Marche",
    text: L(
      "A poster maker for Loro Piceno: pick colours, gradients and pixel ornaments, type the date and place, export. So anyone in town can make a poster that still looks like it belongs to the same family.",
      "Un generatore di poster per Loro Piceno: scegli colori, sfumature e ornamenti in pixel, scrivi data e luogo, esporta. Così chiunque in paese può fare un poster che sembra comunque della stessa famiglia.",
      "Ein Plakat-Generator für Loro Piceno: Farben, Verläufe und Pixel-Ornamente wählen, Datum und Ort eintippen, exportieren. So kann jeder im Ort ein Plakat machen, das trotzdem zur selben Familie gehört."
    ),
    tags: [L("Tool", "Strumento", "Tool"), L("Generative", "Generativo", "Generativ"), L("Poster", "Poster", "Plakat")],
    images: [img("personal-sos-loro-piceno/luce-poster-maker", "Luce poster maker interface")],
  },
];

const TOOLS = [
  { title: "Palette Pro", line: L("Library of palettes with HSL editing and a pro editor.", "Libreria di palette con modifica HSL e un editor pro.", "Paletten-Bibliothek mit HSL-Bearbeitung und Profi-Editor."), images: [img("personal-tools/palette-pro"), img("personal-tools/palette-pro-2")] },
  { title: "Palette Studio", line: L("Generate, lock what you like, export. Colours in seconds.", "Genera, blocca quello che ti piace, esporta. Colori in pochi secondi.", "Generieren, Lieblingsfarben fixieren, exportieren. Farben in Sekunden."), images: [img("personal-tools/palette-studio")] },
  { title: "PDF Editor", line: L("Every PDF tool, running privately in the browser.", "Tutti gli strumenti PDF, in privato nel browser.", "Alle PDF-Werkzeuge, privat im Browser."), images: [img("personal-tools/pdf-editor")] },
  { title: "QR Forge", line: L("QR codes for links, Wi-Fi, vCards — custom dots, logo, SVG.", "QR code per link, Wi-Fi, vCard — punti personalizzati, logo, SVG.", "QR-Codes für Links, WLAN, vCards — eigene Punkte, Logo, SVG."), images: [img("personal-tools/qr-generator")] },
  { title: "CV Maker", line: L("Fill a form, watch the résumé lay itself out, export.", "Compila un modulo, guarda il curriculum impaginarsi da solo, esporta.", "Formular ausfüllen, zusehen, wie sich der Lebenslauf selbst setzt, exportieren."), images: [img("personal-tools/cv-maker")] },
  { title: "Reader", line: L("Videos, websites, audio — turned into something to read.", "Video, siti, audio — trasformati in qualcosa da leggere.", "Videos, Websites, Audio — verwandelt in etwas zum Lesen."), images: [img("personal-tools/reader")] },
  { title: "Sprite Editor", line: L("Pixel-art sprites and frame animation for my games.", "Sprite in pixel art e animazioni frame per frame per i miei giochi.", "Pixel-Art-Sprites und Frame-Animationen für meine Spiele."), images: [img("personal-tools/sprouteeditor")] },
  { title: "Grain", line: L("Layer noise and textures over photos, non-destructively.", "Rumore e texture sulle foto, senza toccare l'originale.", "Rauschen und Texturen über Fotos legen, ohne das Original zu verändern."), images: [img("personal-tools/texture-editor")] },
];

// 3D models on the print bed. Put an STL in Models/, run tools/build_assets.py, add a line here.
const MODELS = [
  { name: "3DBenchy", file: "assets/models/benchy.glb", credit: "3DBenchy by Creative Tools · CC BY-ND 4.0", layer: 0.2 },
];
