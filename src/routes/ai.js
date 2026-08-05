const express = require("express");
const router = express.Router();
const { requireLogin } = require("../middlewares/authMiddleware");
const aiController = require("../controllers/aiController");

router.post("/api/ai-explanation", requireLogin, aiController.getAiExplanation);

module.exports = router;