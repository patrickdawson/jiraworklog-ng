// Keyboard shortcuts of the app menu (src-tauri/src/menu.rs). WebView2 keeps
// the keys while the page has focus, so the menu's native accelerators never
// fire. This listener catches them and runs the same menu entry.
import { commands } from "@/bindings";

/** The app menu entry a key press stands for, or null. */
export function menuShortcut(e: KeyboardEvent): string | null {
  if (e.altKey || e.metaKey) return null;
  if (!e.ctrlKey) {
    if (e.shiftKey) return null;
    if (e.key === "F1") return "help";
    if (e.key === "F11") return "fullscreen";
    return null;
  }
  switch (e.key.toLowerCase()) {
    case "w":
      return e.shiftKey ? null : "close-window";
    case "q":
      return e.shiftKey ? null : "quit";
    // "+" on the German keyboard and the numpad; "=" is the same key on a US keyboard.
    case "+":
    case "=":
      return "zoom-in";
    case "-":
      return "zoom-out";
    case "0":
      return "zoom-reset";
    default:
      return null;
  }
}

/** Starts listening; returns the function that stops it. */
export function listenForMenuShortcuts(): () => void {
  function onKeyDown(e: KeyboardEvent) {
    const id = menuShortcut(e);
    if (!id) return;
    e.preventDefault();
    // Holding a zoom key keeps zooming; the others run once per press.
    if (e.repeat && !id.startsWith("zoom")) return;
    void commands.runMenuShortcut(id);
  }
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
