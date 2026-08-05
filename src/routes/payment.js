const express = require("express");
const { requireLogin } = require("../middlewares/authMiddleware");
const paymentController = require("../controllers/paymentController");

const router = express.Router();

router.post("/api/payments/pro-intent", requireLogin, paymentController.createProIntent);
router.get("/api/payments/upgrade-match", requireLogin, paymentController.getUpgradeMatchStatus);
router.post("/api/vietqr/webhook", paymentController.handleVietQrWebhook);
router.post("/api/payments/google-sheet-webhook", paymentController.handleGoogleSheetWebhook);

module.exports = router;