export interface Position {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export function clampSize(size: Size, viewport: Size): Size {
  return {
    width: Math.min(
      Math.max(0, viewport.width - 16),
      Math.max(280, size.width),
    ),
    height: Math.min(
      Math.max(0, viewport.height - 16),
      Math.max(300, size.height),
    ),
  };
}
export function clampPosition(
  position: Position,
  viewport: Size,
  size: Size,
): Position {
  const margin = 8;
  const clamp = (value: number, extent: number, length: number) =>
    Math.min(
      Math.max(margin, extent - length - margin),
      Math.max(margin, Number.isFinite(value) ? value : margin),
    );
  return {
    x: clamp(position.x, viewport.width, size.width),
    y: clamp(position.y, viewport.height, size.height),
  };
}
