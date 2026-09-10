const SNAPS = ["collapsed", "half", "expanded"];
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

function cssPx(name) {
  const n = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(n) ? n : 10;
}

export function sheetGaps() {
  const side = cssPx("--sheet-gap");
  const top = Math.max(side, cssPx("--satt"));
  const bottom = Math.max(side, cssPx("--satb"));
  return { side, top, bottom };
}

export function createSheet(root, { onChange } = {}) {
  let snap = "half";
  let height = 0;
  let dragging = false;
  let startY = 0;
  let startH = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let didDrag = false;
  let kb = 0;

  const handle = root.querySelector("#sheet-handle");
  const messages = root.querySelector("#sheet-messages");

  function viewportH() {
    return window.innerHeight;
  }

  function placeBottom() {
    const { bottom } = sheetGaps();
    root.style.bottom = `${kb > 0 ? kb + 10 : bottom}px`;
  }

  function snapHeight(name) {
    const vh = viewportH();
    const { top, bottom } = sheetGaps();
    const outerBottom = kb > 0 ? kb + 10 : bottom;
    if (name === "collapsed") return 86;
    if (name === "half") return Math.round((vh - outerBottom) * 0.48);
    return Math.max(200, Math.round(vh - top - outerBottom));
  }

  function emit() {
    try {
      onChange?.({ snap, height, keyboard: kb, gaps: sheetGaps() });
    } catch (err) {
      console.error(err);
    }
  }

  function apply(h, animate) {
    const vh = viewportH();
    const { top, bottom } = sheetGaps();
    const outerBottom = kb > 0 ? kb + 10 : bottom;
    const maxH = vh - top - outerBottom;
    height = Math.max(72, Math.min(maxH, h));
    root.style.transition = animate ? `height 320ms ${EASE}` : "none";
    root.style.height = `${height}px`;
    root.dataset.snap = snap;
    placeBottom();
    emit();
  }

  function nearest(h, flick) {
    const pts = SNAPS.map((name) => ({ name, h: snapHeight(name) }));
    if (Math.abs(flick) > 0.85) {
      const i = SNAPS.indexOf(snap);
      if (flick > 0 && i > 0) return pts[i - 1].name;
      if (flick < 0 && i < pts.length - 1) return pts[i + 1].name;
    }
    pts.sort((a, b) => Math.abs(a.h - h) - Math.abs(b.h - h));
    return pts[0].name;
  }

  function setSnap(name, animate = true) {
    snap = name;
    apply(snapHeight(name), animate);
  }

  function onDown(e, fromList) {
    if (fromList && messages.scrollTop > 2) return;
    if (e.target.closest("#composer, #plus-menu, #key-panel, a, textarea, input")) return;
    dragging = true;
    didDrag = false;
    startY = e.clientY;
    startH = height;
    lastY = e.clientY;
    lastT = performance.now();
    velocity = 0;
    handle.style.cursor = "grabbing";
    try {
      e.target.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic events in tests may not allow capture */
    }
  }

  function onMove(e) {
    if (!dragging) return;
    const now = performance.now();
    const dy = e.clientY - startY;
    const dt = Math.max(8, now - lastT);
    velocity = (e.clientY - lastY) / dt;
    if (Math.abs(e.clientY - startY) > 8) didDrag = true;
    lastY = e.clientY;
    lastT = now;
    apply(startH - dy, false);
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = "grab";
    setSnap(nearest(height, velocity));
  }

  root.addEventListener("pointerdown", (e) => {
    const fromHandle = e.target.closest("#sheet-handle, .sheet-head");
    const fromList = e.target.closest("#sheet-messages");
    if (fromHandle) onDown(e, false);
    else if (fromList) onDown(e, true);
  });
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  handle.addEventListener("click", () => {
    if (didDrag) return;
    setSnap(snap === "expanded" ? "half" : "expanded");
  });

  window.addEventListener("resize", () => setSnap(snap, false));

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      const vv = window.visualViewport;
      kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      placeBottom();
      setSnap(snap, false);
    });
  }

  setSnap("half", false);

  return {
    setSnap,
    getSnap: () => snap,
    getHeight: () => height,
    expandIfCollapsed() {
      if (snap === "collapsed") setSnap("half");
    },
  };
}
