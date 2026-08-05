// src/controllers/notificationController.js
const db = require("../utils/db");

async function getLatestNotification(req, res) {
  try {
    const result = await db.query(
      `
      SELECT id, message, created_at, updated_at
      FROM notifications
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    `,
      []
    );

    if (result.rows.length === 0) {
      return res.json({ message: null });
    }

    return res.json({ message: result.rows[0].message });
  } catch (error) {
    console.error("getLatestNotification error:", error);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

async function getAllNotifications(req, res) {
  try {
    const result = await db.query(
      `
      SELECT id, message, created_at, updated_at
      FROM notifications
      ORDER BY updated_at DESC, created_at DESC
    `,
      []
    );
    return res.json({ notifications: result.rows });
  } catch (error) {
    console.error("getAllNotifications error:", error);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

async function createNotification(req, res) {
  const message = (req.body.message || "").trim();

  if (!message) {
    return res.status(400).json({ error: "Nội dung thông báo không được để trống" });
  }

  try {
    const result = await db.query(
      `
      INSERT INTO notifications (message)
      VALUES ($1)
      RETURNING id, message, created_at, updated_at
    `,
      [message]
    );

    return res.status(201).json({ notification: result.rows[0] });
  } catch (error) {
    console.error("createNotification error:", error);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

async function updateNotification(req, res) {
  const notificationId = Number(req.params.id);
  const message = (req.body.message || "").trim();

  if (!notificationId || Number.isNaN(notificationId)) {
    return res.status(400).json({ error: "Thông báo không hợp lệ" });
  }

  if (!message) {
    return res.status(400).json({ error: "Nội dung thông báo không được để trống" });
  }

  try {
    const result = await db.query(
      `
      UPDATE notifications
      SET message = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, message, created_at, updated_at
    `,
      [message, notificationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy thông báo" });
    }

    return res.json({ notification: result.rows[0] });
  } catch (error) {
    console.error("updateNotification error:", error);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

async function deleteNotification(req, res) {
  const notificationId = Number(req.params.id);

  if (!notificationId || Number.isNaN(notificationId)) {
    return res.status(400).json({ error: "Thông báo không hợp lệ" });
  }

  try {
    const result = await db.query(
      `
      DELETE FROM notifications
      WHERE id = $1
      RETURNING id
    `,
      [notificationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy thông báo" });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("deleteNotification error:", error);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

module.exports = {
  getLatestNotification,
  getAllNotifications,
  createNotification,
  updateNotification,
  deleteNotification,
};