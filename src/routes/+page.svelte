<script lang="ts">
import "../styles/helper.css";
import "../styles/highlight.css";
import "../styles/variables/index.scss";

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { onDestroy, onMount } from "svelte";
import FooterToolbar from "../components/footer-toolbar.svelte";
import HeaderToolbar from "../components/header-toolbar.svelte";
import TabSwither from "../components/tab-swither.svelte";
import TextEditor from "../components/text-editor.svelte";
import WindowControl from "../components/window-control.svelte";
import {
  HEADER_HEIGHT,
  MARKDOWN_FILE_SAVE_WAIT,
  MIN_HEIGHT,
  MIN_WIDTH,
  SAVE_PATH,
  SAVE_WAIT,
} from "../constants/app-conf";
import { DeepLink } from "../constants/deep-link";
import { TauriCommand } from "../constants/tauri-command";
import { EditorService } from "../services/editor";
import { MarkdownFileService } from "../services/markdown-file";
import { SaveService, StateKey } from "../services/save";
import { TabService } from "../services/tab";
import { ThemeService } from "../services/theme";
import { restoreState } from "../services/utils/restore";
import { WindowService } from "../services/window";
import { captureGlobalError, logEnvInfo, Logger } from "../utils/common/logger";
import { confettiPoper } from "../utils/confetti/poper";
import { listenForContextMenu } from "../utils/listener";

const disposeFns: (() => void)[] = [];

// #region service
const themeService = new ThemeService();

const editorService = new EditorService();
disposeFns.push(() => {
  editorService.dispose();
});

const windowService = new WindowService({
  headerHeight: HEADER_HEIGHT,
  minWidth: MIN_WIDTH,
  minHeight: MIN_HEIGHT,
});
disposeFns.push(() => {
  windowService.dispose();
});

const saveService = new SaveService({
  savePath: SAVE_PATH,
  saveWaitTime: SAVE_WAIT,
});

const markdownFileService = new MarkdownFileService({
  saveWaitTime: MARKDOWN_FILE_SAVE_WAIT,
});

const tabService = new TabService();
// #endregion service

// #region global listener
onOpenUrl((urls) => {
  invoke(TauriCommand.HideDockIcon);
  Logger.info("[page#onMount] onOpenUrl", urls);
  if (urls.length > 0) {
    const url = urls[0];
    const urlObj = new URL(url);
    switch (urlObj.host) {
      case DeepLink.ToggleWindow:
        invoke(TauriCommand.ToggleWindow);
        break;
      case DeepLink.Open: {
        invoke(TauriCommand.ShowWindow);
        const tabKey = urlObj.searchParams.get("tabKey");
        if (tabKey) {
          tabService.setCurrentTab(tabKey);
        }
        break;
      }
      default:
        invoke(TauriCommand.ShowWindow);
        break;
    }
  }
});
// #endregion global listener

// #region state
let hasPrepared = $state(false);
let isFold = $state(false);
// #endregion state

