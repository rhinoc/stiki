import confetti, { type Shape } from "canvas-confetti";
import throttle from "throttleit";
import { getOriginByCaret, getOriginByElement, randomInRange } from "./utils";

interface ShootOptions extends Omit<confetti.Options, "shapes"> {
  shapes: string[];
}

class ConfettiPoper {
  private _enabled = false;

  get enabled() {
    return this._enabled;
  }

  setEnabled(enabled: boolean) {
    this._enabled = enabled;
  }

  public shootByCaret = throttle(this._shootByCaret.bind(this), 100);

  public shootByClick = throttle(this._shootByClick.bind(this), 100);

  private _getShapes(shapes: string[]): Shape[] {
    const result: confetti.Shape[] = [];
    for (const shape of shapes) {
      if (shape === "star" || shape === "circle" || shape === "square") {
        result.push(shape);
      } else {
        result.push(confetti.shapeFromText(shape));
      }
    }
    return result;
  }

  private _shoot(options: ShootOptions) {
    confetti({
      ...options,
      disableForReducedMotion: true,
      shapes: this._getShapes(options.shapes),
    });
  }

  private _shootByCaret(caretHeight: number, color: string, shapes: string[] = ["square"]) {
    if (!this._enabled) {
      return;
    }

    const origin = getOriginByCaret(caretHeight);
    if (!origin) {
      return;
    }

    this._shoot({
      particleCount: randomInRange(6, 12),
      angle: 0,
      ticks: randomInRange(20, 40),
      spread: 45,
      gravity: 0,
      scalar: randomInRange(0.3, 0.5),
      startVelocity: randomInRange(5, 15),
      origin,
      colors: [color],
      shapes,
    });
  }

  _shootByClick(element: HTMLElement, color: string, shapes: string[] = ["star"]) {
    if (!this._enabled) {
      return;
    }

    if (!element) {
      return;
    }

    this._shoot({
      particleCount: randomInRange(20, 40),
      angle: 90,
      ticks: randomInRange(30, 60),
      spread: 360,
      scalar: randomInRange(0.5, 0.7),
      startVelocity: randomInRange(5, 15),
      origin: getOriginByElement(element),
      gravity: 0.5,
      disableForReducedMotion: true,
      colors: [color],
      shapes,
    });
  }
}

export const confettiPoper = new ConfettiPoper();
