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

## Security notes

- Everything is self-hosted (`vendor/` holds three.js and the fonts), so the site loads nothing from other servers.
- `index.html` has a Content-Security-Policy that only allows the site's own files. The inline `importmap` is allowed by its SHA-256 hash: if you ever edit it, recompute the hash with
  `node -e "const s=require('fs').readFileSync('index.html','utf8');console.log('sha256-'+require('crypto').createHash('sha256').update(s.match(/<script type=\"importmap\">([\s\S]*?)<\/script>/)[1]).digest('base64'))"`
  and replace the `sha256-…` value in the CSP line.
- Want to load something from another site (an embed, analytics)? Its domain has to be added to the CSP first.

## After changing CSS or JS

Bump the `?v=` number on the `<link>` and `<script>` tags at the bottom/top of `index.html`, so visitors don't get an old cached file mixed with new ones.
