"""Turn the raw files in Works/ into light web assets in assets/.

Run:  python tools/build_assets.py
Needs: pip install pymupdf rawpy pillow trimesh fast-simplification
"""
import io
import re
from pathlib import Path

import numpy
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
TOOLHEADS = {"Nozzle": 30000}  # STLs that are printer heads, not prints (name: triangle budget)


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


def both(img, folder, name):
    """Write name.webp (large, for the viewer) and name-sm.webp (grid)."""
    save(img, OUT / folder / f"{name}.webp", FULL_W)
    save(img, OUT / folder / f"{name}-sm.webp", THUMB_W)


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
    """Render every page as p01, p02, ..."""
    doc = pymupdf.open(pdf)
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=110)
        both(Image.frombytes("RGB", (pix.width, pix.height), pix.samples), folder, f"p{i + 1:02d}")
    print("pdf", pdf.name, len(doc))


def main():
    # CAD books: one folder per PDF
    for pdf in sorted((WORKS / "Cad").glob("*.pdf")):
        pdf_pages(pdf, f"cad/{slug(pdf.stem)}")

    pdf_pages(WORKS / "Typography" / "Film Invite.pdf", "typo/film-invite")

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
        for f in files:
            both(open_any(f), slug(folder), slug(f.stem))
        print("img", folder, len(files))

    # 3D models for the print bed: STL in, light GLB out (centred on the bed, sitting on Z=0)
    for stl in sorted(ROOT.glob("Models/*.stl")):
        mesh = trimesh.load(stl)
        head = stl.stem in TOOLHEADS
        limit = TOOLHEADS.get(stl.stem, MAX_FACES)
        if len(mesh.faces) > limit:
            mesh = mesh.simplify_quadric_decimation(face_count=limit)
        lo, hi = mesh.bounds
        if head:
            # toolhead: nozzle tip (lowest point) at the origin; brass tip, light grey body
            tip = mesh.vertices[mesh.vertices[:, 2].argmin()]
            mesh.apply_translation(-tip)
            brass = mesh.vertices[:, 2] < 7
            colours = numpy.where(brass[:, None], [212, 166, 74, 255], [214, 216, 220, 255]).astype(numpy.uint8)
            mesh.visual = trimesh.visual.ColorVisuals(mesh, vertex_colors=colours)
        else:
            mesh.apply_translation([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])
        dest = OUT / "models" / f"{slug(stl.stem)}.glb"
        dest.parent.mkdir(parents=True, exist_ok=True)
        mesh.export(dest)
        print("model", stl.name, len(mesh.faces), "faces", dest.stat().st_size // 1024, "KB")

    both(Image.open(ROOT / "PFP.png"), "me", "portrait")
    both(Image.open(ROOT / "Banner.png"), "me", "banner")


if __name__ == "__main__":
    main()
