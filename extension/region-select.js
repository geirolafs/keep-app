// Injected on demand by "Screenshot: select region". Draws a crosshair overlay,
// lets the user drag a rectangle, tears itself down, then reports the rect
// (in CSS px, with viewport width for scale correction) to the service worker.
(() => {
  if (window.__keepRegion) return;
  window.__keepRegion = true;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.08)";
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;border:1px solid #fff;outline:1px solid #000;background:rgba(255,255,255,0.15);display:none;pointer-events:none";
  overlay.appendChild(box);
  document.documentElement.appendChild(overlay);

  let sx = 0;
  let sy = 0;
  let dragging = false;

  const cleanup = () => {
    overlay.remove();
    window.removeEventListener("keydown", onKey, true);
    delete window.__keepRegion;
  };

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
    }
  };
  window.addEventListener("keydown", onKey, true);

  overlay.addEventListener("mousedown", (e) => {
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
    box.style.display = "block";
    e.preventDefault();
  });

  overlay.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const x = Math.min(sx, e.clientX);
    const y = Math.min(sy, e.clientY);
    Object.assign(box.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${Math.abs(e.clientX - sx)}px`,
      height: `${Math.abs(e.clientY - sy)}px`,
    });
  });

  overlay.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    const rect = {
      x: Math.min(sx, e.clientX),
      y: Math.min(sy, e.clientY),
      w: Math.abs(e.clientX - sx),
      h: Math.abs(e.clientY - sy),
    };
    cleanup();
    if (rect.w > 4 && rect.h > 4) {
      chrome.runtime.sendMessage({ type: "keep-region", rect, vw: window.innerWidth });
    }
  });
})();
