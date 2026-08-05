// src/routes/index.js
const express = require("express");
const router = express.Router();

const authRoutes = require("./auth");
const testRoutes = require("./test");
const historyRoutes = require("./history");
const adminRoutes = require("./admin");
const planRoutes = require("./plan");
const assignmentRoutes = require("./assignments");
const aiRoutes = require("./ai");
const notificationRoutes = require("./notifications");
const paymentRoutes = require("./payment");
const theoryRoutes = require("./theory");

router.use(authRoutes);
router.use(testRoutes);
router.use(historyRoutes);
router.use(adminRoutes);
router.use(planRoutes);
router.use(assignmentRoutes);
router.use(aiRoutes);
router.use(paymentRoutes);
router.use(notificationRoutes);
router.use(theoryRoutes);

module.exports = router;
