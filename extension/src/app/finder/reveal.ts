/**
 * Scrolls a scrolling list so that one of its rows is in view — the list only, never the page around it (what
 * `scrollIntoView` would also scroll). The finder's rows and the sidebar's nested places take it.
 */
export const revealIn = (box: HTMLElement, row: HTMLElement): void => {
  if (box.scrollHeight <= box.clientHeight) return;
  const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top;
  if (top < 0) box.scrollTop += top;
  else if (top + row.offsetHeight > box.clientHeight) box.scrollTop += top + row.offsetHeight - box.clientHeight;
};
