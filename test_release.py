import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("release_builder", ROOT / "build_release.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        (self.source / "content").mkdir(parents=True)
        (self.source / "locale/es-ES").mkdir(parents=True)
        self.manifest = {"version": "1.2.3", "applications": {"zotero": {
            "id": builder.ADDON_ID, "update_url": builder.UPDATE_URL,
            "strict_min_version": "6.999", "strict_max_version": "10.*"}}}
        self.write_manifest()
        (self.source / "bootstrap.js").write_text("function startup() {}")
        (self.source / "content/manual.html").write_text("<p>Manual</p>")
        (self.source / "locale/es-ES/zotero-ia.ftl").write_text("title = Zotero IA")

    def write_manifest(self):
        (self.source / "manifest.json").write_text(json.dumps(self.manifest))

    def build(self, tag="v1.2.3", repository=builder.REPOSITORY, name="dist"):
        return builder.build(self.source, self.root / name, tag, repository)

    def test_native_manifest_matches_the_actual_xpi_and_keeps_compatibility(self):
        data = self.build()
        entry = data["addons"][builder.ADDON_ID]["updates"][0]
        xpi = self.root / "dist/zotero-ia-1.2.3.xpi"
        self.assertEqual(entry["update_hash"], "sha256:" + hashlib.sha256(xpi.read_bytes()).hexdigest())
        self.assertEqual(entry["update_link"], "https://github.com/historiaoralmx/zotero-ia/releases/download/v1.2.3/zotero-ia-1.2.3.xpi")
        self.assertEqual(entry["applications"]["zotero"]["strict_max_version"], "10.*")
        with zipfile.ZipFile(xpi) as archive:
            self.assertEqual(json.loads(archive.read("manifest.json")), self.manifest)
            self.assertIn("locale/es-ES/zotero-ia.ftl", archive.namelist())
            self.assertNotIn("updates.json", archive.namelist())

    def test_build_is_reproducible_and_excludes_tools_and_private_root_files(self):
        (self.source / "private.json").write_text("excluded")
        (self.source / "automation.py").write_text("excluded")
        self.build()
        self.build(name="second")
        first = self.root / "dist/zotero-ia-1.2.3.xpi"
        self.assertEqual(first.read_bytes(), (self.root / "second" / first.name).read_bytes())
        with zipfile.ZipFile(first) as archive:
            self.assertNotIn("private.json", archive.namelist())
            self.assertNotIn("automation.py", archive.namelist())

    def test_tag_mismatch_prerelease_or_other_repository_cannot_publish(self):
        for tag in ["v1.2.4", "v1.2.3-beta", "1.2.3", "v1.2.3;pwd"]:
            with self.assertRaises(ValueError):
                self.build(tag=tag)
        with self.assertRaises(ValueError):
            self.build(repository="someone/fork")

    def test_wrong_identity_channel_and_missing_compatibility_are_rejected(self):
        app = self.manifest["applications"]["zotero"]
        for field, value in [("id", "other@id"), ("update_url", "https://example.org/updates.json"), ("strict_max_version", "")]:
            old = app[field]
            app[field] = value
            self.write_manifest()
            with self.assertRaises(ValueError):
                self.build()
            app[field] = old
        self.write_manifest()

    def test_bundled_executables_and_private_files_are_rejected(self):
        for name in ["recorder.ps1", ".private.json"]:
            path = self.source / "content" / name
            path.write_text("not distributable")
            with self.assertRaises(ValueError):
                self.build()
            path.unlink()


if __name__ == "__main__":
    unittest.main()
