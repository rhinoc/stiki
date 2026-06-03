import type { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";

export function getLogicalSize(physicalSize: PhysicalSize, factor: number): [number, number] {
  const logicalSize = physicalSize.toLogical(factor);
  return [logicalSize.width, logicalSize.height];
}

export function getLogicalPos(physicalPos: PhysicalPosition, factor: number): [number, number] {
  const logicalSize = physicalPos.toLogical(factor);
  return [logicalSize.x, logicalSize.y];
}
