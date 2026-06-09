<script lang="ts">
import { CheckMenuItem, Menu, MenuItem, Submenu } from "@tauri-apps/api/menu";
import { confirm, message, open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { onMount } from "svelte";
import Ellipsis from "../assets/icons/ellipsis.svelte";
import Mic from "../assets/icons/mic.svelte";
import Plus from "../assets/icons/plus.svelte";
import { JSON_EMPTY } from "../constants/json-content";
import type { EditorService } from "../services/editor";
import type { MarkdownFileService } from "../services/markdown-file";
import type { TabService } from "../services/tab";
import type { ThemeService } from "../services/theme";
import {
  TRANSCRIPT_BACKEND_OPTIONS,
  TRANSCRIPT_LANGUAGE_OPTIONS,
  TRANSCRIPT_SILENCE_TIMEOUT_OPTIONS,
  TRANSCRIPT_SPEAKER_COUNT_OPTIONS,
  TRANSCRIPT_SOURCE_OPTIONS,
  type TranscriptBackend,
  type TranscriptLocale,
  type TranscriptSilenceTimeoutMs,
  type TranscriptService,
  type TranscriptSpeakerCount,
  type TranscriptSource,
} from "../services/transcript";
import { getRandomEmoji } from "../utils/common/get-random-emoji";
import { getRandomID } from "../utils/common/get-random-id";

let {
  editorService,
  markdownFileService,
  tabService,
  themeService,
  transcriptService,
}: {
  editorService: EditorService;
  markdownFileService: MarkdownFileService;
  tabService: TabService;
  themeService: ThemeService;
  transcriptService: TranscriptService;
} = $props();

let isTranscriptRecording = $state(false);
let transcriptStatusText = $state("Start Transcript");
let lastShownTranscriptError = "";

onMount(() => {
  isTranscriptRecording = transcriptService.isRecording;
  transcriptStatusText = getTranscriptStatusText();

  const dispose = transcriptService.on("all", () => {
    isTranscriptRecording = transcriptService.isRecording;
    transcriptStatusText = getTranscriptStatusText();

    const error = transcriptService.state.error;
    if (error && error !== lastShownTranscriptError) {
      lastShownTranscriptError = error;
      void showTranscriptError(error);
    }
  });

  return () => {
    dispose();
  };
});

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

const showTranscriptError = async (error: unknown) => {
  await message(error instanceof Error ? error.message : String(error), {
    title: "Transcript",
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

const getTranscriptStatusText = () => {
  if (transcriptService.state.status === "starting") {
    return "Starting Transcript";
  }
  if (transcriptService.isRecording) {
    if (transcriptService.state.source === "system") {
      return "Stop Transcript (System)";
    }
    if (transcriptService.state.source === "microphone") {
      return "Stop Transcript (Mic)";
    }
    if (transcriptService.state.source === "both") {
      return "Stop Transcript (System + Mic)";
    }
    return "Stop Transcript";
  }
  if (transcriptService.state.status === "unsupported") {
    return "Transcript Unsupported";
  }
  return "Start Transcript";
};

const getTranscriptSourceLabel = () => {
  const activeSource = transcriptService.isRecording ? transcriptService.state.source : transcriptService.state.selectedSource;
  return TRANSCRIPT_SOURCE_OPTIONS.find((option) => option.source === activeSource)?.label ?? "System + Mic";
};

const getTranscriptLanguageLabel = () => {
  return TRANSCRIPT_LANGUAGE_OPTIONS.find((option) => option.locale === transcriptService.state.locale)?.label ?? "Auto";
};

const getTranscriptBackendLabel = () => {
  return TRANSCRIPT_BACKEND_OPTIONS.find((option) => option.backend === transcriptService.state.backend)?.label ?? "Apple Speech";
};

const getFunASRModelBundleLabel = () => {
  if (!transcriptService.state.funASRModelBundle) {
    return "None";
  }

  return (
    transcriptService.state.funASRModelBundleOptions.find((option) => option.model === transcriptService.state.funASRModelBundle)
      ?.label ??
    transcriptService.state.funASRModelBundle.split(/[\\/]/).at(-1) ??
    "None"
  );
};

const getTranscriptSpeakerCountLabel = () => {
  return (
    TRANSCRIPT_SPEAKER_COUNT_OPTIONS.find((option) => option.speakerCount === transcriptService.state.speakerCount)?.label ??
    "2"
  );
};

const getTranscriptSilenceTimeoutLabel = () => {
  return (
    TRANSCRIPT_SILENCE_TIMEOUT_OPTIONS.find(
      (option) => option.silenceTimeoutMs === transcriptService.state.silenceTimeoutMs,
    )?.label ?? "Balanced (1.2s)"
  );
};

const handleTranscriptToggle = async (source: TranscriptSource = transcriptService.state.selectedSource) => {
  if (transcriptService.isRecording) {
    transcriptService.stop();
    return;
  }

  try {
    await transcriptService.start(source);
    if (source === "system" && !transcriptService.state.hasSystemAudio) {
      await message("System audio was not available, so Stiki is recording microphone transcript only.", {
        title: "Transcript",
        kind: "info",
      });
    }
  } catch (error) {
    await showTranscriptError(error);
  }
};

const handleTranscriptSourceChange = (source: TranscriptSource) => {
  transcriptService.setSelectedSource(source);
};

const handleTranscriptLanguageChange = (locale: TranscriptLocale) => {
  transcriptService.setLocale(locale);
};

const handleTranscriptBackendChange = (backend: TranscriptBackend) => {
  transcriptService.setBackend(backend);
};

const handleFunASRModelBundleChange = (model: string) => {
  transcriptService.setFunASRModelBundle(model);
};

const handleTranscriptSpeakerCountChange = (speakerCount: TranscriptSpeakerCount) => {
  transcriptService.setSpeakerCount(speakerCount);
};

const handleTranscriptSilenceTimeoutChange = (silenceTimeoutMs: TranscriptSilenceTimeoutMs) => {
  transcriptService.setSilenceTimeoutMs(silenceTimeoutMs);
};

const handleOpenFunASRModelsDirectory = () => {
  void transcriptService.openFunASRModelsDirectory().catch(showTranscriptError);
};

const handleRefreshFunASRModelBundles = () => {
  void transcriptService.refreshFunASRModelBundles().catch(showTranscriptError);
};

const handleTranscriptTimestampChange = () => {
  transcriptService.setIncludeTimestamp(!transcriptService.state.includeTimestamp);
};

const handleTranscriptSpeakerChange = () => {
  transcriptService.setIncludeSpeaker(!transcriptService.state.includeSpeaker);
};

const handleClick = async () => {
  const currentTabHasFile = !!tabService.currentTab.filePath;
  if (!transcriptService.isRecording) {
    await transcriptService.refreshFunASRModelBundles().catch(showTranscriptError);
  }
  const transcriptItems = await Promise.all([
    Submenu.new({
      text: `Source: ${getTranscriptSourceLabel()}`,
      enabled: !transcriptService.isRecording,
      items: await Promise.all(
        TRANSCRIPT_SOURCE_OPTIONS.map((option) =>
          CheckMenuItem.new({
            text: option.label,
            checked: transcriptService.state.selectedSource === option.source,
            action: () => handleTranscriptSourceChange(option.source),
          }),
        ),
      ),
    }),
    Submenu.new({
      text: `Language: ${getTranscriptLanguageLabel()}`,
      enabled: !transcriptService.isRecording,
      items: await Promise.all(
        TRANSCRIPT_LANGUAGE_OPTIONS.map((option) =>
          CheckMenuItem.new({
            text: option.label,
            checked: transcriptService.state.locale === option.locale,
            action: () => handleTranscriptLanguageChange(option.locale),
          }),
        ),
      ),
    }),
    Submenu.new({
      text: `Backend: ${getTranscriptBackendLabel()}`,
      enabled: !transcriptService.isRecording,
      items: await Promise.all([
        ...TRANSCRIPT_BACKEND_OPTIONS.map((option) =>
          CheckMenuItem.new({
            text: option.label,
            checked: transcriptService.state.backend === option.backend,
            action: () => handleTranscriptBackendChange(option.backend),
          }),
        ),
        Submenu.new({
          text: `Model Bundle: ${getFunASRModelBundleLabel()}`,
          enabled: transcriptService.state.backend === "funasr-local",
          items: await Promise.all([
            ...transcriptService.state.funASRModelBundleOptions.map((option) =>
              CheckMenuItem.new({
                text: option.isLocal ? `${option.label} (Local)` : option.label,
                checked: transcriptService.state.funASRModelBundle === option.model,
                action: () => handleFunASRModelBundleChange(option.model),
              }),
            ),
            MenuItem.new({
              text: "Open Models Folder...",
              action: handleOpenFunASRModelsDirectory,
            }),
            MenuItem.new({
              text: "Refresh Models",
              action: handleRefreshFunASRModelBundles,
            }),
          ]),
        }),
      ]),
    }),
    Submenu.new({
      text: `Max Speakers: ${getTranscriptSpeakerCountLabel()}`,
      enabled: !transcriptService.isRecording && transcriptService.state.backend === "funasr-local",
      items: await Promise.all(
        TRANSCRIPT_SPEAKER_COUNT_OPTIONS.map((option) =>
          CheckMenuItem.new({
            text: option.label,
            checked: transcriptService.state.speakerCount === option.speakerCount,
            action: () => handleTranscriptSpeakerCountChange(option.speakerCount),
          }),
        ),
      ),
    }),
    Submenu.new({
      text: `Silence Timeout: ${getTranscriptSilenceTimeoutLabel()}`,
      enabled: !transcriptService.isRecording && transcriptService.state.backend === "funasr-local",
      items: await Promise.all(
        TRANSCRIPT_SILENCE_TIMEOUT_OPTIONS.map((option) =>
          CheckMenuItem.new({
            text: option.label,
            checked: transcriptService.state.silenceTimeoutMs === option.silenceTimeoutMs,
            action: () => handleTranscriptSilenceTimeoutChange(option.silenceTimeoutMs),
          }),
        ),
      ),
    }),
    Submenu.new({
      text: "Format",
      enabled: !transcriptService.isRecording,
      items: await Promise.all([
        CheckMenuItem.new({
          text: "Timestamp",
          checked: transcriptService.state.includeTimestamp,
          action: handleTranscriptTimestampChange,
        }),
        CheckMenuItem.new({
          text: "Speaker Labels",
          checked: transcriptService.state.includeSpeaker,
          action: handleTranscriptSpeakerChange,
        }),
      ]),
    }),
  ]);
  const menuItems = await Promise.all([
    Submenu.new({
      text: "Transcript",
      items: transcriptItems,
    }),
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
  <div
    class:active={isTranscriptRecording}
    class="icon svg-wrapper"
    onclick={() => {
      void handleTranscriptToggle();
    }}
    title={transcriptStatusText}
  >
    <Mic />
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

    &.active {
      color: var(--color-spice);
      opacity: 1;
    }
  }
</style>
