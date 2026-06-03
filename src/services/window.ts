import {
  availableMonitors,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  primaryMonitor,
  type Monitor,
  type Window,
} from "@tauri-apps/api/window";
import debounce from "debounce";
import type { WindowState as State } from "../types/window";
import { Logger } from "../utils/common/logger";
import { getLogicalPos, getLogicalSize } from "../utils/window/size";
import { BaseService, type SetStateOptions } from "./base";

interface Options {
  headerHeight: number;
  minWidth: number;
  minHeight: number;
}

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export class WindowService extends BaseService<State> {
  private readonly _window: Window;

  private readonly _options: Options;

  protected _state: State = {
    float: false,
    fold: false,
    scaleFactor: 0,
    size: null,
    position: null,
    sizeBeforeFold: null,
  };

  constructor(options: Options) {
    super();
    this._options = options;
    this._window = getCurrentWindow();
  }

  private _disposeFns: (() => void)[] = [];

  dispose() {
    this._disposeFns.forEach((fn) => fn());
    this._disposeFns = [];
  }

  async init() {
    this.dispose();

    const [scaleFactor, size, position] = await Promise.all([
      this._window.scaleFactor(),
      this._window.outerSize(),
      this._window.outerPosition(),
    ]);

    this._state.scaleFactor = scaleFactor;
    this._state.size = getLogicalSize(size, scaleFactor);
    this._state.position = getLogicalPos(position, scaleFactor);

    await this._setListeners();
  }

  private async _setListeners() {
    const wait = 500;

    // scale factor
    const disposeScaleFactor = await this._window.onScaleChanged(
      debounce(({ payload }) => {
        this.setStates(
          {
            scaleFactor: payload.scaleFactor,
            position: getLogicalPos(payload.position, payload.scaleFactor),
          },
          {
            apply: false,
          },
        );
      }, wait),
    );
    this._disposeFns.push(disposeScaleFactor);

    // resize
    const disposeResize = await this._window.onResized(
      debounce(({ payload }) => {
        if (!this._state.scaleFactor) {
          return;
        }
        this.setState("size", getLogicalSize(payload, this._state.scaleFactor), {
          apply: false,
        });
      }, wait),
    );
    this._disposeFns.push(disposeResize);

    // move
    const disposeMove = await this._window.onMoved(
      debounce(({ payload }) => {
        if (!this._state.scaleFactor) {
          return;
        }
        this.setState("position", getLogicalPos(payload, this._state.scaleFactor), {
          apply: false,
        });
      }, wait),
    );
    this._disposeFns.push(disposeMove);
  }

  private _clampSize(size: [number, number] | null, minHeight = this._options.minHeight): [number, number] | null {
    if (!size || !Number.isFinite(size[0]) || !Number.isFinite(size[1])) {
      return null;
    }

    return [Math.max(size[0], this._options.minWidth), Math.max(size[1], minHeight)];
  }

  private _getMonitorRect(monitor: Monitor): Rect {
    const position = monitor.position.toLogical(monitor.scaleFactor);
    const size = monitor.size.toLogical(monitor.scaleFactor);
    return {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    };
  }

  private _intersects(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }

  private _clampPositionToRect(position: [number, number], size: [number, number], rect: Rect): [number, number] {
    const width = Math.min(size[0], rect.width);
    const height = Math.min(size[1], rect.height);
    const minX = rect.x;
    const minY = rect.y;
    const maxX = rect.x + Math.max(0, rect.width - width);
    const maxY = rect.y + Math.max(0, rect.height - height);

    return [Math.min(Math.max(position[0], minX), maxX), Math.min(Math.max(position[1], minY), maxY)];
  }

  private async _sanitizePosition(
    position: [number, number] | null,
    size: [number, number] | null,
  ): Promise<[number, number] | null> {
    if (!position || !Number.isFinite(position[0]) || !Number.isFinite(position[1])) {
      return null;
    }

    const safeSize = this._clampSize(size, this._options.headerHeight) ?? [
      this._options.minWidth,
      this._options.minHeight,
    ];
    let monitors: Monitor[] = [];
    try {
      monitors = await availableMonitors();
    } catch (error) {
      Logger.warn("[WindowService#_sanitizePosition] availableMonitors failed", error);
      return position;
    }

    if (!monitors.length) {
      return position;
    }

    const windowRect = {
      x: position[0],
      y: position[1],
      width: safeSize[0],
      height: safeSize[1],
    };
    const monitorRects = monitors.map((monitor) => this._getMonitorRect(monitor));
    const containingRect = monitorRects.find((rect) => this._intersects(windowRect, rect));

    if (containingRect) {
      return this._clampPositionToRect(position, safeSize, containingRect);
    }

    const fallbackMonitor = await primaryMonitor().catch((error) => {
      Logger.warn("[WindowService#_sanitizePosition] primaryMonitor failed", error);
      return null;
    });
    const fallbackRect = fallbackMonitor ? this._getMonitorRect(fallbackMonitor) : monitorRects[0];

    return this._clampPositionToRect(position, safeSize, fallbackRect);
  }

  private async _applyRestoredGeometry(state: State): Promise<void> {
    const minHeight = state.fold ? this._options.headerHeight : this._options.minHeight;
    await this._window.setMinSize(new LogicalSize(this._options.minWidth, minHeight)).catch((error) => {
      Logger.warn("[WindowService#_applyRestoredGeometry] setMinSize failed", error);
    });

    if (state.size) {
      await this._window.setSize(new LogicalSize(...state.size)).catch((error) => {
        Logger.warn("[WindowService#_applyRestoredGeometry] setSize failed", error);
      });
    }

    if (state.position) {
      await this._window.setPosition(new LogicalPosition(...state.position)).catch((error) => {
        Logger.warn("[WindowService#_applyRestoredGeometry] setPosition failed", error);
      });
    }
  }

  protected _applyFnMap: Partial<{
    float: (value: boolean) => void | Promise<void> | boolean;
    fold: (value: boolean) => void | Promise<void> | boolean;
    minimize: (value: boolean) => void | Promise<void> | boolean;
    scaleFactor: (value: number) => void | Promise<void> | boolean;
    size: (value: [number, number] | null) => void | Promise<void> | boolean;
    position: (value: [number, number] | null) => void | Promise<void> | boolean;
  }> = {
    float: (value) => this._window.setAlwaysOnTop(value),
    size: (value) => {
      const minHeight =
        value && value[1] <= this._options.headerHeight ? this._options.headerHeight : this._options.minHeight;
      const safeSize = this._clampSize(value, minHeight);
      if (!safeSize) {
        return false;
      }

      this._window.setSize(new LogicalSize(...safeSize));
    },
    position: (value) => {
      if (!value || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
        return false;
      }

      this._window.setPosition(new LogicalPosition(...value));
    },
    fold: (value) => {
      if (value) {
        // fold
        if (!this._state.size || this._state.size[1] <= this._options.minHeight) {
          return false;
        }
        this._window.setMinSize(new LogicalSize(this._options.minWidth, this._options.headerHeight));
        this.setStates({
          sizeBeforeFold: this._state.size,
          size: [this._state.size[0], this._options.headerHeight],
        });
        this._window.setResizable(false);
        this._window.setMaximizable(false);
      } else {
        // unfold
        if (
          !this._state.size ||
          !this._state.sizeBeforeFold ||
          this._state.sizeBeforeFold[1] <= this._options.minHeight
        ) {
          return false;
        }

        this._window.setResizable(true);
        this._window.setMaximizable(true);
        this._window.setMinSize(new LogicalSize(this._options.minWidth, this._options.minHeight));
        if (this._state.sizeBeforeFold) {
          this.setStates({
            size: this._state.sizeBeforeFold,
            sizeBeforeFold: null,
          });
        }
      }
    },
  };

  toggleFloat() {
    this.setState("float", !this._state.float);
  }

  toggleFold() {
    this.setState("fold", !this._state.fold);
  }

  minimize() {
    this._window.minimize();
  }

  async restoreFromState(state: State, options?: SetStateOptions): Promise<void> {
    if (!state.fold && state.size && state.size[1] <= this._options.headerHeight) {
      state.fold = true;
      state.sizeBeforeFold = [Math.max(state.size[0], this._options.minWidth), this._options.minHeight];
    }

    if (state.fold) {
      if (!state.sizeBeforeFold || (state.size && state.size[1] > this._options.headerHeight)) {
        state.fold = false;
      } else {
        state.size = this._clampSize(state.size, this._options.headerHeight);
        state.sizeBeforeFold[0] = Math.max(state.sizeBeforeFold[0], this._options.minWidth);
        state.sizeBeforeFold[1] = Math.max(state.sizeBeforeFold[1], this._options.minHeight);
      }
    }

    if (!state.fold) {
      state.size = this._clampSize(state.size);
    }

    state.position = await this._sanitizePosition(state.position, state.size);

    super.restoreFromState(state, options);
    await this._applyRestoredGeometry(state);
  }

  close() {
    Logger.info("[WindowService#close] called");
    this._window.hide();
  }
}
