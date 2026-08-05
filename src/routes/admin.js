// src/routes/admin.js
const express = require("express");
const router = express.Router();
const { requireAdmin } = require("../middlewares/adminMiddleware");
const adminController = require("../controllers/adminController");

// Trang admin
router.get("/admin", requireAdmin, adminController.getAdminPage);

// Danh sách devices
router.get(
  "/admin/devices",
  requireAdmin,
  adminController.getAdminDevices
);

// Tạo user
router.post(
  "/admin/create-user",
  requireAdmin,
  adminController.createUser
);

router.post("/admin/classes", requireAdmin, adminController.createClass);
router.post("/admin/classes/:id/delete", requireAdmin, adminController.deleteClass);
router.post("/admin/classes/:id/rename", requireAdmin, adminController.renameClass);
router.post(
  "/admin/users/:id/class",
  requireAdmin,
  adminController.assignUserClass
);


// Approve device
router.post(
  "/admin/approve/:id",
  requireAdmin,
  adminController.approveDevice
);

// Revoke device
router.post(
  "/admin/revoke/:id",
  requireAdmin,
  adminController.revokeDevice
);

router.post(
  "/admin/users/:id/pro",
  requireAdmin,
  adminController.updateUserProStatus
);

router.get(
  "/admin/export-wrong-answers",
  requireAdmin,
  adminController.exportWrongAnswers
);

router.get(
  "/admin/pro-tests",
  requireAdmin,
  adminController.getProTestList
);

router.post(
  "/admin/pro-tests",
  requireAdmin,
  adminController.updateProTestStatus
);

router.get(
  "/admin/test-deadlines",
  requireAdmin,
  adminController.getTestDeadlines
);

router.post(
  "/admin/test-deadlines",
  requireAdmin,
  adminController.updateTestDeadline
);

module.exports = router;
