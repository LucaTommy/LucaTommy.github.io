# Luca Tomaselli — Portfolio

Static site: plain HTML, CSS and JS. No build step, hosted on GitHub Pages.

- `index.html` — page structure
- `css/style.css` — all styles (colours and fonts at the top)
- `js/data.js` — **all the content**: projects, texts, images. Edit this to add or change work.
- `js/main.js` — animations, gallery viewer
- `assets/` — optimized images (generated)

## Adding new work

1. Put the original files in `Works/` (this folder is not uploaded to GitHub).
2. Regenerate images: `pip install pymupdf rawpy pillow` once, then `python tools/build_assets.py`
3. Add an entry in `js/data.js`.

## Adding a 3D model to the print bed

Put the `.stl` in `Models/`, run `python tools/build_assets.py`, then add it to `MODELS` in `js/data.js`.

## Preview locally

`python -m http.server 8000` then open http://localhost:8000
