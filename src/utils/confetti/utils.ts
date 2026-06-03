export function getOriginByElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const { clientWidth, clientHeight } = document.body;
  return {
    x: (rect.left + rect.width / 2) / clientWidth,
    y: (rect.top + rect.height / 2) / clientHeight,
  };
}

export function getOriginByCaret(caretHeight: number) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  if (selection.rangeCount === 0) {
    return;
  }
  const rect = selection.getRangeAt(0)?.getClientRects()?.[0];
  if (!rect) {
    return;
  }
  const { top, left } = rect;
  const { clientWidth, clientHeight } = document.body;
  return {
    x: left / clientWidth,
    y: (top + caretHeight / 2) / clientHeight,
  };
}

export function randomInRange(min: number, max: number) {
  return Math.random() * (max - min) + min;
}
