// All site content lives here. Edit text, add projects, reorder — no build step needed.

const SITE = {
  name: "Luca Tomaselli",
  github: "https://github.com/LucaTommy",
  email: "lucatomaselli06@gmail.com",
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
  { n: "01", title: "Lego", line: "Technical drawing of a brick", term: "ws", pages: pages(WS, [1], "Lego brick technical drawing") },
  { n: "02", title: "La Tarsina", line: "Craft beer bottle & glass", term: "ws", pages: pages(WS, [2, 3, 4], "La Tarsina beer bottle and glass") },
  { n: "03", title: "Fountain Pen", line: "Two-for-one pen campaign", term: "ws", pages: pages(WS, [5, 6, 7], "Fountain pen") },
  { n: "04", title: "Chronograph", line: "Swiss watch, gold and lapis", term: "ws", pages: pages(WS, [8, 9, 10], "Chronograph watch") },
  { n: "05", title: "Aero 100", line: "Ergonomic office chair", term: "ws", pages: pages(WS, [11, 12, 13], "Ergonomic office chair") },
  { n: "06", title: "Citrus", line: "Lemon squeezer with pitcher", term: "ws", pages: pages(WS, [14, 15, 16], "Lemon squeezer") },
  { n: "F", title: "Metro-Cook", line: "Final — countertop microwave", term: "ws", final: true, pages: pages(WSF, [1, 2, 3], "Microwave") },
  { n: "01", title: "Curvature", line: "Spoons that bend to your will", term: "ss", pages: pages(SS, [1, 2, 3], "Curved spoons") },
  { n: "03", title: "L'Or", line: "Perfume bottle, perforated cap", term: "ss", pages: pages(SS, [4, 5, 6], "Perfume bottle") },
  { n: "04", title: "Amber Tower", line: "Modular stacking lamp", term: "ss", pages: pages(SS, [7, 8, 9], "Amber tower lamp") },
  { n: "05", title: "Ceiling", line: "Parametric ceiling installation", term: "ss", pages: pages(SS, [10, 11, 12], "Ceiling installation") },
  { n: "06", title: "Attractors", line: "Point-attractor wall pattern", term: "ss", pages: pages(SS, [13, 14, 15], "Attractor wall") },
  { n: "07", title: "Ambient", line: "Studio speaker", term: "ss", pages: pages(SS, [16, 17, 18], "Speaker") },
  { n: "08", title: "Laser", line: "Laser-cut pattern study", term: "ss", pages: pages(SS, [19], "Laser cut pattern") },
  { n: "F", title: "Arctic", line: "Final — bladeless air cooler", term: "ss", final: true, pages: pages(SSF, [1, 2, 3], "Air cooler") },
];

const PRODUCTS = [
  {
    id: "arco",
    ratio: "4 / 5",
    title: "Arco, in paper",
    kicker: "Product · unibz",
    text:
      "A study model of Achille Castiglioni's Arco lamp (1962), rebuilt at small scale from card. Perforated shade, the arc, and the heavy base block — re-engineered so a flat sheet can carry the same tension and balance.",
    tags: ["Cardboard", "Model making", "Reverse design"],
    images: [1965, 1966, 1971, 1979, 1982, 1983, 1984].map((n) =>
      img(`product-achille-castiglioni-arco-lamp/wup-documentazione${n}`, "Cardboard model of the Arco lamp")
    ),
  },
  {
    id: "chocolate",
    cutout: true, // transparent PNGs: show whole, no crop
    ratio: "5 / 4",
    title: "Hex Bar",
    kicker: "Product · unibz",
    text:
      "A chocolate bar you make yourself. A silicone mould of hexagonal cells — pour, set, snap. The packaging tray follows the same honeycomb.",
    tags: ["Mould", "Silicone", "Packaging"],
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
    title: "Filmclub Invite",
    kicker: "Typography · unibz",
    text:
      "A small folded programme for a week at the Filmclub in Bolzano. Stacked masthead, strict columns, three languages living on one grid.",
    tags: ["Editorial", "Grid", "Print"],
    images: [img("typo/film-invite/p01", "Filmclub programme outside"), img("typo/film-invite/p02", "Filmclub programme inside")],
  },
];

const SOS = [
  {
    id: "tuturama",
    title: "Tuturama",
    place: "Tuturano, Brindisi",
    text:
      "A 1-bit pixel adventure set in Tuturano: walk the village, find the bar, the castle and the people who live there. Made during Scuola Open Source.",
    tags: ["Game", "Pixel art"],
    images: [
      img("personal-sos-tuturano/tuturama", "Tuturama game map"),
      img("personal-sos-tuturano/tuturama-2", "Tuturama dialogue"),
    ],
    // a small side project, shown as a footnote under the main one
    extra: {
      title: "Galahouse",
      line: "Concept website for a small part of Tuturano — the old covered market.",
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
    text:
      "A poster maker for Loro Piceno: pick colours, gradients and pixel ornaments, type the date and place, export. So anyone in town can make a poster that still looks like it belongs to the same family.",
    tags: ["Tool", "Generative", "Poster"],
    images: [img("personal-sos-loro-piceno/luce-poster-maker", "Luce poster maker interface")],
  },
];

const TOOLS = [
  { title: "Palette Pro", line: "Library of palettes with HSL editing and a pro editor.", images: [img("personal-tools/palette-pro"), img("personal-tools/palette-pro-2")] },
  { title: "Palette Studio", line: "Generate, lock what you like, export. Colours in seconds.", images: [img("personal-tools/palette-studio")] },
  { title: "PDF Editor", line: "Every PDF tool, running privately in the browser.", images: [img("personal-tools/pdf-editor")] },
  { title: "QR Forge", line: "QR codes for links, Wi-Fi, vCards — custom dots, logo, SVG.", images: [img("personal-tools/qr-generator")] },
  { title: "CV Maker", line: "Fill a form, watch the résumé lay itself out, export.", images: [img("personal-tools/cv-maker")] },
  { title: "Reader", line: "Videos, websites, audio — turned into something to read.", images: [img("personal-tools/reader")] },
  { title: "Sprite Editor", line: "Pixel-art sprites and frame animation for my games.", images: [img("personal-tools/sprouteeditor")] },
  { title: "Grain", line: "Layer noise and textures over photos, non-destructively.", images: [img("personal-tools/texture-editor")] },
];

// 3D models on the print bed. Put an STL in Models/, run tools/build_assets.py, add a line here.
const MODELS = [
  { name: "3DBenchy", file: "assets/models/benchy.glb", credit: "3DBenchy by Creative Tools · CC BY-ND 4.0", layer: 0.2 },
];
