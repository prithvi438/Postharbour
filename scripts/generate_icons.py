#!/usr/bin/env python3
"""Generate our geometric mail logo as PNGs using Python's standard library.

No design service or runtime image library is needed. Keep all drawing inside
the maskable icon safe zone so Android launchers can crop the outer background.
Run from the repository root: python3 scripts/generate_icons.py
"""
import struct
import zlib
from pathlib import Path


def icon(size: int) -> bytes:
    """Rasterize the original envelope-and-arrow mark into a valid RGB PNG."""
    pixels = bytearray(bytes((16, 43, 50)) * size * size)

    def line(start, end):
        """Draw a thick line segment in normalized 64-by-64 icon coordinates."""
        x1, y1 = (v * size / 64 for v in start)
        x2, y2 = (v * size / 64 for v in end)
        radius = size / 64
        dx, dy = x2 - x1, y2 - y1
        length = dx * dx + dy * dy
        for y in range(max(0, int(min(y1, y2) - radius)), min(size, int(max(y1, y2) + radius + 1))):
            for x in range(max(0, int(min(x1, x2) - radius)), min(size, int(max(x1, x2) + radius + 1))):
                t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / length))
                if (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2 <= radius ** 2:
                    at = (y * size + x) * 3
                    pixels[at:at + 3] = bytes((195, 235, 217))

    for start, end in [((16, 24), (48, 24)), ((48, 24), (48, 45)), ((48, 45), (16, 45)),
                       ((16, 45), (16, 24)), ((16, 24), (32, 35)), ((32, 35), (48, 24)),
                       ((32, 13), (32, 21)), ((26, 18), (32, 13)), ((32, 13), (38, 18))]:
        line(start, end)

    def chunk(kind: bytes, data: bytes) -> bytes:
        """Encode a PNG chunk with its length and integrity checksum."""
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))

    rows = b''.join(b'\x00' + pixels[y * size * 3:(y + 1) * size * 3] for y in range(size))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


def main():
    """Write install, maskable, and Apple touch icons into Vite's public directory."""
    target = Path(__file__).resolve().parents[1] / 'frontend/public/icons'
    target.mkdir(parents=True, exist_ok=True)
    for name, size in [('icon-192', 192), ('icon-512', 512), ('maskable-512', 512), ('apple-touch-icon', 180)]:
        (target / f'{name}.png').write_bytes(icon(size))


if __name__ == '__main__':
    main()
