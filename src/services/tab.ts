import type { EditorState, TabState as State, TabConfig } from "../types/tab";
import { Logger } from "../utils/common/logger";
import { BaseService, type SetStateOptions } from "./base";

export class TabService extends BaseService<State> {
  protected _state: State = {
    current: "",
    tabs: [],
  };

  protected _applyFnMap: Partial<{
    tabs: (value: TabConfig[]) => void | Promise<void>;
    current: (value: string) => void | Promise<void>;
  }> = {};

  get currentTab() {
    const tabConfig = this._state.tabs.find((tab) => tab.key === this._state.current);
    if (!tabConfig) {
      throw new Error("[TabService#getCurrentTab] Current tab not found");
    }
    return tabConfig;
  }

  get currentEditorState(): EditorState {
    if (!this.currentTab) {
      throw new Error("[TabService#getCurrentEditorState] Current tab not found");
    }

    return {
      json: this.currentTab.json,
      anchor: this.currentTab.anchor,
    };
  }

  setCurrentTab = (key: string) => {
    if (!this._state.tabs.find((tab) => tab.key === key)) {
      Logger.error(`[TabService#setCurrentTab] Tab ${key} not found`);
      return;
    }
    this.setState("current", key);
  };

  addTab = (tab: TabConfig, makeItCurrent = false) => {
    this.setStates({
      tabs: [...this._state.tabs, tab],
      ...(makeItCurrent && {
        current: tab.key,
      }),
    });
  };

  deleteTab = (key: string) => {
    if (this._state.tabs.length <= 1) {
      return;
    }

    const tabIndex = this._state.tabs.findIndex((tab) => tab.key === key);
    if (tabIndex < 0) {
      return;
    }

    this.setStates({
      ...(this._state.current === key && {
        current: this._state.tabs[Math.max(0, tabIndex - 1)].key,
      }),
      tabs: this._state.tabs.filter((tab) => tab.key !== key),
    });
  };

  updateTab = (key: string, tab: Partial<Omit<TabConfig, "key">>) => {
    const tabIndex = this._state.tabs.findIndex((tab) => tab.key === key);
    if (tabIndex < 0) {
      Logger.error(`[TabService#updateTab] Tab ${key} not found`);
      return;
    }

    this._state.tabs[tabIndex] = { ...this._state.tabs[tabIndex], ...tab };
    // spread to trigger setState emit
    this.setState("tabs", [...this._state.tabs]);
  };

  updateCurrentTab = (tab: Partial<Omit<TabConfig, "key">>) => {
    this.updateTab(this._state.current, tab);
  };

  restoreFromState(state: State, options?: SetStateOptions): void {
    // fix and validate state
    if (state.tabs.every((tab) => tab.key !== state.current)) {
      Logger.warn(`[TabService#restoreFromState] current ${state.current} is invalid, reset to first tab`);
      state.current = state.tabs[0].key;
    }

    super.restoreFromState(state, options);
  }
}
