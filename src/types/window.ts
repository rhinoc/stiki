export type WindowState = {
  float: boolean;
  fold: boolean;
  scaleFactor: number;
  size: [number, number] | null;
  position: [number, number] | null;
  sizeBeforeFold: [number, number] | null;
};
