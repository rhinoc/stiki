<script lang="ts">
import { onMount } from "svelte";
import throttle from "throttleit";
import PinFill from "../assets/icons/pin.fill.svelte";
import Pin from "../assets/icons/pin.svelte";
import type { ThemeService } from "../services/theme";
import type { WindowService } from "../services/window";
import ThemeIndicator from "./theme-indicator.svelte";

let {
  windowService,
  themeService,
  size,
}: {
  size: number;
  windowService: WindowService;
  themeService: ThemeService;
} = $props();

let isFloat = $state(false);

onMount(() => {
  isFloat = windowService.state.float;

  const dispose = windowService.on("float", (value) => {
    isFloat = value;
  });
  return () => {
    dispose();
  };
});

const toggleFloat = throttle(() => {
  windowService.toggleFloat();
}, 100);
</script>

<div class="header-toolbar" style="--item-size: {size}px">
  <ThemeIndicator size={size - 1} {themeService} />
  <div class="pin item svg-wrapper" onclick={toggleFloat}>
    {#if isFloat}
      <PinFill />
    {:else}
      <Pin />
    {/if}
  </div>
</div>

<style lang="scss">
  .header-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-font-2);

    :global(> *) {
      opacity: 0.8;

      &:hover {
        opacity: 1;
        filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.16));
      }
    }
  }

  .item {
    height: var(--item-size);
    width: var(--item-size);
    cursor: pointer;
  }
</style>
