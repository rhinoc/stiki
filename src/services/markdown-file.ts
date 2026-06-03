import { invoke } from "@tauri-apps/api/core";
import throttle from "throttleit";
import { TauriCommand } from "../constants/tauri-command";
import type { TabConfig } from "../types/tab";
import { Logger } from "../utils/common/logger";

interface Options {
  saveWaitTime: number;
}

interface PendingWrite {
  path: string;
  content: string;
}

export class MarkdownFileService {
  private readonly _pendingWrites = new Map<string, PendingWrite>();

  private _isSaving = false;

  public save: () => Promise<void>;

  constructor(options: Options) {
    this.save = throttle(this.saveImmediately, options.saveWaitTime);
  }

  queueSave(tab: TabConfig, content: string) {
    if (!tab.filePath) {
      return;
    }

    this._pendingWrites.set(tab.key, {
      path: tab.filePath,
      content,
    });
    this.save();
  }

  async saveTabImmediately(tab: TabConfig, content: string) {
    if (!tab.filePath) {
      return;
    }

    await this.write(tab.filePath, content);
  }

  async saveImmediately() {
    if (this._isSaving || this._pendingWrites.size === 0) {
      return;
    }

    this._isSaving = true;
    const writes = [...this._pendingWrites.values()];
    this._pendingWrites.clear();

    try {
      for (const write of writes) {
        try {
          await this.write(write.path, write.content);
        } catch (error) {
          Logger.error("[MarkdownFileService#saveImmediately] write failed", error);
        }
      }
    } finally {
      this._isSaving = false;
    }

    if (this._pendingWrites.size > 0) {
      this.save();
    }
  }

  async read(path: string) {
    return invoke<string>(TauriCommand.ReadMarkdownFile, { path });
  }

  async write(path: string, content: string) {
    await invoke<void>(TauriCommand.WriteMarkdownFile, { path, content });
    Logger.info(`[MarkdownFileService#write] saved ${path}`);
  }
}
