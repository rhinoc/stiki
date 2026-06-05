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

  private _allowFoldSize = false;

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

        const size = getLogicalSize(payload, this._state.scaleFactor);
        const minHeight = this._state.fold ? this._options.headerHeight : this._options.minHeight;
        const safeSize = this._clampSize(size, minHeight);
        if (!safeSize) {
          return;
        }

        if (safeSize[0] !== size[0] || safeSize[1] !== size[1]) {
          this._window.setSize(new LogicalSize(...safeSize)).catch((error) => {
            Logger.warn("[WindowService#onResized] setSize failed", error);
          });
        }

        this.setState("size", safeSize, {
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
    await this._window.setAlwaysOnTop(state.float).catch((error) => {
      Logger.warn("[WindowService#_applyRestoredGeometry] setAlwaysOnTop failed", error);
    });

    if (!state.fold) {
      await this._window.setResizable(true).catch((error) => {
        Logger.warn("[WindowService#_applyRestoredGeometry] setResizable failed", error);
      });
      await this._window.setMaximizable(true).catch((error) => {
        Logger.warn("[WindowService#_applyRestoredGeometry] setMaximizable failed", error);
      });
    }

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

    if (state.fold) {
      await this._window.setResizable(false).catch((error) => {
        Logger.warn("[WindowService#_applyRestoredGeometry] setResizable failed", error);
      });
      await this._window.setMaximizable(false).catch((error) => {
        Logger.warn("[WindowService#_applyRestoredGeometry] setMaximizable failed", error);
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
      const minHeight = this._allowFoldSize || this._state.fold ? this._options.headerHeight : this._options.minHeight;
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
        this._allowFoldSize = true;
        try {
          this.setStates(
            {
              sizeBeforeFold: this._state.size,
              size: [this._state.size[0], this._options.headerHeight],
            },
            {
              emit: false,
            },
          );
        } finally {
          this._allowFoldSize = false;
        }
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
          this.setStates(
            {
              size: this._state.sizeBeforeFold,
              sizeBeforeFold: null,
            },
            {
              emit: false,
            },
          );
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
    const normalizedState: State = {
      ...state,
      size: null,
      position: state.position ? [state.position[0], state.position[1]] : null,
      sizeBeforeFold: null,
    };

    const sizeBeforeFold = this._clampSize(state.sizeBeforeFold);

    if (state.fold && sizeBeforeFold && sizeBeforeFold[1] > this._options.minHeight) {
      const restoredSize = this._clampSize(state.size, this._options.headerHeight);
      normalizedState.fold = true;
      normalizedState.size = [
        Math.max(restoredSize?.[0] ?? sizeBeforeFold[0], this._options.minWidth),
        this._options.headerHeight,
      ];
      normalizedState.sizeBeforeFold = sizeBeforeFold;
    } else {
      normalizedState.fold = false;
      normalizedState.size = this._clampSize(state.size);
    }

    normalizedState.position = await this._sanitizePosition(normalizedState.position, normalizedState.size);

    super.restoreFromState(normalizedState, {
      ...options,
      apply: false,
    });
    await this._applyRestoredGeometry(normalizedState);
  }

  close() {
    Logger.info("[WindowService#close] called");
    this._window.hide();
  }
}
