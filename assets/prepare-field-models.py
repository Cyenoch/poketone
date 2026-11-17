"""Publish only named field assets through the shared game-model pipeline.

blender -b --factory-startup --python-exit-code 1 -P assets/prepare-field-models.py -- NAME ...
GAME_MODELS_OUT stages candidates with the same relative output paths as public/models.
The shared registry and build log remain owned by the integration task.
"""
import importlib.util
import json
import sys
from pathlib import Path

ASSETS = Path(__file__).resolve().parent


def main():
    names = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not names:
        raise ValueError("Name the field assets to build; an implicit full rebuild is not supported")
    catalog = json.loads((ASSETS / "field-models.provenance.json").read_text())["models"]
    for name in names:
        if name not in catalog or not catalog[name].get("build"):
            raise ValueError(f"{name}: no publishable source registered")
    spec = importlib.util.spec_from_file_location("game_models", ASSETS / "prepare-game-models.py")
    pipeline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pipeline)
    for name in names:
        pipeline.MODELS[name] = tuple(catalog[name]["build"])
        if catalog[name].get("weldDecimationSeams"):
            pipeline.SEAM_REPAIRS.add(name)
        print(json.dumps(pipeline.build(name), ensure_ascii=False))


if __name__ == "__main__":
    main()
