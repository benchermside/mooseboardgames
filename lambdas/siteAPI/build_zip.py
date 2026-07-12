"""Fast Lambda deployment zipper.

Usage: python build_zip.py <output.zip> <src_dir> [<src_dir> ...]

Zips the *contents* of each source directory into the archive root (so
handler.py and the dependency packages all land at the top level, as the
Lambda runtime expects). Much faster than PowerShell's Compress-Archive on
trees with many small files (e.g. botocore).
"""
import os
import sys
import zipfile

# Files that are build bookkeeping, not deployment payload.
_SKIP_NAMES = {".deps-hash"}


def add_dir(zf: zipfile.ZipFile, root: str) -> None:
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if name in _SKIP_NAMES:
                continue
            full = os.path.join(dirpath, name)
            arcname = os.path.relpath(full, root)
            zf.write(full, arcname)


def main() -> None:
    out, roots = sys.argv[1], sys.argv[2:]
    if not roots:
        sys.exit("build_zip.py: need at least one source directory")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for root in roots:
            add_dir(zf, root)


if __name__ == "__main__":
    main()
