export function listenForCtrlPress(cb: (pressed: boolean) => void) {
  let pressed = false;
  const keyDownListener = (ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey) {
      pressed = true;
      cb(true);
    }
  };

  const keyUpListener = (ev: KeyboardEvent) => {
    if (!pressed) {
      return;
    }
    pressed = false;
    cb(false);
  };

  document.addEventListener("keydown", keyDownListener);
  document.addEventListener("keyup", keyUpListener);

  return () => {
    document.removeEventListener("keydown", keyDownListener);
    document.removeEventListener("keyup", keyUpListener);
  };
}

export function listenForContextMenu(cb: (ev: MouseEvent) => void) {
  document.addEventListener("contextmenu", cb);
  return () => {
    document.removeEventListener("contextmenu", cb);
  };
}
