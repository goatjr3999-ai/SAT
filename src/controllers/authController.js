// src/controllers/authController.js
const path = require("path");
const crypto = require("crypto");
const db = require("../utils/db");
const { getVNTime } = require("../utils/time");
const { resolveEffectiveProStatus } = require("../utils/userSession");

// Trang login (GET '/')
function showLoginPage(req, res) {
  if (req.session.userId) {
    return res.redirect("/index");
  }
  res.sendFile(path.join(__dirname, "..", "..", "public", "login.html"));
}

// /login chỉ redirect về '/'
function redirectLogin(req, res) {
  res.redirect("/");
}

// Trang index chính
function showIndex(req, res) {
  res.sendFile(path.join(__dirname, "..", "..", "public", "index.html"));
}

// Logout
function logout(req, res) {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
}

// Hàm dùng chung cho login (Google + login thường)
async function handleDeviceLogin(req, res, user) {
  let deviceToken = req.cookies.device_token;
  if (!deviceToken) deviceToken = crypto.randomBytes(16).toString("hex");

  const finishLogin = async () => {
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = user.is_admin === 1;
    const proStatus = await resolveEffectiveProStatus(user.id);
    req.session.isPro = proStatus.isPro;
    req.session.email = user.email;

    res.cookie("device_token", deviceToken, {
      httpOnly: true,
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });

    return req.session.save((saveErr) => {
      if (saveErr) {
        console.error("Session save error after login:", saveErr);
        return res.status(500).send("Lỗi server");
      }
      return res.redirect("/index");
    });
  };

  
  try {
    // Admin được phép đăng nhập không giới hạn thiết bị
    if (user.is_admin === 1) {
      await db.query(
        `INSERT INTO devices (user_id, device_token, approved, created_at_vn)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT (user_id, device_token)
         DO UPDATE SET approved = 1`,
        [user.id, deviceToken, getVNTime()]
      );
      return finishLogin();
    }
    // 1) Kiểm tra thiết bị đã tồn tại chưa
    const existingDeviceResult = await db.query(
      `SELECT * FROM devices WHERE user_id = $1 AND device_token = $2`,
      [user.id, deviceToken]
    );
    const device = existingDeviceResult.rows[0];

    if (device) {
      if (device.approved === 1) return finishLogin();
      return res.send("Thiết bị đã ghi nhận nhưng CHỜ ADMIN DUYỆT.");
    }

    // 2) Thiết bị mới → đếm số thiết bị đã approved
    const countResult = await db.query(
      `SELECT COUNT(*) AS count
       FROM devices
       WHERE user_id = $1 AND approved = 1`,
      [user.id]
    );
    const approvedCount = Number(countResult.rows[0].count);

    // CASE A — auto approve nếu <= 3 thiết bị
    if (approvedCount < 3) {
      await db.query(
        `INSERT INTO devices (user_id, device_token, approved, created_at_vn)
         VALUES ($1, $2, 1, $3)`,
        [user.id, deviceToken, getVNTime()]
      );
      return finishLogin();
    }

    // CASE B — >2 thiết bị → chờ admin duyệt
    await db.query(
      `INSERT INTO devices (user_id, device_token, approved, created_at_vn)
       VALUES ($1, $2, 0, $3)`,
      [user.id, deviceToken, getVNTime()]
    );
    return res.send(
      "Tài khoản này đã đăng nhập trên 3 thiết bị. Thiết bị mới đang CHỜ ADMIN DUYỆT."
    );
  } catch (err) {
    console.error("handleDeviceLogin error:", err);
    return res.status(500).send("Lỗi server");
  }
}

// Callback sau khi Google auth thành công
function handleGoogleCallback(req, res) {
  const user = req.user;
  return handleDeviceLogin(req, res, user);
}

// Login thường (POST /login)
async function handleLocalLogin(req, res) {
  const { username, password } = req.body;

  try {
    const result = await db.query(
      `SELECT * FROM users WHERE username = $1 AND password = $2`,
      [username, password]
    );
    const user = result.rows[0];

    if (!user) return res.send("Sai tài khoản hoặc mật khẩu");

    return handleDeviceLogin(req, res, user);
  } catch (err) {
    console.error("handleLocalLogin error:", err);
    return res.status(500).send("Lỗi server");
  }
}

async function getSessionInfo(req, res) {
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).json({ error: "Không tìm thấy phiên đăng nhập" });
  }

  try {
    const result = await db.query(
      `
      SELECT
        u.id,
        u.username,
        u.is_admin,
        u.is_pro,
        u.email,
        u.google_name,
        COALESCE(
          ARRAY_AGG(DISTINCT COALESCE(uc.class_id, u.class_id))
            FILTER (WHERE COALESCE(uc.class_id, u.class_id) IS NOT NULL),
          ARRAY[]::INTEGER[]
        ) AS class_ids,
        COALESCE(
          ARRAY_AGG(DISTINCT COALESCE(c.name, c_primary.name))
            FILTER (WHERE COALESCE(c.name, c_primary.name) IS NOT NULL),
          ARRAY[]::TEXT[]
        ) AS class_names
      FROM users u
      LEFT JOIN user_classes uc ON uc.user_id = u.id
      LEFT JOIN classes c ON c.id = uc.class_id
      LEFT JOIN classes c_primary ON c_primary.id = u.class_id
      WHERE u.id = $1
      GROUP BY u.id, u.username, u.is_admin, u.is_pro, u.email, u.google_name
    `,
      [userId]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    const proStatus = await resolveEffectiveProStatus(user.id);
    req.session.isPro = proStatus.isPro;

    const primaryClassId = user.class_ids?.[0] || null;
    const primaryClassName = user.class_names?.[0] || null;

    res.json({
      userId: user.id,
      username: user.username,
      googleName: user.google_name,
      isAdmin: user.is_admin === 1,
      isPro: proStatus.isPro,
      proExpiresAt: proStatus.proExpiresAt,
      email: user.email,
      classId: primaryClassId,
      className: primaryClassName,
      classIds: user.class_ids || [],
      classNames: user.class_names || [],
    });
  } catch (err) {
    console.error("getSessionInfo error:", err);
    return res.status(500).json({ error: "Lỗi server" });
  }
}

module.exports = {
  showLoginPage,
  redirectLogin,
  showIndex,
  logout,
  handleGoogleCallback,
  handleLocalLogin,
  getSessionInfo,
};
