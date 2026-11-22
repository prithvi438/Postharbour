import { expect, it } from 'vitest';
import { popoverPosition } from './popoverPosition';

it('keeps tall panels on screen in narrow, expanded, and keyboard-reduced viewports', () => {
  for (const viewport of [
    { left: 0, top: 0, width: 1440, height: 900 },
    { left: 0, top: 0, width: 390, height: 740 },
    { left: 0, top: 180, width: 320, height: 260 },
  ]) {
    for (const anchor of [
      { left: viewport.width - 20, top: viewport.top + 60, bottom: viewport.top + 96 },
      {
        left: 20,
        top: viewport.top + viewport.height - 40,
        bottom: viewport.top + viewport.height - 8,
      },
    ]) {
      const result = popoverPosition(anchor, viewport, 900);
      expect(result.top).toBeGreaterThanOrEqual(viewport.top + 8);
      expect(result.top + result.maxHeight).toBeLessThanOrEqual(viewport.top + viewport.height - 8);
      expect(result.left).toBeGreaterThanOrEqual(viewport.left + 8);
      expect(result.left + result.width).toBeLessThanOrEqual(viewport.left + viewport.width - 8);
    }
  }
});
it('flips below a trigger near the top instead of clipping its header', () => {
  const result = popoverPosition(
    { left: 50, top: 20, bottom: 56 },
    { left: 0, top: 0, width: 900, height: 600 },
    300,
  );
  expect(result.top).toBe(64);
});
