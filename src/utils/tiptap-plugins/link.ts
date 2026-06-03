import { open } from "@tauri-apps/plugin-shell";
import { getAttributes, InputRule, markInputRule, markPasteRule, PasteRule } from "@tiptap/core";
import TipTapLink, { type LinkOptions } from "@tiptap/extension-link";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const inputRegex = /(?:^|\s)\[([^\]]*)?\]\((\S+)(?: ["“](.+)["”])?\)$/i;

const pasteRegex = /(?:^|\s)\[([^\]]*)?\]\((\S+)(?: ["“](.+)["”])?\)/gi;

function inputRule(config: Parameters<typeof markInputRule>[0]) {
  const defaultMarkInputRule = markInputRule(config);

  return new InputRule({
    find: config.find,
    handler(props) {
      const { tr } = props.state;

      defaultMarkInputRule.handler(props);
      tr.setMeta("preventAutolink", true);
    },
  });
}

function pasteRule(config: Parameters<typeof markPasteRule>[0]) {
  const defaultMarkPasteRule = markPasteRule(config);

  return new PasteRule({
    find: config.find,
    handler(props) {
      const { tr } = props.state;

      defaultMarkPasteRule.handler(props);
      tr.setMeta("preventAutolink", true);
    },
  });
}

/**
 * Add custom features to TipTap Link extension
 * 1. cmd + click will open the link
 * 2. support markdown url syntax (https://github.com/Doist/typist/blob/main/src/extensions/rich-text/rich-text-link.ts)
 */
const Link = TipTapLink.extend({
  inclusive: false,
  addOptions() {
    const parentOptions = this.parent?.() as LinkOptions;
    return {
      ...parentOptions,
      openOnClick: false,
      HTMLAttributes: {
        ...parentOptions.HTMLAttributes,
        target: "_custom", // @hack disable tauri default behavior
      },
    };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      title: {
        default: null,
      },
    };
  },
  addInputRules() {
    return [
      inputRule({
        find: inputRegex,
        type: this.type,

        // We need to use `pop()` to remove the last capture groups from the match to
        // satisfy Tiptap's `markPasteRule` expectation of having the content as the last
        // capture group in the match (this makes the attribute order important)
        getAttributes(match) {
          return {
            title: match.pop()?.trim(),
            href: match.pop()?.trim(),
          };
        },
      }),
    ];
  },
  addPasteRules() {
    return [
      pasteRule({
        find: pasteRegex,
        type: this.type,

        // We need to use `pop()` to remove the last capture groups from the match to
        // satisfy Tiptap's `markInputRule` expectation of having the content as the last
        // capture group in the match (this makes the attribute order important)
        getAttributes(match) {
          return {
            title: match.pop()?.trim(),
            href: match.pop()?.trim(),
          };
        },
      }),
    ];
  },
  addProseMirrorPlugins() {
    const plugins: Plugin[] = this.parent?.() || [];

    const plugin = new Plugin({
      key: new PluginKey("CustomLink"),
      props: {
        handleClick(view, pos, event) {
          const attrs = getAttributes(view.state, "link");
          if (!attrs.href) {
            return false;
          }
          const isCmdPressed = event.ctrlKey || event.metaKey;
          if (!isCmdPressed) {
            return false;
          }

          event.preventDefault();
          event.stopImmediatePropagation();
          open(attrs.href);
          return true;
        },
      },
    });

    plugins.push(plugin);

    return plugins;
  },
});

export default Link;
