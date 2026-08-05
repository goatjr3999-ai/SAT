document.addEventListener("DOMContentLoaded", async () => {
  const textEl = document.getElementById("notification-text");

  if (!textEl) return;

  try {
    const res = await fetch("/notifications/latest");
    if (!res.ok) {
      textEl.textContent = "Không có thông báo mới";
      return;
    }

    const data = await res.json();
    const message = (data.message || "").trim();

    textEl.textContent = message || "Không có thông báo mới";
  } catch (error) {
    console.error("Không thể tải thông báo:", error);
    textEl.textContent = "Không có thông báo mới";
  }
});