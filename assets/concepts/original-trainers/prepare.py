"""Publish each summer trainer's lobby, cut-in and portrait from one transparent source."""

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
PUBLIC = REPO / "public" / "art" / "trainers"
GENERATION = ROOT / "runtime-summer-v2-generation.json"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean_alpha(image: Image.Image) -> Image.Image:
    """Cel art is opaque: retain a one-pixel antialiased edge, discard generated background haze."""
    alpha = image.getchannel("A")
    core = alpha.point(lambda a: 255 if a >= 224 else 0)
    mask = ImageChops.multiply(alpha, core.filter(ImageFilter.MaxFilter(3)))
    mask = mask.point(lambda a: 0 if a < 16 else 255 if a >= 224 else a)
    result = Image.new("RGBA", image.size)
    source, target, opaque, coverage = image.load(), result.load(), core.load(), mask.load()
    neighbors = ((0, -1), (-1, 0), (1, 0), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1))
    for y in range(image.height):
        for x in range(image.width):
            a = coverage[x, y]
            if not a:
                continue
            if a == 255:
                target[x, y] = (*source[x, y][:3], a)
                continue
            # Edge RGB may still contain the discarded backdrop; bleed the nearest solid ink.
            for dx, dy in neighbors:
                nx, ny = x + dx, y + dy
                if 0 <= nx < image.width and 0 <= ny < image.height and opaque[nx, ny]:
                    target[x, y] = (*source[nx, ny][:3], a)
                    break
            else:
                raise ValueError(f"No foreground colour for edge pixel {x}, {y}")
    return result


for request in json.loads(GENERATION.read_text())["requests"]:
    source = ROOT / request["output"]
    image = Image.open(source)
    if image.mode != "RGBA" or image.getchannel("A").getextrema()[0] != 0:
        raise ValueError(f"Expected a real transparent RGBA source: {source}")
    if image.getchannel("A").getextrema()[1] < 248:
        raise ValueError(f"Expected an opaque character in source: {source}")
    image = clean_alpha(image)
    clean_source = source.with_stem(source.stem + "-clean")
    image.save(clean_source)
    crops = {"lobby": image.getchannel("A").getbbox(), **request["crops"]}
    target = PUBLIC / request["id"]
    target.mkdir(parents=True, exist_ok=True)
    entries = []
    for name, box in crops.items():
        if not box or not (0 <= box[0] < box[2] <= image.width and 0 <= box[1] < box[3] <= image.height):
            raise ValueError(f"Invalid {name} crop {box} for {source}")
        cutout = image.crop(box)
        size = {"lobby": 1400, "cutin": 768, "portrait": 256}[name]
        cutout.thumbnail((size if name == "lobby" else size - 8,) * 2, Image.Resampling.LANCZOS)
        if name != "lobby":
            canvas = Image.new("RGBA", (size, size))
            canvas.alpha_composite(cutout, ((size - cutout.width) // 2, size - cutout.height - 4))
            cutout = canvas
        variants = {name: cutout}
        if request.get("silhouette") and name in ("lobby", "portrait"):
            silhouette = Image.new("RGBA", cutout.size, "#142f50")
            silhouette.putalpha(cutout.getchannel("A"))
            variants[f"{name}-locked"] = silhouette
        for variant, pixels in variants.items():
            visible = pixels.getchannel("A").point(lambda a: 255 if a else 0)
            pixels = Image.composite(pixels, Image.new("RGBA", pixels.size), visible)
            output = target / f"{variant}.webp"
            pixels.save(output, "WEBP", lossless=True, exact=True)
            assert pixels.getchannel("A").getextrema() == (0, 255), output
            entries.append({"file": output.name, "crop": box, "size": pixels.size, "sha256": sha(output)})
    (target / "provenance.json").write_text(json.dumps({
        "styleVersion": "trainer-cel-summer-v2",
        "source": str(source.relative_to(REPO)),
        "sourceSha256": sha(source),
        "cleanSource": str(clean_source.relative_to(REPO)),
        "cleanSourceSha256": sha(clean_source),
        "generation": str(GENERATION.relative_to(REPO)),
        "requestId": request["id"],
        "process": "prepare.py: alpha >= 224 is opaque core; retain source alpha only within its 1px dilation, discard alpha < 16; edge RGB from nearest opaque neighbor; save clean PNG; lobby alpha bbox; authored cut-in/head crops; Lanczos resize; square bottom padding for cut-in/portrait; #142f50 silhouettes retain alpha; RGB cleared under alpha 0; lossless WebP",
        "outputs": entries,
    }, ensure_ascii=False, indent=2) + "\n")
    print(f"{request['id']}: {len(entries)} outputs from {image.size}")
