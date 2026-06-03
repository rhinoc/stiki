<script lang="ts">
  import { onMount } from "svelte";
  import type { EditorService } from "../services/editor";
  import "../styles/tiptap.css";
  import { canScroll } from "../utils/common/can-scroll";
  import { listenForCtrlPress } from "../utils/listener";

  let container: Element;

  let {
    editorService,
  }: {
    editorService: EditorService;
  } = $props();

  const updateCanScroll = () => {
    const { canScrollUp, canScrollDown } = canScroll(editorService.element);
    editorService.element.classList.toggle("can-scroll-up", canScrollUp);
    editorService.element.classList.toggle("can-scroll-down", canScrollDown);
  };

  onMount(() => {
    updateCanScroll();

    // listen for scroll
    editorService.element.addEventListener("scroll", updateCanScroll);
    // listen for resize
    const resizeObserver = new ResizeObserver(updateCanScroll);
    resizeObserver.observe(editorService.element);

    editorService.element.classList.add("text-editor");
    container.appendChild(editorService.element);
    const dispose = listenForCtrlPress((pressed) => {
      editorService.element.classList.toggle("ctrl", pressed);
    });
    return () => {
      editorService.element.removeEventListener("scroll", updateCanScroll);
      resizeObserver.disconnect();
      dispose();
    };
  });
</script>

<div class="text-editor-wrapper" bind:this={container}></div>

<style lang="scss">
  $mask-blur-size-top: 1rem;
  $mask-blur-size-bottom: 28px;
  $mask-blur-size-bottom-padding: 1rem;

  .text-editor-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  :global(.text-editor) {
    width: 100%;
    height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
  }

  :global(.text-editor.can-scroll-up) {
    mask-image: linear-gradient(
      to bottom,
      transparent 0%,
      black $mask-blur-size-top,
      black 100%
    );
  }

  :global(.text-editor.can-scroll-down) {
    mask-image: linear-gradient(
      to bottom,
      black 0%,
      black calc(100% - $mask-blur-size-bottom),
      transparent calc(100% - $mask-blur-size-bottom-padding),
      transparent 100%
    );
  }

  :global(.text-editor.can-scroll-up.can-scroll-down) {
    mask-image: linear-gradient(
      to bottom,
      transparent 0%,
      black $mask-blur-size-top,
      black calc(100% - $mask-blur-size-bottom),
      transparent calc(100% - $mask-blur-size-bottom-padding),
      transparent 100%
    );
  }

  :global(.text-editor.ctrl a:hover) {
    cursor: pointer;
    text-decoration: underline;
  }

  :global(.tiptap) {
    min-height: 100%;
    padding-bottom: var(--footer-height);
  }
</style>