onMount(async () => {
  Logger.info("[page#onMount] called");
  logEnvInfo();

  disposeFns.push(captureGlobalError());
  const perfEnd = Logger.perf("page#onMount");

  // prevent context menu
  const disposeContextMenu = listenForContextMenu((e) => {
    const srcElement = e.target as HTMLElement;
    const editorElement = editorService.element;
    if (srcElement && editorElement && editorElement.contains(srcElement)) {
      return;
    }
    e.preventDefault();
  });
  disposeFns.push(disposeContextMenu);

  // #region restore from store
  await saveService.init();
  await restoreState({
    editorService,
    tabService,
    windowService,
    themeService,
    stateValues: saveService.getAll(),
  });
  await windowService.init(); // in case restored data is invalid, init later to overwrite
  saveService.startSaveToDisk();
  // #endregion restore from store

  // #region set initial state
  isFold = windowService.state.fold;
  // #endregion set initial state

  // #region init service listeners
  disposeFns.push(
    themeService.on("all", ([state]) => {
      saveService.set(StateKey.ThemeState, state);
    }),
  );

  disposeFns.push(
    editorService.on("all", ([state]) => {
      tabService.updateCurrentTab(state);
      markdownFileService.queueSave(tabService.currentTab, editorService.getContent("markdown"));
    }),
  );

  disposeFns.push(
    editorService.on("anchor", () => {
      confettiPoper.shootByCaret(14, themeService.currentSpiceHexColor);
    }),
  );

  disposeFns.push(
    editorService.on("taskItemChange", (event) => {
      if (event.target && (event.target as HTMLInputElement).checked) {
        confettiPoper.shootByClick(event.target as HTMLElement, themeService.currentSpiceHexColor);
      }
    }),
  );

  disposeFns.push(
    windowService.on("all", ([state]) => {
      saveService.set(StateKey.WindowState, state);
      isFold = state.fold;
      if (state.fold) {
        saveService.save(); // save when window is folded
      }
    }),
  );

  const disposeTab = tabService.on("all", ([state, keys]) => {
    saveService.set(StateKey.TabState, state);
    editorService.restoreFromState(tabService.currentEditorState, {
      emit: false,
    });
    if (keys.includes("current") && confettiPoper.enabled) {
      requestAnimationFrame(() => {
        const { current, tabs } = state;
        const el = document.querySelector(`#tab_${current}`);
        const label = tabs.find((tab) => tab.key === current)?.label;
        if (el && label) {
          confettiPoper.shootByClick(el as HTMLElement, themeService.currentSpiceHexColor, [label]);
        }
      });
    }
  });
  disposeFns.push(disposeTab);
  // #endregion init service listeners

  hasPrepared = true;
  await getCurrentWindow().show();

  perfEnd();
});

onDestroy(() => {
  Logger.info("[page#onDestroy] called");
  saveService.saveImmediately();
  markdownFileService.saveImmediately();
  disposeFns.forEach((fn) => fn());
});

const handleTabClick = () => {
  if (windowService.state.fold) {
    windowService.setState("fold", false);
  }
};
</script>

<div id="root">
  {#if hasPrepared}
    <header data-tauri-drag-region>
      <WindowControl {windowService} />
      <HeaderToolbar size={15} {windowService} {themeService} />
    </header>
    <main class:main--fold={isFold}>
      <TextEditor {editorService} />
    </main>
    <footer class:footer--fold={isFold}>
      <div class="left"></div>
      <div class="center">
        <TabSwither {tabService} onClickItem={handleTabClick} />
      </div>
      <div class="right">
        <FooterToolbar {editorService} {markdownFileService} {tabService} {themeService} />
      </div>
    </footer>
  {/if}
</div>

<style lang="scss">
  $padding: 8px;

  #root {
    position: relative;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    border-radius: 10px;
    color: var(--color-font-1);
    background-color: var(--color-spice-alpha-4);

    > header {
      height: var(--header-height);
      width: 100%;

      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0px $padding;
      gap: 16px;
    }

    > main {
      display: flex;

      width: 100%;
      height: calc(100% - var(--header-height));
      overflow: hidden;

      &.main--fold {
        visibility: hidden;
      }
    }

    > footer {
      position: absolute;
      bottom: 0px;

      display: flex;
      align-items: center;
      justify-content: center;

      width: 100%;
      height: var(--footer-height);

      z-index: var(--z-index-footer);

      &.footer--fold {
        pointer-events: none;

        .left,
        .right {
          opacity: 0;
          visibility: hidden;
        }
      }

      .left,
      .right {
        width: 75px;
        flex-grow: 0;
        flex-shrink: 0;
        transition: opacity 200ms ease-in;
      }

      .left {
        display: flex;
        justify-content: flex-start;
        padding-left: $padding;
      }

      .center {
        display: flex;
        justify-content: center;
        align-items: center;
        flex-grow: 1;
        overflow: hidden;
      }

      .right {
        display: flex;
        justify-content: flex-end;
        padding-right: $padding;
      }
    }
  }
</style>
