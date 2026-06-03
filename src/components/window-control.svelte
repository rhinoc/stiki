<script lang="ts">
import { onMount } from "svelte";
import throttle from "throttleit";
import type { WindowService } from "../services/window";

let {
  windowService,
}: {
  windowService: WindowService;
} = $props();

let isFold = $state(false);

onMount(() => {
  isFold = windowService.state.fold;

  const dispose = windowService.on("fold", (val) => {
    isFold = val;
  });
  return () => {
    dispose();
  };
});

const handleClose = throttle(() => {
  windowService.close();
}, 100);

const handleMinimize = throttle(() => {
  windowService.minimize();
}, 100);

const handleFoldChange = throttle(() => {
  windowService.toggleFold();
}, 100);
</script>

<div class="window-control">
  <div class="icon icon--close" onclick={handleClose}>
    <div class="line line--tl"></div>
    <div class="line line--tr"></div>
  </div>
  <div class="icon icon--minimize" onclick={handleMinimize}>
    <div class="line"></div>
  </div>
  <div
    class="icon"
    class:icon--unfold={!isFold}
    class:icon--fold={isFold}
    onclick={handleFoldChange}
  >
    <div class="triangle triangle--tl"></div>
    <div class="triangle triangle--br"></div>
  </div>
</div>

<style lang="scss">
  $icon-size: 12px;
  $triangle-offset: 2px;
  $icon-symbol-color: rgba(0, 0, 0, 0.45);

  .window-control {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-grow: 0;
    flex-shrink: 0;
    overflow: hidden;

    .line,
    .triangle {
      opacity: 0;
      visibility: hidden;
    }

    &:hover .line,
    &:hover .triangle {
      opacity: 1;
      visibility: visible;
    }
  }

  .icon {
    position: relative;

    display: flex;
    align-items: center;
    justify-content: center;

    width: $icon-size;
    height: $icon-size;
    border-radius: 50%;

    border: 1px solid #00000010;
    cursor: pointer;

    &:focus,
    &:active {
      filter: brightness(var(--brightness-active));
    }

    &--close {
      background-color: var(--color-close);
    }

    &--minimize {
      background-color: var(--color-minimize);
    }

    &--fold,
    &--unfold {
      background-color: var(--color-maximize);
    }

    &--fold {
      .triangle--tl {
        top: $triangle-offset;
        left: $triangle-offset;
      }

      .triangle--br {
        bottom: $triangle-offset;
        right: $triangle-offset;
      }
    }

    &--unfold {
      .triangle--tl {
        bottom: 0;
        right: 0;
      }

      .triangle--br {
        top: 0;
        left: 0;
      }
    }
  }

  .line {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);

    height: 1.5px;
    width: 8px;
    border-radius: 2px;
    background-color: $icon-symbol-color;

    // &--t {
    //   transform: translate(-50%, -50%) rotate(90deg);
    // }

    &--tl {
      transform: translate(-50%, -50%) rotate(45deg);
    }

    &--tr {
      transform: translate(-50%, -50%) rotate(-45deg);
    }
  }

  .triangle {
    position: absolute;
    width: 0px;
    height: 0px;
    border-style: solid;
    border-width: 5px 5px 0 0;
    border-color: $icon-symbol-color transparent transparent transparent;

    &--tl {
      transform: rotate(0deg);
    }

    &--br {
      transform: rotate(180deg);
    }
  }
</style>
