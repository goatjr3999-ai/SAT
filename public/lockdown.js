(function () {
  // Block common copy/inspect shortcuts without disabling selection.
  function handleKeydown(e) {
    const key = (e.key || "").toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    const blockCombos =
      // Copy
      (ctrl && key === "c") ||
      // Devtools
      key === "f12" ||
      (ctrl && shift && (key === "i" || key === "j")) ||
      // View source
      (ctrl && key === "u");

    if (blockCombos) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function handleCopy(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.clipboardData) {
      e.clipboardData.setData("text/plain", "");
    }
  }

  function handleContextMenu(e) {
    e.preventDefault();
  }

  document.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("copy", handleCopy, true);
  document.addEventListener("contextmenu", handleContextMenu, true);

  // DevTools detection: show overlay while open
  const overlay = document.createElement("div");
  overlay.setAttribute("aria-live", "polite");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0,0,0,0.72)",
    color: "#fff",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    zIndex: 99999,
    padding: "24px",
    fontFamily: "'IBM Plex Sans', sans-serif",
    backdropFilter: "blur(2px)",
  });
  overlay.innerHTML = "<div style=\"max-width:620px;font-size:18px;font-weight:600;line-height:1.6;\">Vui lòng tắt DevTools/Inspect để tiếp tục sử dụng trang.</div>";

  function attachOverlay() {
    const target = document.body || document.documentElement;
    if (target && !overlay.parentNode) {
      target.appendChild(overlay);
    }
  }

  attachOverlay();
  document.addEventListener("DOMContentLoaded", attachOverlay, { once: true });

  let devtoolsOpen = false;
  let redirected = false;

  function checkDevtools() {
    let isOpen = false;
    const probe = new Image();
    Object.defineProperty(probe, "id", {
      get() {
        isOpen = true;
      },
    });
    console.log(probe);
    if (!isOpen) {
      const start = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      const elapsed = performance.now() - start;
      isOpen = elapsed > 100;
    }
    if (isOpen !== devtoolsOpen) {
      devtoolsOpen = isOpen;
      overlay.style.display = devtoolsOpen ? "flex" : "none";
    }
    if (devtoolsOpen && !redirected) {
      redirected = true;
      window.location.href = "https://www.threads.com/@glory.sat?hl=en";
    }
  }

  window.addEventListener("resize", checkDevtools, true);
  setInterval(checkDevtools, 500);
  // Immediate check on load to handle cases where DevTools was already open
  checkDevtools();
})();