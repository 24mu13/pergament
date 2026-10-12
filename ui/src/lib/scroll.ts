/** The element a view scrolls in. */
export function scroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#content .overflow-y-auto");
}

/** Scroll to `top` once the content is tall enough, which can take a few frames while a view loads. */
export function restoreScroll(el: HTMLElement, top: number, frames = 60) {
  el.scrollTop = top;
  if (frames > 0 && Math.abs(el.scrollTop - top) > 1) requestAnimationFrame(() => restoreScroll(el, top, frames - 1));
}
