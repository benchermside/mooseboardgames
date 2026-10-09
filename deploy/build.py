"""Package the siteAPI Lambda into lambdas/siteAPI/deployment.zip.

Usage: uv run --no-project python deploy/build.py   (or `just build`)

Installs the Lambda's third-party dependencies into lambdas/siteAPI/package/
(skipped when uv.lock hasn't changed since the last install), then zips the
*contents* of package/ and src/ into the archive root, so lambda_function.py
and the dependency packages all land at the top level, as the Lambda runtime
expects. boto3 and its helpers are left out because the Lambda runtime
already provides them.
"""
import hashlib
import os
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

SITE_API = Path(__file__).resolve().parent.parent / "lambdas" / "siteAPI"
LOCK_FILE = SITE_API / "uv.lock"
PACKAGE_DIR = SITE_API / "package"
SRC_DIR = SITE_API / "src"
HASH_FILE = PACKAGE_DIR / ".deps-hash"
OUTPUT_ZIP = SITE_API / "deployment.zip"

# Provided by the Lambda Python runtime, so not worth shipping.
_RUNTIME_PROVIDED = re.compile(r"^(boto3|botocore|s3transfer|jmespath)==")
_REQUIREMENT_LINE = re.compile(r"^[A-Za-z0-9].*==")

# Files that are build bookkeeping, not deployment payload.
_SKIP_NAMES = {".deps-hash"}


def install_dependencies() -> None:
    lock_hash = hashlib.sha256(LOCK_FILE.read_bytes()).hexdigest().upper()
    if HASH_FILE.exists() and HASH_FILE.read_text().strip() == lock_hash:
        print("Dependencies unchanged, skipping install")
        return

    if PACKAGE_DIR.exists():
        shutil.rmtree(PACKAGE_DIR)
    exported = subprocess.run(
        ["uv", "export", "--no-dev", "--no-hashes", "--no-emit-project", "--frozen"],
        cwd=SITE_API, check=True, capture_output=True, text=True,
    ).stdout
    deps = [
        line.strip() for line in exported.splitlines()
        if _REQUIREMENT_LINE.match(line) and not _RUNTIME_PROVIDED.match(line)
    ]
    if deps:
        subprocess.run(["uv", "pip", "install", "--target", str(PACKAGE_DIR), *deps], cwd=SITE_API, check=True)
    else:
        PACKAGE_DIR.mkdir(parents=True, exist_ok=True)
    HASH_FILE.write_text(lock_hash + "\n")


def add_dir(zf: zipfile.ZipFile, root: Path) -> None:
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if name in _SKIP_NAMES:
                continue
            full = os.path.join(dirpath, name)
            arcname = os.path.relpath(full, root)
            zf.write(full, arcname)


def main() -> None:
    install_dependencies()
    OUTPUT_ZIP.unlink(missing_ok=True)
    with zipfile.ZipFile(OUTPUT_ZIP, "w", zipfile.ZIP_DEFLATED) as zf:
        add_dir(zf, PACKAGE_DIR)
        add_dir(zf, SRC_DIR)
    print(f"Built {OUTPUT_ZIP.relative_to(SITE_API.parent.parent)}")


if __name__ == "__main__":
    main()
