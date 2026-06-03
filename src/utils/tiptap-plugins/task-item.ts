import { wrappingInputRule } from "@tiptap/core";
import TipTapTaskItem from "@tiptap/extension-task-item";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** match both `[]` and `【】` */
export const inputRegex = /^\s*([\[【]([( |x])?[\]】])\s$/;

export interface TaskItemOptions {
  /**
   * A callback function that is called when the checkbox is clicked while the editor is in readonly mode.
   * @param node The prosemirror node of the task item
   * @param checked The new checked state
   * @returns boolean
   */
  onReadOnlyChecked?: (node: ProseMirrorNode, checked: boolean) => boolean;

  /**
   * Controls whether the task items can be nested or not.
   * @default false
   * @example true
   */
  nested: boolean;

  /**
   * HTML attributes to add to the task item element.
   * @default {}
   * @example { class: 'foo' }
   */
  HTMLAttributes: Record<string, any>;

  /**
   * The node type for taskList nodes
   * @default 'taskList'
   * @example 'myCustomTaskList'
   */
  taskListTypeName: string;

  onChange?: (event: Event) => void;
}

const TaskItem = TipTapTaskItem.extend<TaskItemOptions>({
  addInputRules() {
    return [
      wrappingInputRule({
        find: inputRegex,
        type: this.type,
        getAttributes: (match) => ({
          checked: match[match.length - 1] === "x",
        }),
      }),
    ];
  },
  addNodeView() {
    // modified original plugin, add confetti effect
    return ({ node, HTMLAttributes, getPos, editor }) => {
      const listItem = document.createElement("li");
      const checkboxWrapper = document.createElement("label");
      const checkboxStyler = document.createElement("span");
      const checkbox = document.createElement("input");
      const content = document.createElement("div");

      checkboxWrapper.contentEditable = "false";
      checkbox.type = "checkbox";
      checkbox.addEventListener("mousedown", (event) => event.preventDefault());
      checkbox.addEventListener("change", (event) => {
        this.options.onChange?.(event);

        // if the editor isn’t editable and we don't have a handler for
        // readonly checks we have to undo the latest change
        if (!editor.isEditable && !this.options.onReadOnlyChecked) {
          checkbox.checked = !checkbox.checked;

          return;
        }

        const { checked } = event.target as any;

        if (editor.isEditable && typeof getPos === "function") {
          editor
            .chain()
            .focus(undefined, { scrollIntoView: false })
            .command(({ tr }) => {
              const position = getPos();

              if (typeof position !== "number") {
                return false;
              }
              const currentNode = tr.doc.nodeAt(position);

              tr.setNodeMarkup(position, undefined, {
                ...currentNode?.attrs,
                checked,
              });

              return true;
            })
            .run();
        }
        if (!editor.isEditable && this.options.onReadOnlyChecked) {
          // Reset state if onReadOnlyChecked returns false
          if (!this.options.onReadOnlyChecked(node, checked)) {
            checkbox.checked = !checkbox.checked;
          }
        }
      });

      Object.entries(this.options.HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, value);
      });

      listItem.dataset.checked = node.attrs.checked;
      if (node.attrs.checked) {
        checkbox.setAttribute("checked", "checked");
      }

      checkboxWrapper.append(checkbox, checkboxStyler);
      listItem.append(checkboxWrapper, content);

      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        listItem.setAttribute(key, value);
      });

      return {
        dom: listItem,
        contentDOM: content,
        update: (updatedNode) => {
          if (updatedNode.type !== this.type) {
            return false;
          }

          listItem.dataset.checked = updatedNode.attrs.checked;
          if (updatedNode.attrs.checked) {
            checkbox.setAttribute("checked", "checked");
          } else {
            checkbox.removeAttribute("checked");
          }

          return true;
        },
      };
    };
  },
});

export default TaskItem;
