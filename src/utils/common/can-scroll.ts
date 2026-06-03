export function canScroll(el: HTMLElement) {
  const { scrollTop, scrollLeft, scrollHeight, clientHeight, scrollWidth, clientWidth } = el;
  return {
    canScrollUp: scrollTop > 0,
    canScrollDown: scrollTop < scrollHeight - clientHeight,
    canScrollLeft: scrollLeft > 0,
    canScrollRight: scrollLeft < scrollWidth - clientWidth,
  };
}
