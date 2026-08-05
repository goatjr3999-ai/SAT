const db = require("./db");

async function resolveEffectiveProStatus(userId) {
  if (!userId) {
    return { isPro: false, proExpiresAt: null };
  }

  const result = await db.query(
    `
      UPDATE users
      SET is_pro = 0
      WHERE id = $1
        AND is_pro = 1
        AND pro_expires_at IS NOT NULL
        AND pro_expires_at <= NOW()
      RETURNING id
    `,
    [userId]
  );

  if (result.rowCount > 0) {
    return { isPro: false, proExpiresAt: null };
  }

  const userResult = await db.query(
    `SELECT is_pro, pro_expires_at FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const user = userResult.rows[0];

  return {
    isPro: user?.is_pro === 1,
    proExpiresAt: user?.pro_expires_at || null,
  };
}

async function ensureProFlag(req) {
  if (!req.session.userId) return false;

  try {
    const status = await resolveEffectiveProStatus(req.session.userId);
    req.session.isPro = status.isPro;
    return status.isPro;
  } catch (err) {
    console.error("ensureProFlag error:", err);
    return false;
  }
}

module.exports = { ensureProFlag, resolveEffectiveProStatus };