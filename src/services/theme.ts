import type { ThemeState as State, ThemeColor } from "../types/tab";
import { oklch2hex } from "../utils/color/oklch";
import { isDarkMode } from "../utils/common/dark-light";
import { Logger } from "../utils/common/logger";
import { confettiPoper } from "../utils/confetti/poper";
import { setCSSVariable } from "../utils/style/variable";
import { BaseService } from "./base";

export class ThemeService extends BaseService<State> {
  protected _state: State = {
    color: {
      spice: {
        dark: [0, 0, 0],
        light: [0, 0, 0],
      },
    },
    powerMode: false,
  };

  // cached hex color, avoid recalculate
  private _spiceHexColor: {
    dark: string;
    light: string;
  } = {
    dark: "#000",
    light: "#000",
  };

  get spiceHexColor() {
    return this._spiceHexColor;
  }

  get currentSpiceHexColor() {
    const isDark = isDarkMode();
    return isDark ? this._spiceHexColor.dark : this._spiceHexColor.light;
  }

  protected _applyFnMap: Partial<{
    color: (value: { spice: ThemeColor }) => void | Promise<void> | boolean;
    powerMode: (value: boolean) => void | Promise<void> | boolean;
  }> = {
    color: (value) => {
      const { dark, light } = value.spice;

      if (dark.length < 3 || light.length < 3) {
        Logger.warn("[ThemeService] Invalid theme color");
        return false;
      }

      setCSSVariable("--color-spice-l--light", light[0]);
      setCSSVariable("--color-spice-c--light", light[1]);
      setCSSVariable("--color-spice-h--light", light[2]);

      setCSSVariable("--color-spice-l--dark", dark[0]);
      setCSSVariable("--color-spice-c--dark", dark[1]);
      setCSSVariable("--color-spice-h--dark", dark[2]);

      this._spiceHexColor = {
        dark: oklch2hex(dark),
        light: oklch2hex(light),
      };
    },
    powerMode: (value) => {
      confettiPoper.setEnabled(value);
    },
  };
}
