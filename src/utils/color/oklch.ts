import { fromHex, fromOklch, toOklch } from "pex-color";
import { round } from "../common/round";

function denormOklch(oklch: [number, number, number]): [number, number, number] {
  // all the l, c, h are between 0 and 1
  const [l, c, h] = oklch;
  // css example: oklch(0.78 0.15 171)
  return [round(l, 2), round(c, 2), round(h * 360, 0)];
}

function normOklch(oklch: [number, number, number]): [number, number, number] {
  const [l, c, h] = oklch;
  return [l, c, h / 360];
}

export function hex2oklch(hex: string): [number, number, number] {
  const hexColor = fromHex(new Array(3), hex);
  const oklchColor = toOklch(hexColor);
  const normOklchColor = denormOklch(oklchColor as [number, number, number]);
  return normOklchColor;
}

export function toHex(color: number[], alpha = true) {
  const c = color.map((val) => Math.max(0, Math.min(255, Math.round(val * 255))));

  return `#${(c[2] | (c[1] << 8) | (c[0] << 16) | (1 << 24)).toString(16).slice(1).toUpperCase()}${
    alpha && color[3] !== undefined && color[3] !== 1 ? (c[3] | (1 << 8)).toString(16).slice(1) : ""
  }`;
}

export function oklch2hex(oklch: [number, number, number]) {
  const color = fromOklch(new Array(3), ...normOklch(oklch));
  return toHex(color);
}
