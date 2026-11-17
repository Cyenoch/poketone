import argparse
import hashlib
import io
import json
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image

from spatial_bake import bake_region, image_rgb, shader, smooth, uv_mask

ASSETS = Path(__file__).resolve().parent
ROOT = ASSETS.parent.parent
MODELS = ROOT / "public" / "models"


def bake(image, palette, recipe, xyz, texcoords):
    if "skinValue" in recipe:
        rgb, hue, sat = shader(image, palette)
        weight = smooth(.30, .60, sat) * (1 - smooth(30, 43, hue))
        rgb *= (1 + weight * (recipe["skinValue"] - 1))[:, :, None]
        recolor = image_rgb(rgb)
        recolor.paste(image, mask=uv_mask(xyz, texcoords, image.size, recipe["keepSide"]))
        return recolor

    def waterpass(swaps):
        return image_rgb(shader(image, {"swaps": swaps})[0])

    blue, shell = palette["swaps"][0], palette["swaps"][-1]
    belly = [recipe["bellySwap"]] if "bellySwap" in recipe else []
    recolor = waterpass([blue, *belly])
    recolor.paste(
        waterpass([blue, shell]), mask=uv_mask(xyz, texcoords, image.size, recipe["shellSide"]),
    )
    for points in recipe.get("tailEarSide", []):
        recolor.paste(
            waterpass([palette["swaps"][1], *belly]),
            mask=uv_mask(xyz, texcoords, image.size, points),
        )
    return recolor


def main():
    parser = argparse.ArgumentParser(description="Bake same-UV shiny baseColor maps from production GLBs.")
    parser.add_argument("output_root", type=Path)
    output = parser.parse_args().output_root.resolve()
    recipes = json.loads((ASSETS / "texture-recipes.json").read_text())["forms"]
    palette_export = subprocess.run([
        "bun", "-e",
        'import {shinyPalettes} from "./src/run/view/shiny.ts";'
        'console.log(JSON.stringify(shinyPalettes))',
    ], cwd=ROOT, check=True, stdout=subprocess.PIPE)
    palettes = json.loads(palette_export.stdout)
    models = {form: MODELS / f"{form}.glb" for form in recipes}
    manifest = {
        form: {"modelSha256": hashlib.sha256(model.read_bytes()).hexdigest()}
        for form, model in models.items()
    }
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output) as scratch_dir:
        scratch = Path(scratch_dir)
        subprocess.run([
            "blender", "-b", "--factory-startup", "--python-exit-code", "1",
            "-P", ASSETS / "extract-rest-uv.py", "--", scratch, *models.values(),
        ], check=True)
        for form, recipe in recipes.items():
            print(f"Baking {form}", flush=True)
            candidate = scratch / f"{form}-baseColor.png"
            with np.load(scratch / f"{form}.npz") as data:
                with Image.open(io.BytesIO(data["image"].tobytes())) as source:
                    image = source.convert("RGB")
                if recipe.get("bakedPortrait"):
                    baked = bake_region(form, image, recipe, palettes[form], (data["xyz"], data["uv"]))
                else:
                    baked = bake(image, palettes[form], recipe, data["xyz"], data["uv"])
                baked.save(candidate)
            if recipe.get("bakedPortrait"):
                source_path = ROOT / "public/art/portraits" / f"{form}.webp"
                source_bytes = source_path.read_bytes()
                with Image.open(io.BytesIO(source_bytes)) as portrait:
                    if portrait.size != (320, 320) or "A" not in portrait.getbands():
                        raise ValueError(f"{source_path}: expected a 320×320 portrait with alpha")
                    baked = bake_region(form, portrait.convert("RGB"), recipe, palettes[form])
                    baked.putalpha(portrait.getchannel("A"))
                target = scratch / f"{form}-portrait.webp"
                baked.save(target, lossless=True)
                manifest[form].update(
                    portraitSourceSha256=hashlib.sha256(source_bytes).hexdigest(),
                    portraitSha256=hashlib.sha256(target.read_bytes()).hexdigest(),
                )
            manifest[form]["candidateSha256"] = hashlib.sha256(candidate.read_bytes()).hexdigest()

        candidates = output / "candidates"
        candidates.mkdir(exist_ok=True)
        verification = scratch / "verification.json"
        verification.write_text(json.dumps(manifest, indent=2) + "\n")
        for form in recipes:
            filename = f"{form}-baseColor.png"
            (scratch / filename).replace(candidates / filename)
            if recipes[form].get("bakedPortrait"):
                portrait = f"{form}-portrait.webp"
                (scratch / portrait).replace(candidates / portrait)
        verification.replace(output / verification.name)
    print(json.dumps({"outputRoot": str(output), "forms": list(manifest)}))


if __name__ == "__main__":
    main()
