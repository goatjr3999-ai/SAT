const express = require("express");
const router = express.Router();
const { requireLogin } = require("../middlewares/authMiddleware");
const planController = require("../controllers/planController");

router.post(
  "/api/study-plan/exam-date",
  requireLogin,
  planController.setExamDate
);

router.get(
  "/api/study-plan/today",
  requireLogin,
  planController.getTodayPlan
);

module.exports = router;