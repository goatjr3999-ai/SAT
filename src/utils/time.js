// src/utils/time.js
function getVNTime() {
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" })
    .replace("T", " ");
}

module.exports = {
  getVNTime,
};
