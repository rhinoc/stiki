import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { TauriCommand } from "../constants/tauri-command";
import { getRandomID } from "../utils/common/get-random-id";
import { Logger } from "../utils/common/logger";
import type { EditorService, SlashCommand } from "./editor";

const SHELL_TASK_EVENT = "shell-task";

type ShellTaskEventKind = "stdout" | "stderr" | "finished" | "error";

interface ShellTaskEvent {
  taskId: string;
  kind: ShellTaskEventKind;
  chunk?: string;
  exitCode?: number | null;
  message?: string;
}

interface ShellTask {
  output: string;
  flushHandle: number | null;
}

export class SlashCommandService {
  private _unlistenShellTask: UnlistenFn | null = null;

  private _disposeEditorCommand: (() => void) | null = null;

  private _shellTasks = new Map<string, ShellTask>();

  constructor(private readonly _editorService: EditorService) {}

  async init() {
    this._disposeEditorCommand = this._editorService.on("slashCommand", (command) => {
      void this.run(command);
    });
    this._unlistenShellTask = await listen<ShellTaskEvent>(SHELL_TASK_EVENT, (event) => {
      this._handleShellTaskEvent(event.payload);
    });
  }

  async run(command: SlashCommand) {
    switch (command.name) {
      case "exec":
        await this._runExec(command.args);
        break;
      case "screenshot":
        await this._runScreenshot();
        break;
      default:
        command satisfies never;
    }
  }

  private async _runExec(command: string) {
    const taskId = getRandomID();
    this._shellTasks.set(taskId, {
      output: "",
      flushHandle: null,
    });
    this._editorService.insertShellTaskBlock(taskId, command);

    try {
      await invoke(TauriCommand.StartShellTask, {
        taskId,
        command,
      });
    } catch (error) {
      this._appendShellTaskOutput(taskId, `Failed to start shell command: ${this._stringifyError(error)}\n`);
      this._finishShellTask(taskId);
    }
  }

  private async _runScreenshot() {
    try {
      const path = await invoke<string>(TauriCommand.TakeScreenshot);
      this._editorService.insertScreenshot(convertFileSrc(path), path);
    } catch (error) {
      this._editorService.appendMarkdown(`\`\`\`text\nScreenshot failed: ${this._stringifyError(error)}\n\`\`\``);
    }
  }

  private _handleShellTaskEvent(event: ShellTaskEvent) {
    switch (event.kind) {
      case "stdout":
      case "stderr":
        this._appendShellTaskOutput(event.taskId, event.chunk ?? "");
        break;
      case "finished":
        this._appendShellTaskOutput(event.taskId, `\n[exit ${event.exitCode ?? "unknown"}]\n`);
        this._finishShellTask(event.taskId);
        break;
      case "error":
        this._appendShellTaskOutput(event.taskId, `\n[error] ${event.message ?? "Unknown shell task error"}\n`);
        this._finishShellTask(event.taskId);
        break;
      default:
        event.kind satisfies never;
    }
  }

  private _appendShellTaskOutput(taskId: string, output: string) {
    if (!output) {
      return;
    }
    const task = this._shellTasks.get(taskId);
    if (!task) {
      Logger.warn(`[SlashCommandService] ignored shell output for unknown task ${taskId}`);
      return;
    }

    task.output += output;
    this._scheduleShellTaskFlush(taskId, task);
  }

  private _scheduleShellTaskFlush(taskId: string, task: ShellTask) {
    if (task.flushHandle !== null) {
      return;
    }

    task.flushHandle = requestAnimationFrame(() => {
      task.flushHandle = null;
      this._flushShellTask(taskId);
    });
  }

  private _flushShellTask(taskId: string) {
    const task = this._shellTasks.get(taskId);
    if (!task) {
      return;
    }
    const output = task.output || "[no output]\n";
    this._editorService.setShellTaskOutput(taskId, output);
  }

  private _finishShellTask(taskId: string) {
    const task = this._shellTasks.get(taskId);
    if (task?.flushHandle !== null && task?.flushHandle !== undefined) {
      cancelAnimationFrame(task.flushHandle);
      task.flushHandle = null;
    }
    this._flushShellTask(taskId);
    this._shellTasks.delete(taskId);
    this._editorService.forgetShellTask(taskId);
  }

  private _stringifyError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  dispose() {
    this._disposeEditorCommand?.();
    this._disposeEditorCommand = null;
    this._unlistenShellTask?.();
    this._unlistenShellTask = null;
    for (const task of this._shellTasks.values()) {
      if (task.flushHandle !== null) {
        cancelAnimationFrame(task.flushHandle);
      }
    }
    this._shellTasks.clear();
  }
}
