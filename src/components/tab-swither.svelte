<script lang="ts">
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { onMount } from "svelte";
import Checkmark from "../assets/icons/checkmark.svelte";
import Chevron from "../assets/icons/chevron.left.svelte";
import XMark from "../assets/icons/xmark.svelte";
import { JSON_EMPTY } from "../constants/json-content";
import type { TabService } from "../services/tab";
import type { TabConfig } from "../types/tab";
import { canScroll } from "../utils/common/can-scroll";
import { getRandomEmoji } from "../utils/common/get-random-emoji";

let container: HTMLDivElement;
let iconInput = $state<HTMLInputElement | null>(null);
const {
  tabService,
  onClickItem,
}: {
  tabService: TabService;
  onClickItem?: (key: string) => void;
} = $props();

// #region state
let activeTabKey = $state("");
let tabs = $state<TabConfig[]>([]);
let canScrollLeft = $state(false);
let canScrollRight = $state(false);
let showIconInput = $state(false);
// #endregion state
let currentEditTabKey = "";

const updateCanScroll = () => {
  ({ canScrollLeft, canScrollRight } = canScroll(container));
};

onMount(() => {
  activeTabKey = tabService.state.current;
  tabs = tabService.state.tabs;
  updateCanScroll();

  const dispose = tabService.on("all", ([state]) => {
    tabs = state.tabs;
    if (state.current !== activeTabKey) {
      activeTabKey = state.current;
      requestAnimationFrame(() => {
        // need to wait for render refresh
        scrollToTab(activeTabKey);
      });
    }
  });

  // listen for scroll
  container.addEventListener("scroll", updateCanScroll);
  // listen for resize
  const resizeObserver = new ResizeObserver(() => {
    updateCanScroll();
  });
  resizeObserver.observe(container);

  return () => {
    container.removeEventListener("scroll", updateCanScroll);
    resizeObserver.disconnect();
    dispose();
  };
});

const handleSwitch = (key: string) => {
  onClickItem?.(key);
  if (activeTabKey === key) {
    return;
  }
  tabService.setCurrentTab(key);
};

const scrollToTab = (key: string) => {
  const containerWidth = container.clientWidth;
  const index = tabs.findIndex((tab) => tab.key === key);
  const itemWidth = container.scrollWidth / tabs.length;
  const scrollLeft = Math.min(
    Math.max(0, index * itemWidth + itemWidth / 2 - containerWidth / 2),
    container.scrollWidth - containerWidth,
  );
  container.scrollTo({
    behavior: "smooth",
    left: scrollLeft,
  });
};

const handleScrollPrev = () => {
  container?.scrollBy({
    behavior: "smooth",
    left: container.clientWidth * -1,
  });
};

const handleScrollNext = () => {
  container?.scrollBy({
    behavior: "smooth",
    left: container.clientWidth,
  });
};

const handleContextMenu = async (key: string) => {
  const menuItems = await Promise.all([
    MenuItem.new({
      text: "Change Label",
      action: () => {
        currentEditTabKey = key;
        showIconInput = true;
        requestAnimationFrame(() => {
          iconInput?.focus();
        });
      },
    }),
    MenuItem.new({
      text: "Change Label (Random)",
      action: () => {
        tabService.updateTab(key, {
          label: getRandomEmoji(),
        });
      },
    }),
    PredefinedMenuItem.new({
      item: "Separator",
    }),
    MenuItem.new({
      text: "Empty",
      action: () => {
        tabService.updateTab(key, {
          json: JSON_EMPTY,
        });
      },
    }),
    MenuItem.new({
      text: "Delete",
      action: () => {
        tabService.deleteTab(key);
      },
    }),
  ]);
  const menu = await Menu.new({
    items: menuItems,
  });
  await menu.popup();
};

// #region label input
let inputValue = "";

const handleInput = (event: Event & { currentTarget: HTMLInputElement }) => {
  inputValue = event.currentTarget.value;
};

const handleEditDone = () => {
  currentEditTabKey = "";
  inputValue = "";
  showIconInput = false;
};

const handleInputCancel = () => {
  handleEditDone();
};

const handleInputOk = () => {
  if (currentEditTabKey && inputValue) {
    tabService.updateTab(currentEditTabKey, {
      label: inputValue,
    });
  }
  handleEditDone();
};
// #endregion label input
</script>

