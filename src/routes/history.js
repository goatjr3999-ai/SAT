// src/routes/history.js
const express = require("express");
const router = express.Router();
const { requireLogin } = require("../middlewares/authMiddleware");
const historyController = require("../controllers/historyController");

// Lưu lịch sử
router.post(
  "/api/test-history",
  requireLogin,
  historyController.saveTestHistory
);

// Lấy lịch sử
router.get(
  "/api/test-history",
  requireLogin,
  historyController.getTestHistory
);

// Chi tiết 1 lần làm
router.get(
  "/api/review-detail/:attemptId",
  requireLogin,
  historyController.getReviewDetail
);

// State bài test
router.get(
  "/api/test-state",
  requireLogin,
  historyController.getTestState
);
router.post(
  "/api/test-state",
  requireLogin,
  historyController.saveTestState
);

// Kiểm tra đã làm xong chưa
router.get(
  "/api/test-completed",
  requireLogin,
  historyController.checkTestCompleted
);

router.post(
  "/api/test-statuses",
  requireLogin,
  historyController.getTestStatuses
);

// Reset bài test
router.post(
  "/api/test-reset",
  requireLogin,
  historyController.resetTest
);

// Heatmap
router.get("/api/heatmap", requireLogin, historyController.getHeatmap);

// Câu sai
router.get(
  "/api/wrong-answers",
  requireLogin,
  historyController.getWrongAnswers
);

router.post(
  "/api/wrong-answers/error-log",
  requireLogin,
  historyController.saveWrongAnswerErrorLog
);

module.exports = router;
