// src/routes/assignments.js
const express = require("express");
const router = express.Router();

const { requireLogin } = require("../middlewares/authMiddleware");
const { requireAdmin } = require("../middlewares/adminMiddleware");
const assignmentController = require("../controllers/classAssignmentController");

router.get(
  "/admin/classes/:id/assignments",
  requireAdmin,
  assignmentController.getClassAssignments
);

router.post(
  "/admin/classes/:id/assignments/toggle",
  requireAdmin,
  assignmentController.toggleClassAssignment
);

router.get(
  "/admin/classes/:classId/users/:userId/missing-assignments",
  requireAdmin,
  assignmentController.getUserMissingAssignments
);


router.get(
  "/api/class-assignments",
  requireLogin,
  assignmentController.getMyAssignments
);

module.exports = router;