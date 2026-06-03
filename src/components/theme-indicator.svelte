<script lang="ts">
import { onMount } from "svelte";
import throttle from "throttleit";
import Theme from "../assets/icons/theme.svelte";
import type { ThemeService } from "../services/theme";
import { hex2oklch } from "../utils/color/oklch";

let {
  themeService,
  size,
}: {
  themeService: ThemeService;
  size: number;
} = $props();

let hexColorLight = $state("");
let hexColorDark = $state("");

onMount(() => {
  hexColorLight = themeService.spiceHexColor.light;
  hexColorDark = themeService.spiceHexColor.dark;

  const dipose = themeService.on("color", () => {
    hexColorLight = themeService.spiceHexColor.light;
    hexColorDark = themeService.spiceHexColor.dark;
  });
  return () => {
    dipose();
  };
});

const handleColorChange = throttle((e: Event, type: "light" | "dark") => {
  const input = e.target as HTMLInputElement;
  const hexColor = input.value;
  if (!hexColor) {
    return;
  }
  const oklchColor = hex2oklch(hexColor);
  themeService.setState("color", {
    ...themeService.state.color,
    spice: {
      ...themeService.state.color.spice,
      [type]: oklchColor,
    },
  });
}, 100);
</script>

<div class="theme-indicator" style="--item-height: {size}px;">
  <div class="svg-wrapper">
    <Theme />
  </div>
  <input
    class="light"
    type="color"
    value={hexColorLight}
    onchange={(e) => handleColorChange(e, "light")}
  />
  <input
    class="dark"
    type="color"
    value={hexColorDark}
    onchange={(e) => handleColorChange(e, "dark")}
  />
</div>

<style lang="scss">
  .theme-indicator {
    position: relative;
    height: var(--item-height);
    width: var(--item-height);
    outline: 1px solid transparent;

    overflow: hidden;

    transition: all 120ms ease-in;

    border-radius: 4px;

    &:hover {
      width: calc(var(--item-height) * 2);
      opacity: 1;
      outline: 1px solid var(--color-font-4);

      .svg-wrapper {
        opacity: 0;
      }

      .light,
      .dark {
        opacity: 1;
      }
    }

    .light,
    .dark {
      position: absolute;
      top: 0;
      opacity: 0;

      width: 50%;
      height: 100%;

      appearance: none;
      -webkit-appearance: none;
      border: none;
      padding: 0;
      background-color: transparent;

      cursor: pointer;

      &::-webkit-color-swatch,
      &::-webkit-color-swatch-wrapper {
        padding: 0;
        border: none;
        border-top-left-radius: 0px;
        border-top-right-radius: 0px;
        border-bottom-left-radius: 0px;
        border-bottom-right-radius: 0px;
      }
    }

    .light {
      left: 0px;
    }

    .dark {
      right: 0px;
    }
  }

  .svg-wrapper {
    position: absolute;
    top: 0;
    width: var(--item-height);
    height: var(--item-height);
    pointer-events: none;
  }
</style>
