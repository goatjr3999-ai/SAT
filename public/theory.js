const typeRowEl = document.getElementById("theory-type-row");
const typeButtons = document.querySelectorAll(".theory-type-btn");
const theoryContents = document.querySelectorAll(".theory-content");

function activateTheory(targetId) {
  typeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.target === targetId);
  });

  theoryContents.forEach((content) => {
    content.classList.toggle("active", content.id === targetId);
  });
}

if (typeRowEl) {
  typeRowEl.addEventListener("click", (event) => {
    const button = event.target.closest(".theory-type-btn");
    if (!button) return;
    activateTheory(button.dataset.target);
  });
}