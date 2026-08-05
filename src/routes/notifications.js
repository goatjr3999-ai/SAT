// src/routes/notifications.js
const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const { requireAdmin } = require("../middlewares/adminMiddleware");

router.get("/notifications/latest", notificationController.getLatestNotification);
router.get("/admin/notifications", requireAdmin, notificationController.getAllNotifications);
router.post("/admin/notifications", requireAdmin, notificationController.createNotification);
router.put("/admin/notifications/:id", requireAdmin, notificationController.updateNotification);
router.delete("/admin/notifications/:id", requireAdmin, notificationController.deleteNotification);

module.exports = router;