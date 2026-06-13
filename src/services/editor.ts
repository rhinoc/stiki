import { Editor, type JSONContent } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { all, createLowlight } from "lowlight";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";
import type { EditorState as State } from "../types/tab";
import { Logger } from "../utils/common/logger";
import Link from "../utils/tiptap-plugins/link";
import TaskItem from "../utils/tiptap-plugins/task-item";
import { BaseService } from "./base";

interface NonStateEvents {
  taskItemChange: (event: Event) => void;
  slashCommand: (command: SlashCommand) => void;
}

export type SlashCommand = { name: "exec"; args: string; raw: string } | { name: "screenshot"; raw: string };

export class EditorService extends BaseService<State, NonStateEvents> {
  private _editor: Editor;

  private _element: HTMLDivElement;

  private _shellTaskBlockPositions = new Map<string, number>();

  get element() {
    return this._element;
  }

  protected _state: State = {
    json: {},
    anchor: 0,
  };

  constructor() {
    super();
    this._element = document.createElement("div");
    const lowlight = createLowlight(all);
    this._editor = new Editor({
      element: this._element,
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          link: false,
          hardBreak: {
            keepMarks: false,
          },
        }),
        Placeholder.configure({
          placeholder: "Type anything :)",
        }),
        Image.configure({
          HTMLAttributes: {
            class: "tiptap-image",
          },
          inline: true,
        }),
        Markdown,
        Link,
        TaskList,
        TaskItem.configure({
          nested: true,
          onChange: (event) => {
            this._emitter.emit("taskItemChange", event);
          },
        }),
        CodeBlockLowlight.configure({
          lowlight,
        }),
      ],
      autofocus: true,
      onUpdate: () => {
        this.setStates(
          {
            json: this._editor.getJSON(),
            anchor: this._editor.state.selection.anchor,
          },
          {
            apply: false,
          },
        );
      },
      editorProps: {
        attributes: {
          autoComplete: "off",
          spellCheck: "false",
          autoCorrect: "off",
        },
        handleKeyDown: (_view, event) => {
          if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.altKey || event.ctrlKey) {
            return false;
          }
          return this._handleSlashCommandEnter(event);
        },
      },
    });
  }

  protected _applyFnMap: Partial<{
    json: (value: JSONContent) => void | Promise<void> | boolean;
    anchor: (value: number) => void | Promise<void> | boolean;
  }> = {
    json: (value) => {
      this._editor.commands.setContent(value, {
        emitUpdate: false,
      });
      this._editor.commands.focus("start");
      this.resetHistory();
    },
    anchor: (value) => {
      this._editor.commands.focus(value);
    },
  };

  getContent(type: "text" | "html" | "markdown" | "json"): string {
    if (!this._editor) {
      return "";
    }
    switch (type) {
      case "text":
        return this._editor.getHTML();
      case "html":
        return this._editor.getHTML();
      case "markdown":
        return (this._editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown();
      case "json":
        return JSON.stringify(this._editor.getJSON(), null, 2);
      default:
        return "";
    }
  }

  setContentFromMarkdown(markdown: string) {
    this._editor.commands.setContent(markdown, {
      emitUpdate: false,
    });
    this.resetHistory();
    this.setStates({
      json: this._editor.getJSON(),
      anchor: this._editor.state.selection.anchor,
    });
  }

  appendMarkdown(markdown: string) {
    const currentMarkdown = this.getContent("markdown").trimEnd();
    const nextMarkdown = currentMarkdown ? `${currentMarkdown}\n\n${markdown}` : markdown;

    this._editor.commands.setContent(nextMarkdown, {
      emitUpdate: false,
    });
    this._editor.commands.focus("end");
    this.setStates({
      json: this._editor.getJSON(),
      anchor: this._editor.state.selection.anchor,
    });
  }

  insertShellTaskBlock(taskId: string, command: string) {
    this._editor.commands.insertContent([
      {
        type: "paragraph",
        content: [{ type: "text", text: `$ ${command}` }],
      },
      {
        type: "codeBlock",
        attrs: { language: "text" },
        content: [{ type: "text", text: "Running...\n" }],
      },
    ]);
    const position = this._findLastNodePosition((node) => node.type.name === "codeBlock");
    if (position !== null) {
      this._shellTaskBlockPositions.set(taskId, position);
    }
    this.setStates({
      json: this._editor.getJSON(),
      anchor: this._editor.state.selection.anchor,
    });
  }

  insertScreenshot(src: string, path: string) {
    this._editor.commands.insertContent([
      {
        type: "paragraph",
        content: [
          {
            type: "image",
            attrs: {
              src,
              alt: "Screenshot",
              title: path,
            },
          },
        ],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: path }],
      },
    ]);
    this.setStates({
      json: this._editor.getJSON(),
      anchor: this._editor.state.selection.anchor,
    });
  }

  setShellTaskOutput(taskId: string, output: string) {
    const position = this._shellTaskBlockPositions.get(taskId);
    if (position === undefined) {
      return false;
    }

    const { schema, doc } = this._editor.state;
    const node = doc.nodeAt(position);
    if (!node || node.type.name !== "codeBlock") {
      this._shellTaskBlockPositions.delete(taskId);
      return false;
    }

    const textNode = output ? schema.text(output) : undefined;
    const tr = this._editor.state.tr.replaceWith(
      position + 1,
      position + node.nodeSize - 1,
      textNode ? [textNode] : [],
    );
    this._editor.view.dispatch(tr);
    this.setStates({
      json: this._editor.getJSON(),
      anchor: this._editor.state.selection.anchor,
    });
    return true;
  }

  forgetShellTask(taskId: string) {
    this._shellTaskBlockPositions.delete(taskId);
  }

  private _findLastNodePosition(predicate: (node: ProseMirrorNode) => boolean) {
    let lastPosition: number | null = null;
    this._editor.state.doc.descendants((node, position) => {
      if (predicate(node)) {
        lastPosition = position;
      }
    });
    return lastPosition;
  }

  private _handleSlashCommandEnter(event: KeyboardEvent) {
    const { state, view } = this._editor;
    const { selection } = state;
    if (!selection.empty) {
      return false;
    }

    const { $from } = selection;
    if ($from.parent.type.name !== "paragraph") {
      return false;
    }

    const raw = $from.parent.textContent.trim();
    const execMatch = raw.match(/^\/exec\s+([\s\S]+)$/i);
    const command: SlashCommand | null = execMatch
      ? { name: "exec", args: execMatch[1].trim(), raw }
      : /^\/screenshot\s*$/i.test(raw)
        ? { name: "screenshot", raw }
        : null;

    if (!command) {
      return false;
    }

    event.preventDefault();
    view.dispatch(state.tr.delete($from.start(), $from.end()).scrollIntoView());
    this._emitter.emit("slashCommand", command);
    return true;
  }

  resetHistory() {
    // https://github.com/ueberdosis/tiptap/issues/491
    (this._editor.state as any).history$.prevRanges = null;
    (this._editor.state as any).history$.done.eventCount = 0;
    (this._editor.state as any).history$.done.items.values = [];
    (this._editor.state as any).history$.undone.eventCount = 0;
    (this._editor.state as any).history$.undone.items.values = [];

    Logger.info("[EditorService#resetHistory] history clear");
  }

  dispose() {
    this._editor.destroy();
  }
}
