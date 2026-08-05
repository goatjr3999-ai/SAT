(function () {
  const accountStatus = document.getElementById("account-status");
  if (!accountStatus) return;

  const modal = document.createElement("div");
  modal.className = "pro-info-modal-backdrop";
  modal.id = "pro-info-modal";
  modal.innerHTML = `
    <div class="pro-info-modal" role="dialog" aria-modal="true" aria-labelledby="pro-info-title">
      <button class="pro-info-close" id="pro-info-close" type="button" aria-label="Đóng">×</button>
      <h3 class="pro-info-title" id="pro-info-title">Tài khoản Pro</h3>
      <p class="pro-info-row">Ngày hết hạn: <strong id="pro-info-expiry">Đang tải…</strong></p>
      <button class="pro-info-upgrade-btn" id="pro-info-upgrade-btn" type="button">Nâng cấp thêm 1 tháng</button>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector("#pro-info-close");
  const expiryEl = modal.querySelector("#pro-info-expiry");
  const upgradeBtn = modal.querySelector("#pro-info-upgrade-btn");

  const formatExpiry = (value) => {
    if (!value) return "Chưa có thông tin";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Chưa có thông tin";
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  };

  const openModal = () => {
    modal.classList.add("open");
    document.body.classList.add("modal-open");
  };

  const closeModal = () => {
    modal.classList.remove("open");
    document.body.classList.remove("modal-open");
  };

  closeBtn?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("open")) {
      closeModal();
    }
  });

  upgradeBtn?.addEventListener("click", () => {
    window.location.href = "/payment.html?plan=month";
  });

  accountStatus.addEventListener("click", async () => {
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) return;
      const me = await response.json();
      if (!me?.isPro) return;

      if (expiryEl) {
        expiryEl.textContent = formatExpiry(me?.proExpiresAt);
      }
      openModal();
    } catch (error) {
      console.error("Không thể mở popup tài khoản Pro", error);
    }
  });
})();