// src/routes/theory.js
const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const { requireLogin } = require("../middlewares/authMiddleware");

const router = express.Router();
const theoryDir = path.join(__dirname, "..", "..", "lithuyet");

router.get("/api/lithuyet", requireLogin, async (req, res) => {
  try {
    const files = await fs.readdir(theoryDir, { withFileTypes: true });
    const pdfFiles = files
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name.toLowerCase().endsWith(".pdf"))
      .sort((a, b) => a.localeCompare(b, "vi"));

    const data = pdfFiles.map((filename) => ({
      filename,
      url: `/lithuyet/${encodeURIComponent(filename)}`,
    }));

    res.json({ files: data });
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.json({ files: [] });
    }

    console.error("Failed to read theory files", error);
    res.status(500).json({ error: "Failed to load theory files" });
  }
});

module.exports = router;