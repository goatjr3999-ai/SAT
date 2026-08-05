// src/routes/auth.js
const express = require("express");
const router = express.Router();
const passport = require("../config/passport");
const { requireLogin } = require("../middlewares/authMiddleware");
const authController = require("../controllers/authController");

// Trang login
router.get("/", authController.showLoginPage);
router.get("/login", authController.redirectLogin);

// Login thường
router.post("/login", authController.handleLocalLogin);

// Google login
router.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  authController.handleGoogleCallback
);

// Trang index
router.get("/index", requireLogin, authController.showIndex);

router.get("/api/me", requireLogin, authController.getSessionInfo);

// Logout
router.get("/logout", authController.logout);

module.exports = router;
