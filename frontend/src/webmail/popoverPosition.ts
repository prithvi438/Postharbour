/** Bound an editor panel to the visual viewport (including the mobile keyboard).
 * Prefer above its trigger, but flip below when that side has more useful space. */
export function popoverPosition(
  anchor: { left: number; top: number; bottom: number },
  viewport: { left: number; top: number; width: number; height: number },
  contentHeight: number,
) {
  const gap = 8;
  const width = Math.max(0, Math.min(390, viewport.width - gap * 2));
  const topEdge = viewport.top + gap,
    bottomEdge = viewport.top + viewport.height - gap;
  const above = Math.max(0, anchor.top - gap - topEdge),
    below = Math.max(0, bottomEdge - anchor.bottom - gap);
  const useAbove = above >= Math.min(contentHeight, 440) || above >= below;
  const maxHeight = Math.max(0, Math.min(440, Math.max(above, below), viewport.height - gap * 2));
  const height = Math.min(contentHeight, maxHeight);
  const top = Math.max(
    topEdge,
    Math.min(useAbove ? anchor.top - gap - height : anchor.bottom + gap, bottomEdge - height),
  );
  const left = Math.max(
    viewport.left + gap,
    Math.min(anchor.left, viewport.left + viewport.width - gap - width),
  );
  return { left, top, width, maxHeight };
}
