"""Build a reproducible Zotero XPI and its native stable update manifest."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import zipfile

REPOSITORY = "historiaoralmx/zotero-ia"
ADDON_ID = "zotero-ia@humanistyc.org"
UPDATE_URL = f"https://github.com/{REPOSITORY}/releases/latest/download/updates.json"


def build(source: Path, output: Path, tag: str, repository: str = REPOSITORY) -> dict:
    if repository.casefold() != REPOSITORY:
        raise ValueError("Only the official repository can publish this update channel")
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
        raise ValueError("The stable release tag must be vMAJOR.MINOR.PATCH")
    manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    app = manifest["applications"]["zotero"]
    if version != tag[1:]:
        raise ValueError("The tag and manifest version must match")
    if app["id"] != ADDON_ID or app["update_url"] != UPDATE_URL:
        raise ValueError("Unexpected add-on identity or update channel")
    if not app.get("strict_min_version") or not app.get("strict_max_version"):
        raise ValueError("Explicit Zotero compatibility limits are required")
    files = [p for p in source.iterdir() if p.is_file() and
             (p.suffix == ".js" or p.name in {"manifest.json", "CHANGELOG.md", "LEEME.txt"})]
    for folder in ("content", "locale"):
        files.extend(p for p in (source / folder).rglob("*") if p.is_file())
    if any(p.is_symlink() or any(part.startswith(".") for part in p.relative_to(source).parts)
           or p.suffix.lower() in {".exe", ".ps1", ".pyc"} for p in files):
        raise ValueError("Unexpected private, linked, or executable package files")
    output.mkdir(parents=True, exist_ok=True)
    xpi = output / f"zotero-ia-{version}.xpi"
    with zipfile.ZipFile(xpi, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for p in sorted(files, key=lambda p: p.relative_to(source).as_posix()):
            info = zipfile.ZipInfo(p.relative_to(source).as_posix(), (2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, p.read_bytes())
    digest = hashlib.sha256(xpi.read_bytes()).hexdigest()
    update = {"addons": {ADDON_ID: {"updates": [{
        "version": version,
        "update_link": f"https://github.com/{REPOSITORY}/releases/download/{tag}/{xpi.name}",
        "update_hash": f"sha256:{digest}",
        "applications": {"zotero": {
            "strict_min_version": app["strict_min_version"],
            "strict_max_version": app["strict_max_version"],
        }},
    }]}}}
    (output / "updates.json").write_text(json.dumps(update, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    shutil.copyfile(source / "content/manual.html", output / f"Manual_Zotero_IA_{version}.html")
    checksums = "".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n"
                        for p in sorted(output.iterdir()) if p.is_file() and p.name != "checksums.txt")
    (output / "checksums.txt").write_text(checksums, encoding="utf-8")
    return update


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, default=Path("dist"))
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repository", default=REPOSITORY)
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.output, args.tag, args.repository), indent=2))