<div class="tab-switcher-wrapper" class:hidden={showIconInput}>
  <div
    class="tab-switcher"
    class:can-scroll-left={canScrollLeft}
    class:can-scroll-right={canScrollRight}
    bind:this={container}
  >
    {#each tabs as tab}
      <div
        id={`tab_${tab.key}`}
        class="item"
        class:item--active={activeTabKey === tab.key}
        class:item--linked={!!tab.filePath}
        title={tab.filePath ?? tab.label}
        onclick={() => handleSwitch(tab.key)}
        oncontextmenu={(e) => {
          e.preventDefault();
          handleContextMenu(tab.key);
          return false;
        }}
      >
        {tab.label}
      </div>
    {/each}
  </div>
  <!-- buttons are placed on the bottom to have higher layer so that can be clicked -->
  {#if canScrollLeft}
    <div class="prev svg-wrapper" onclick={handleScrollPrev}>
      <Chevron />
    </div>
  {/if}
  {#if canScrollRight}
    <div class="next svg-wrapper" onclick={handleScrollNext}>
      <Chevron />
    </div>
  {/if}
</div>
{#if showIconInput}
  <div class="icon-input-wrapper">
    <div class="svg-wrapper" onclick={handleInputCancel}>
      <XMark />
    </div>
    <input
      type="text"
      placeholder={tabs.find((tab) => tab.key === currentEditTabKey)?.label}
      bind:this={iconInput}
      maxlength="10"
      oninput={handleInput}
      onkeydown={(event) => {
        if (event.key === "Enter") {
          handleInputOk();
        } else if (event.key === "Escape") {
          handleInputCancel();
        }
      }}
    />
    <div class="svg-wrapper" onclick={handleInputOk}>
      <Checkmark />
    </div>
  </div>
{/if}

<style lang="scss">
  $item-size: 16px;
  $font-size: 12px;

  .hidden {
    visibility: hidden;
    width: 0;
    height: 0;
  }

  .tab-switcher-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: 100%;
    overflow: hidden;
    pointer-events: all;
  }

  .prev,
  .next {
    position: absolute;
    top: calc(($item-size - $font-size) / 2);
    height: $font-size;
    width: $font-size;
    color: var(--color-font-3);
    flex-grow: 0;
    flex-shrink: 0;
    cursor: pointer;
    pointer-events: all;
    transition: opacity 200ms ease-in-out;
    opacity: 0;
    visibility: hidden;

    &:hover {
      color: var(--colo-font-2);
    }
  }

  .tab-switcher-wrapper:hover {
    .prev,
    .next {
      opacity: 1;
      visibility: visible;
    }
  }

  .prev {
    left: 0;
  }

  .next {
    transform: rotate(180deg);
    right: 0;
  }

  .can-scroll-left {
    mask-image: linear-gradient(
      to right,
      transparent 0%,
      black $item-size,
      black 100%
    );
  }

  .can-scroll-right {
    mask-image: linear-gradient(
      to right,
      black 0%,
      black calc(100% - $item-size),
      transparent 100%
    );
  }

  .can-scroll-left.can-scroll-right {
    mask-image: linear-gradient(
      to right,
      transparent 0%,
      black $item-size,
      black calc(100% - $item-size),
      transparent 100%
    );
  }

  .tab-switcher {
    display: flex;
    align-items: center;
    gap: 8px;

    width: fit-content;
    overflow-y: hidden;
    overflow-x: scroll;

    .item {
      display: flex;
      justify-content: center;
      align-items: center;
      flex-grow: 0;
      flex-shrink: 0;

      height: $item-size;
      width: $item-size;
      font-size: $font-size;
      font-weight: bold;
      overflow: hidden;

      color: var(--color-spice);
      user-select: none;
      -webkit-user-select: none;
      cursor: pointer;
      border-bottom: 1px solid transparent;
      filter: grayscale(100%);
      opacity: 0.75;

      transition: all 100ms ease-in;

      &:hover {
        filter: grayscale(50%);
      }

      &--active {
        filter: grayscale(0%) drop-shadow(0 0 1px rgba(0, 0, 0, 0.16)) !important;
        opacity: 1;
      }

      &--linked {
        border-bottom-color: var(--color-font-3);
      }
    }
  }

  .icon-input-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: all;

    .svg-wrapper {
      height: $font-size - 2px;
      width: $font-size -2px;
      color: var(--color-font-2);
      flex-grow: 0;
      flex-shrink: 0;
      cursor: pointer;
      transition: color 100ms ease-in;

      &:hover {
        color: var(--color-font-1);
      }
    }

    & > input {
      background: transparent;
      border: 1px dashed var(--color-font-4);
      border-radius: 4px;
      padding: 1px 2px;
      font-weight: bold;
      width: 5rem;
      color: var(--color-spice);
      font-size: $font-size;

      &::placeholder {
        color: var(--color-spice);
        opacity: 0.5;
      }

      &:focus {
        border: 1px solid var(--color-font-3);
        outline: none;
      }
    }
  }
</style>
