export function setCSSVariable(name: string, value: string | number, root: HTMLElement = document.documentElement) {
  root.style.setProperty(name, value.toString());
}
