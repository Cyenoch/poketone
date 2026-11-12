"""Publishing a baked UI font set (atlas.py) into its directory, and pruning old publishes.

Publishing never deletes: the files of the last RETAINED publishes stay, so a page open across
local or concurrent rebuilds can still fetch what its manifest names (deploys carry only the
current release; docs/fonts-paging-design.md, Known limitation). `prune` removes the rest.

  python scripts/fonts/publish.py <set dir> 1    # keep only the current publish (before a commit)
"""

import fcntl
import json
import os
from pathlib import Path
import sys
import uuid

RETAINED = 3


def _lock(output):
    """The publication lock, beside (not inside) the set, held for the whole install + manifest
    swap + prune. A second build waits for the first instead of interleaving with it."""
    output.parent.mkdir(parents=True, exist_ok=True)
    lock = open(output.parent / f".{output.name}.lock", "w")
    fcntl.flock(lock, fcntl.LOCK_EX)
    return lock


def _install(source, target):
    """Copies a file in under a temporary name unique to this process, then renames it into place."""
    temporary = target.with_name(f".{target.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    temporary.write_bytes(source.read_bytes())
    os.replace(temporary, target)


def publish(staging, manifest, output):
    """Swaps the new set in only once every page is baked: the content-named files land beside the
    old ones, then the manifest that points at them replaces the old one in a single rename. A
    failed or interrupted build leaves the previous, complete set in place. Nothing is deleted
    here; `releases.json` records the files of the last RETAINED publishes, and `prune` (run after
    publishing, still under the lock) removes only files none of those names."""
    with _lock(output):
        output.mkdir(parents=True, exist_ok=True)
        for path in staging.iterdir():
            if not (output / path.name).exists():
                _install(path, output / path.name)
        releases_file = output / "releases.json"
        releases = json.loads(releases_file.read_text()) if releases_file.exists() else []
        files = sorted(named_files(manifest, staging))
        releases = [files] + [release for release in releases if release != files]
        pending = staging / "releases.json"
        pending.write_text(json.dumps(releases[:RETAINED], indent=1) + "\n")
        _install(pending, releases_file)
        pending = staging / "manifest.json"
        pending.write_text(json.dumps(with_bytes(manifest, staging), ensure_ascii=False, indent=2) + "\n")
        _install(pending, output / "manifest.json")
        prune(output)


def with_bytes(manifest, staging):
    """Each font's json and page byte sizes: the loader's progress totals (bytesTotal) come from
    the manifest, never from guesses."""
    for entry in manifest.values():
        if isinstance(entry, dict) and "json" in entry:
            pages = json.loads((staging / entry["json"]).read_text())["pages"]
            entry["jsonBytes"] = (staging / entry["json"]).stat().st_size
            entry["pageBytes"] = [(staging / page).stat().st_size for page in pages]
    return manifest


def prune(output, keep=RETAINED):
    """Removes files none of the last `keep` publishes names, including temporaries an interrupted
    build left (the caller holds the lock, so no other build is writing). Directories are never
    touched. `publish.py <set dir> 1` keeps only the current publish (before a commit: the
    repository holds no font history)."""
    releases = json.loads((output / "releases.json").read_text())[:keep]
    (output / "releases.json").write_text(json.dumps(releases, indent=1) + "\n")
    kept = {"manifest.json", "releases.json"} | {file for release in releases for file in release}
    for path in output.iterdir():
        if path.is_file() and path.name not in kept:
            path.unlink()


def named_files(manifest, folder):
    """Every file the manifest's fonts reference: their metrics jsons and pages."""
    names = set()
    for entry in manifest.values():
        if isinstance(entry, dict) and "json" in entry:
            names.add(entry["json"])
            names.update(json.loads((folder / entry["json"]).read_text())["pages"])
    return names


if __name__ == "__main__":
    folder = Path(sys.argv[1]).resolve()
    with _lock(folder):
        prune(folder, int(sys.argv[2]))
