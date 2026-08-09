// Lightweight global click-diagnostics utility (temporary).
// Activate by setting `window.__debugClicks = true` in the browser console.
// Logs whether a click handler actually fired and the current
// document.body.style.pointerEvents value at click time.

declare global {
  interface Window {
    __debugClicks?: boolean;
  }
}

let installed = false;

export function initClickDiagnostics() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // Capture-phase listener on document — fires before React's synthetic events.
  document.addEventListener(
    "click",
    (e) => {
      if (!window.__debugClicks) return;

      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName ?? "?";
      const role = target?.getAttribute("role") ?? "";
      const text = (target?.textContent ?? "").trim().slice(0, 60);
      const bodyPointerEvents = document.body.style.pointerEvents || "(empty)";

      // Defer the "handler ran" check to the next microtask so React's
      // synthetic event has a chance to dispatch first.
      const handlerFired = { value: false };
      const markFired = () => {
        handlerFired.value = true;
      };

      // Listen on the same target in bubble phase (after React processes it)
      // to detect whether a React onClick actually executed.
      target?.addEventListener("click", markFired, { once: true, passive: true });

      queueMicrotask(() => {
        target?.removeEventListener("click", markFired);

        console.log(`%c[click-diagnostics]`, "color: #6366f1; font-weight: bold", {
          tag: tagName,
          role,
          text,
          bodyPointerEvents,
          handlerFired: handlerFired.value,
          defaultPrevented: e.defaultPrevented,
          path: window.location.pathname,
        });
      });
    },
    true, // capture phase
  );
}
