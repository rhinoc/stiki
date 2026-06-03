<script lang="ts">
import { CheckMenuItem, Menu, MenuItem, Submenu } from "@tauri-apps/api/menu";
import { confirm, message, open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import Ellipsis from "../assets/icons/ellipsis.svelte";
import Plus from "../assets/icons/plus.svelte";
import { JSON_EMPTY } from "../constants/json-content";
import type { EditorService } from "../services/editor";
import type { MarkdownFileService } from "../services/markdown-file";
import type { TabService } from "../services/tab";
import type { ThemeService } from "../services/theme";
import { getRandomEmoji } from "../utils/common/get-random-emoji";
import { getRandomID } from "../utils/common/get-random-id";

let {
  editorService,
  markdownFileService,
  tabService,
  themeService,
}: {
  editorService: EditorService;
  markdownFileService: MarkdownFileService;
  tabService: TabService;
  themeService: ThemeService;
} = $props();

const markdownFilters = [
  {
    name: "Markdown",
    extensions: ["md", "markdown"],
  },
];

const ensureMarkdownExtension = (path: string) => {
  return /\.[^/\\.]+$/.test(path) ? path : `${path}.md`;
};

const getFileName = (path: string) => {
  const name = path.split(/[\\/]/).at(-1) ?? "";
  return name.replace(/\.(md|markdown)$/i, "") || name;
};

const showMarkdownFileError = async (error: unknown) => {
  await message(error instanceof Error ? error.message : String(error), {
    title: "Markdown File",
    kind: "error",
  });
};

const runMarkdownFileAction = (action: () => Promise<void> | void) => {
  void Promise.resolve(action()).catch(showMarkdownFileError);
};

const handleTabAdd = () => {
  tabService.addTab(
    {
      key: getRandomID(),
      json: JSON_EMPTY,
      label: getRandomEmoji(),
      anchor: 0,
    },
    true,
  );
};

const handleLinkCurrentTab = async () => {
  const selected = await save({
    title: "Link Current Tab to Markdown File",
    filters: markdownFilters,
    defaultPath: `${tabService.currentTab.label}.md`,
    canCreateDirectories: true,
  });

  if (!selected) {
    return;
  }

  const path = ensureMarkdownExtension(selected);
  tabService.updateCurrentTab({ filePath: path });
  await markdownFileService.write(path, editorService.getContent("markdown"));
};

const handleOpenIntoCurrentTab = async () => {
  const selected = await open({
    title: "Open Markdown File into Current Tab",
    filters: markdownFilters,
    multiple: false,
  });

  if (!selected || Array.isArray(selected)) {
    return;
  }

  const ok = await confirm("Replace the current tab content with this Markdown file?", {
    title: "Open Markdown File",
    kind: "warning",
    okLabel: "Open",
    cancelLabel: "Cancel",
  });

  if (!ok) {
    return;
  }

  const content = await markdownFileService.read(selected);
  editorService.setContentFromMarkdown(content);
  tabService.updateCurrentTab({
    filePath: selected,
    label: getFileName(selected),
  });
};

const handleSaveCurrentTab = async () => {
  if (!tabService.currentTab.filePath) {
    await message("Current tab is not linked to a Markdown file.", {
      title: "Save Markdown File",
      kind: "info",
    });
    return;
  }

  await markdownFileService.saveTabImmediately(tabService.currentTab, editorService.getContent("markdown"));
};

const handleUnlinkCurrentTab = () => {
  tabService.updateCurrentTab({ filePath: undefined });
};

const handleClick = async () => {
  const currentTabHasFile = !!tabService.currentTab.filePath;
  const menuItems = await Promise.all([
    Submenu.new({
      text: "Markdown File",
      items: await Promise.all([
        MenuItem.new({
          text: "Link Current Tab...",
          action: () => runMarkdownFileAction(handleLinkCurrentTab),
        }),
        MenuItem.new({
          text: "Open into Current Tab...",
          action: () => runMarkdownFileAction(handleOpenIntoCurrentTab),
        }),
        MenuItem.new({
          text: "Save Current Tab Now",
          enabled: currentTabHasFile,
          action: () => runMarkdownFileAction(handleSaveCurrentTab),
        }),
        MenuItem.new({
          text: "Unlink Current Tab",
          enabled: currentTabHasFile,
          action: handleUnlinkCurrentTab,
        }),
      ]),
    }),
    Submenu.new({
      text: "Export to Clipboard",
      items: await Promise.all([
        MenuItem.new({
          text: "Plain Text",
          action: () => {
            const text = editorService.getContent("text");
            writeText(text);
          },
        }),
        MenuItem.new({
          text: "Markdown",
          action: () => {
            const text = editorService.getContent("markdown");
            writeText(text);
          },
        }),
        MenuItem.new({
          text: "HTML",
          action: () => {
            const text = editorService.getContent("html");
            writeText(text);
          },
        }),
        MenuItem.new({
          text: "JSON",
          action: () => {
            const text = editorService.getContent("json");
            writeText(text);
          },
        }),
      ]),
    }),
    CheckMenuItem.new({
      text: "Power Mode",
      checked: themeService.state.powerMode,
      action: () => {
        themeService.setState("powerMode", !themeService.state.powerMode);
      },
    }),
  ]);
  const menu = await Menu.new({
    items: menuItems,
  });
  await menu.popup();
};
</script>

<div class="toolbar">
  <div class="icon svg-wrapper" onclick={handleTabAdd}>
    <Plus />
  </div>
  <div class="icon svg-wrapper" onclick={handleClick}>
    <Ellipsis />
  </div>
</div>

<style lang="scss">
  $icon-size: 12px;

  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .icon {
    height: $icon-size;
    width: $icon-size;
    cursor: pointer;

    opacity: 0.8;

    &:hover {
      opacity: 1;
      filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.16));
    }
  }
</style>
