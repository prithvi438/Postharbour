#!/usr/bin/env python3
"""Regenerate the bundled Unicode 17 emoji catalog from its official source.

Run explicitly when maintaining emoji data; the app never downloads data remotely.
The source license must accompany the generated catalog in distributions.
"""
import json
from pathlib import Path
import re
import urllib.request

VERSION = "17.0.0"
SOURCE = f"https://www.unicode.org/Public/{VERSION}/emoji/emoji-test.txt"
ROOT = Path(__file__).resolve().parents[1]


def main():
    """Keep fully-qualified sequences, including tones, in Unicode category order."""
    raw = urllib.request.urlopen(SOURCE, timeout=30).read().decode("utf-8")
    license_text = urllib.request.urlopen("https://www.unicode.org/license.txt", timeout=30).read()
    items, group = [], ""
    for line in raw.splitlines():
        if line.startswith("# group:"):
            group = line.split(":", 1)[1].strip()
        if "; fully-qualified" not in line:
            continue
        codes, rest = line.split(";", 1)
        match = re.search(r"#\s+\S+\s+E[\d.]+\s+(.+)", rest)
        if match:
            items.append(dict(emoji="".join(chr(int(c, 16)) for c in codes.split()),
                              name=match[1], group=group))
    if len(items) < 3000:
        raise RuntimeError("Incomplete emoji source; generated files left unchanged")
    (ROOT / "frontend/src/webmail/emoji-data.json").write_text(
        json.dumps(items, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (ROOT / "frontend/UNICODE-LICENSE.txt").write_bytes(license_text)
    print(f"Generated {len(items)} emoji sequences from {SOURCE}")


if __name__ == "__main__":
    main()
