import { isTauri } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";
import throttle from "throttleit";
import type { TabState, ThemeState } from "../types/tab";
import type { WindowState } from "../types/window";
import { Logger } from "../utils/common/logger";
import { getDefaultStateValues } from "./utils/get-default-store";

export enum StateKey {
  WindowState = "window-state",
  TabState = "tab-state",
  ThemeState = "theme-state",
}

export interface StateValues {
  [StateKey.WindowState]: Readonly<WindowState>;
  [StateKey.TabState]: Readonly<TabState>;
  [StateKey.ThemeState]: Readonly<ThemeState>;
}

interface Options {
  savePath: string;
  saveWaitTime: number; // throttle time
}

export class SaveService {
  private readonly _options: Options;

  private _store: Store | null = null;

  private _storeValues: StateValues = getDefaultStateValues();

  private _initPromise: Promise<void>;

  private _isSaving = false;

  private _saveToDiskEnabled = false;

  private _savedTimestamp = 0;

  private _modifiedTimestamp = 0;

  public save: () => Promise<void>;

  constructor(options: Options) {
    this._options = options;
    this._initPromise = this._init();
    this.save = throttle(this.saveImmediately, this._options.saveWaitTime);
  }

  private async _init() {
    if (!isTauri()) {
      // @todo local storage version
      return;
    }
    this._store = await load(this._options.savePath, {
      autoSave: false,
      defaults: {},
    });
    const entries = (await this._store.entries()) as [string, any];
    for (const [k, v] of entries) {
      this._storeValues[k as StateKey] = v;
    }
  }

  init() {
    return this._initPromise;
  }

  set<T extends StateKey>(key: T, val: StateValues[T]) {
    if (this._storeValues[key] !== val) {
      this._storeValues[key] = val;
      this._modifiedTimestamp = Date.now();
      this.save();
    }
  }

  setAll(val: StateValues) {
    this._storeValues = structuredClone(val);
  }

  get<T extends StateKey>(key: T) {
    return this._storeValues[key] ?? getDefaultStateValues()[key];
  }

  getAll(): Readonly<StateValues> {
    return this._storeValues;
  }

  merge<T extends StateKey>(key: T, val: Partial<StateValues[T]>) {
    this.set(key, {
      ...this._storeValues[key],
      ...val,
    } as StateValues[T]);
  }

  private async _save() {
    this._savedTimestamp = Date.now();
    await this._initPromise;
    for (const [k, v] of Object.entries(this._storeValues)) {
      await this._store?.set(k, v);
    }
    await this._store?.save();
    Logger.info("[SaveService#_save] saved");
  }

  /** will save only when modified */
  async saveImmediately() {
    if (!this._store) {
      return;
    }
    if (!this._saveToDiskEnabled) {
      return;
    }
    if (this._modifiedTimestamp < this._savedTimestamp) {
      return;
    }
    if (this._isSaving) {
      return;
    }
    this._isSaving = true;
    await this._save();
    this._isSaving = false;

    // in case of modified during saving
    this.save();
  }

  stopSaveToDisk() {
    this._saveToDiskEnabled = false;
  }

  startSaveToDisk() {
    this._saveToDiskEnabled = true;
  }

  async clear() {
    await this._store?.clear();
    this._storeValues = getDefaultStateValues();
  }

  async destroy() {
    // save before destroy
    await this.save();
    await this._store?.close();
  }
}
