// Svelte 5 dropped the `on:event|modifier` directive syntax in favour of plain
// event attributes (`onsubmit={...}`), so the old modifiers become tiny wrappers.

export function preventDefault(handler) {
  return (event) => {
    event.preventDefault();
    handler(event);
  };
}

// Only fire when the event happened on the element itself, not bubbled up from
// a child - e.g. clicking a modal's backdrop, but not the dialog inside it.
export function self(handler) {
  return (event) => {
    if (event.target === event.currentTarget) handler(event);
  };
}
