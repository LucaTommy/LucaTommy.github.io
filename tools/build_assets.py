"""Turn the raw files in Works/ into light web assets in assets/.

Run:  python tools/build_assets.py
Needs: pip install pymupdf rawpy pillow trimesh fast-simplification
"""
import io
import json
import re
from pathlib import Path

import pymupdf
import rawpy
import trimesh
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
WORKS = ROOT / "Works"
OUT = ROOT / "assets"

FULL_W = 1400   # width of large images (lightbox)
THUMB_W = 640   # width of grid images
MAX_FACES = 60000  # triangles per 3D model, keeps each file well under 1 MB


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def save(img, dest, width):
    img = ImageOps.exif_transpose(img)
    # keep transparency for cut-out PNGs, flatten everything else
    transparent = "A" in img.getbands() and img.getchannel("A").getextrema()[0] < 255
    img = img.convert("RGBA" if transparent else "RGB")
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, "WEBP", quality=80, method=6)
    return img.size


def both(img, folder, name):
    w, h = save(img, OUT / folder / f"{name}.webp", FULL_W)
    save(img, OUT / folder / f"{name}-sm.webp", THUMB_W)
    return {"src": f"assets/{folder}/{name}.webp", "sm": f"assets/{folder}/{name}-sm.webp", "w": w, "h": h}


def open_any(path):
    try:
        img = Image.open(path)
        img.load()
        return img
    except Exception:
        pass
    # Some cameras' RAW files libraw can't decode: use the embedded JPEG preview instead
    try:
        with rawpy.imread(str(path)) as raw:
            return Image.fromarray(raw.postprocess(use_camera_wb=True, half_size=True))
    except rawpy.LibRawError:
        with rawpy.imread(str(path)) as raw:
            return Image.open(io.BytesIO(raw.extract_thumb().data))


def pdf_pages(pdf, folder):
    """Render every page; label each with the exercise title found on it (e.g. '03. Pen')."""
    doc = pymupdf.open(pdf)
    pages = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=110)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        entry = both(img, folder, f"p{i + 1:02d}")
        text = page.get_text()
        found = re.findall(r"(\d\d\. [A-Z][A-Za-z ]+|Final[ -]+[A-Za-z ]+)", text)
        entry["label"] = found[-1].strip() if found else ""
        pages.append(entry)
    return pages


def main():
    manifest = {}

    # CAD books: one folder per PDF
    for pdf in sorted((WORKS / "Cad").glob("*.pdf")):
        key = slug(pdf.stem)
        manifest[key] = pdf_pages(pdf, f"cad/{key}")
        print("pdf", pdf.name, len(manifest[key]))

    manifest["film-invite"] = pdf_pages(WORKS / "Typography" / "Film Invite.pdf", "typo/film-invite")

    # Plain image folders
    for folder in [
        "Product/Achille Castiglioni Arco Lamp",
        "Product/Chocolate",
        "Personal/SOS/Tuturano",
        "Personal/SOS/Loro Piceno",
        "Personal/Tools",
        "Hobby",
    ]:
        files = sorted(p for p in (WORKS / folder).iterdir()
                       if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".nef"})
        key = slug(folder.split("/")[-1])
        manifest[key] = []
        for f in files:
            entry = both(open_any(f), slug(folder), slug(f.stem))
            entry["name"] = f.stem
            manifest[key].append(entry)
        print("img", folder, len(files))

    # 3D models for the print bed: STL in, light GLB out (centred on the bed, sitting on Z=0)
    for stl in sorted(ROOT.glob("Models/*.stl")):
        mesh = trimesh.load(stl)
        if len(mesh.faces) > MAX_FACES:
            mesh = mesh.simplify_quadric_decimation(face_count=MAX_FACES)
        lo, hi = mesh.bounds
        mesh.apply_translation([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])
        dest = OUT / "models" / f"{slug(stl.stem)}.glb"
        dest.parent.mkdir(parents=True, exist_ok=True)
        mesh.export(dest)
        print("model", stl.name, len(mesh.faces), "faces", dest.stat().st_size // 1024, "KB")

    manifest["me"] = [both(Image.open(ROOT / "PFP.png"), "me", "portrait"),
                      both(Image.open(ROOT / "Banner.png"), "me", "banner")]

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
