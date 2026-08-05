const crypto = require("crypto");
const db = require("../utils/db");

const PRO_AMOUNT = Number(process.env.PRO_AMOUNT || 79000);
const QUARTER_AMOUNT = Number(process.env.PRO_QUARTER_AMOUNT || 150000);

const PLAN_AMOUNTS = {
  month: PRO_AMOUNT,
  quarter: QUARTER_AMOUNT,
};

const PAYMENT_ACCOUNT = {
  number: process.env.VIETQR_ACCOUNT_NUMBER || "6274654824292",
  bank: process.env.VIETQR_BANK || "MBBank",
  qrTemplate:
    process.env.VIETQR_QR_TEMPLATE ||
    "https://img.vietqr.io/image/MBBank-6274654824292-compact.png?amount={amount}&addInfo={info}",
};

const WEBHOOK_TOKEN = process.env.VIETQR_WEBHOOK_TOKEN || "";
const SHEET_WEBHOOK_TOKEN = process.env.SHEET_WEBHOOK_TOKEN || "";
let lastUpgradedGmail = "";

function parseCurrencyAmount(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = String(value).trim();
  if (!raw) return 0;

  const digitsOnly = raw.replace(/[^\d]/g, "");
  if (digitsOnly) {
    return Number(digitsOnly);
  }

  const normalized = raw.replace(/,/g, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function generateCode(length = 15) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function buildQrLink(transferInfo, amount) {
  const encodedInfo = encodeURIComponent(transferInfo || "");
  const amountValue = typeof amount === "number" ? amount : 0;
  return PAYMENT_ACCOUNT.qrTemplate
    .replace("{amount}", amountValue)
    .replace("{info}", encodedInfo);
}

function normalizeText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, "");
}

function stripGmailSuffix(email) {
  return String(email || "").trim().replace(/@gmail\.com$/i, "");
}

function toTransferEmail(email) {
  return String(email || "").trim().replace(/@gmail\.com$/i, "gmailcom");
}

function toSigmasatTransferInfo(email) {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  if (!normalizedEmail) {
    return "";
  }

  return `glorysat ${normalizedEmail} pro`;
}

function resolvePlanAmount(plan) {
  return PLAN_AMOUNTS[plan] || PRO_AMOUNT;
}

async function getOrCreatePendingIntent(userId, amount) {
  const existing = await db.query(
    `
      SELECT id, code, amount
      FROM payment_intents
      WHERE user_id = $1 AND status = 'pending' AND amount = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId, amount]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  let code = generateCode();
  let created = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await db.query(
        `
          INSERT INTO payment_intents (user_id, code, amount, status)
          VALUES ($1, $2, $3, 'pending')
          RETURNING id, code, amount
        `,
        [userId, code, amount]
      );
      created = result.rows[0];
      break;
    } catch (err) {
      if (err.code === "23505") {
        code = generateCode();
      } else {
        throw err;
      }
    }
  }

  if (!created) {
    throw new Error("Không thể tạo mã thanh toán.");
  }

  return created;
}

async function createProIntent(req, res) {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: "Bạn cần đăng nhập." });
  }

  try {
    const plan = req.body?.plan;
    const amount = resolvePlanAmount(plan);
    const intent = await getOrCreatePendingIntent(userId, amount);

    const userResult = await db.query(
      "SELECT email FROM users WHERE id = $1 LIMIT 1",
      [userId]
    );
    const userEmail = String(
      userResult.rows[0]?.email || req.session.email || ""
    ).trim();
    const sigmasatTransferInfo = toSigmasatTransferInfo(userEmail);
    const transferEmail = toTransferEmail(userEmail);
    const transferInfo = sigmasatTransferInfo || transferEmail || intent.code;
    
    res.json({
      code: intent.code,
      amount: intent.amount,
      account: {
        number: PAYMENT_ACCOUNT.number,
        bank: PAYMENT_ACCOUNT.bank,
      },
      transferInfo,
      qrUrl: buildQrLink(transferInfo, intent.amount),
    });
  } catch (err) {
    console.error("createProIntent error:", err);
    res.status(500).json({ error: "Không thể tạo thông tin thanh toán." });
  }
}

function extractTransactions(payload) {
  const data = payload?.data ?? payload;

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.transactions)) return data.transactions;
  if (Array.isArray(data?.data)) return data.data;

  return [data];
}

function extractTransferInfo(entry) {
  return {
    amount:
      parseCurrencyAmount(entry?.amount) ||
      parseCurrencyAmount(entry?.totalAmount) ||
      parseCurrencyAmount(entry?.money) ||
      parseCurrencyAmount(entry?.transactionAmount) ||
      parseCurrencyAmount(entry?.value) ||
      0,
    description:
      entry?.addInfo ||
      entry?.description ||
      entry?.content ||
      entry?.remark ||
      entry?.message ||
      entry?.purpose ||
      "",
    transactionId:
      entry?.transactionId ||
      entry?.transId ||
      entry?.id ||
      entry?.reference ||
      entry?.trxId ||
      null,
  };
}

async function handleTransfer({ amount, description, transactionId }) {
  if (!amount || !Object.values(PLAN_AMOUNTS).includes(amount)) {
    return { matched: false };
  }

  const normalizedDescription = normalizeText(description);
  if (!normalizedDescription) {
    return { matched: false };
  }

  const pending = await db.query(
    `
      SELECT pi.id, pi.user_id, pi.code, u.email
      FROM payment_intents pi
      JOIN users u ON u.id = pi.user_id
      WHERE pi.status = 'pending' AND pi.amount = $1
      ORDER BY pi.created_at ASC
    `,
    [amount]
  );
  const matched = pending.rows.find((intent) => {
    const normalizedCode = normalizeText(intent.code);
    const normalizedEmail = normalizeText(intent.email);
    const normalizedEmailWithoutGmailSuffix = normalizeText(
      stripGmailSuffix(intent.email)
    );
    const normalizedTransferEmail = normalizeText(toTransferEmail(intent.email));
    const normalizedSigmasatTransferInfo = normalizeText(
      toSigmasatTransferInfo(intent.email)
    );
    return (
      (normalizedCode && normalizedDescription.includes(normalizedCode)) ||
      (normalizedEmail && normalizedDescription.includes(normalizedEmail)) ||
      (normalizedSigmasatTransferInfo &&
        normalizedDescription.includes(normalizedSigmasatTransferInfo)) ||
      (normalizedTransferEmail &&
        normalizedDescription.includes(normalizedTransferEmail)) ||
      (normalizedEmailWithoutGmailSuffix &&
        normalizedDescription.includes(normalizedEmailWithoutGmailSuffix))
    );
  });

  if (!matched) {
    return { matched: false };
  }

  await db.query(
    `
      UPDATE payment_intents
      SET status = 'paid', paid_at = NOW(), transaction_id = $1
      WHERE id = $2 AND status = 'pending'
    `,
    [transactionId, matched.id]
  );

  await db.query(`UPDATE users SET is_pro = 1 WHERE id = $1`, [
    matched.user_id,
  ]);

  return { matched: true, userId: matched.user_id, code: matched.code };
}

function buildEmailFromDescription(rawDescription) {
  const value = String(rawDescription || "").trim().toLowerCase();
  if (!value) return "";

  const gmailWithoutDotMatch = value.match(/[a-z0-9._%+-]+gmailcom/i);
  console.log("gmailWithoutDotMatch:", gmailWithoutDotMatch);
  if (gmailWithoutDotMatch?.[0]) {
    return gmailWithoutDotMatch[0].replace(/gmailcom$/i, "@gmail.com").toLowerCase();
  }

  const directEmailMatch = value.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (directEmailMatch?.[0]) {
    return directEmailMatch[0].toLowerCase();
  }

  const beforeTransferCodeMatch = value.match(/([a-z][a-z0-9._-]{2,})\s*-\s*ma\s*gd\b/i);
  if (beforeTransferCodeMatch?.[1]) {
    return `${beforeTransferCodeMatch[1]}@gmail.com`;
  }

  const ignoreTokens = new Set([
    "ma",
    "gd",
    "acsp",
    "ck",
    "chuyenkhoan",
    "chuyenkhoan",
    "noidung",
    "naptien",
    "thanhtoan",
  ]);

  const candidates = value
    .split(/[\s,;:/\|]+/)
    .map((token) =>
      token
        .replace(/^[^a-z0-9@._-]+|[^a-z0-9@._-]+$/g, "")
        .replace(/-+$/g, "")
        .trim()
    )
    .filter(Boolean)
    .filter((token) => /^[a-z0-9._-]{4,64}$/.test(token))
    .filter((token) => /[a-z]/.test(token))
    .filter((token) => !ignoreTokens.has(token))
    .filter((token) => !/^v\d{4,}$/.test(token));

  if (candidates.length === 0) return "";

  const selected = candidates.sort((a, b) => b.length - a.length)[0];
  console.log("Selected email candidate:", selected);
  return `${selected}@gmail.com`;
}

function parseTransactionTime(rawDate) {
  const value = String(rawDate || "").trim();
  if (!value) return null;

  const normalized = value.replace("T", " ");
  const directDate = new Date(normalized);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate;
  }

  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) return null;

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
}

async function handleSheetTransaction(entry) {
  const transactionCode = String(
    entry?.transactionCode ||
      entry?.maGd ||
      entry?.["Mã GD"] ||
      entry?.referenceCode ||
      entry?.maThamChieu ||
      entry?.["Mã tham chiếu"] ||
      entry?.id ||
      ""
  ).trim();

  const rawDescription =
    entry?.description || entry?.moTa || entry?.["Mô tả"] || entry?.content || "";
  const email = buildEmailFromDescription(rawDescription);
  if (!email) {
    return { upgraded: false, reason: "missing_email" };
  }

  const rawDate =
    entry?.transactionAt || entry?.ngayDienRa || entry?.["Ngày diễn ra"] || entry?.date;
  const transactionDate = parseTransactionTime(rawDate) || new Date();

  const amount =
    parseCurrencyAmount(entry?.amount) ||
    parseCurrencyAmount(entry?.giaTri) ||
    parseCurrencyAmount(entry?.["Giá trị"]) ||
    null;

  const userResult = await db.query(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  const userId = userResult.rows[0]?.id || null;

  if (!userId) {
    return { upgraded: false, reason: "user_not_found", email };
  }

  await db.query(
    `
      UPDATE users
      SET is_pro = 1,
          pro_expires_at = 
              GREATEST(
                  COALESCE(pro_expires_at, TO_TIMESTAMP(0)),
                  $2::timestamp
              ) + INTERVAL '1 month'
      WHERE id = $1;
    `,
    [userId, transactionDate]
  );

  if (transactionCode) {
    await db.query(
      `
        INSERT INTO sheet_payment_events (
          transaction_code,
          user_id,
          email,
          amount,
          transaction_at
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (transaction_code) DO NOTHING
      `,
      [transactionCode, userId, email, amount, transactionDate]
    );
  }

  return { upgraded: true, email, userId };
}

async function handleVietQrWebhook(req, res) {
  if (WEBHOOK_TOKEN) {
    const headerToken =
      req.headers["x-vietqr-token"] ||
      req.headers["x-webhook-token"] ||
      req.headers["authorization"];

    if (headerToken !== WEBHOOK_TOKEN) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const entries = extractTransactions(req.body || {});
  let matchedCount = 0;

  try {
    for (const entry of entries) {
      if (!entry) continue;
      const info = extractTransferInfo(entry);
      const result = await handleTransfer(info);
      if (result.matched) matchedCount += 1;
    }

    return res.json({ received: true, matched: matchedCount });
  } catch (err) {
    console.error("handleVietQrWebhook error:", err);
    return res.status(500).json({ error: "Lỗi xử lý webhook." });
  }
}

module.exports = {
  createProIntent,
  handleVietQrWebhook,
  async getUpgradeMatchStatus(req, res) {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: "Bạn cần đăng nhập." });
    }

    try {
      const userResult = await db.query(
        "SELECT email FROM users WHERE id = $1 LIMIT 1",
        [userId]
      );
      const currentUserGmail = String(userResult.rows[0]?.email || "")
        .trim()
        .toLowerCase();
      const matched =
        !!currentUserGmail &&
        !!lastUpgradedGmail &&
        currentUserGmail === lastUpgradedGmail;
      
      if (matched) {
        lastUpgradedGmail = null;
      }

      return res.json({
        matched,
        gmail: lastUpgradedGmail || null,
      });
    } catch (err) {
      console.error("getUpgradeMatchStatus error:", err);
      return res.status(500).json({ error: "Không thể kiểm tra trạng thái nâng cấp." });
    }
  },
  async handleGoogleSheetWebhook(req, res) {
    if (SHEET_WEBHOOK_TOKEN) {
      const headerToken =
        req.headers["x-sheet-token"] ||
        req.headers["x-webhook-token"] ||
        req.headers["authorization"];
      if (headerToken !== SHEET_WEBHOOK_TOKEN) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const payload = req.body || {};
    const entries = Array.isArray(payload) ? payload : payload.transactions || [payload];

    let upgradedCount = 0;
    let gmail = null;

    try {
      for (const entry of entries) {
        if (!entry) continue;
        const result = await handleSheetTransaction(entry);
        if (result.upgraded) upgradedCount += 1, gmail = result.email;
      }

      if (gmail) {
        lastUpgradedGmail = String(gmail).trim().toLowerCase();
      }

      return res.json({
        received: true,
        total: entries.length,
        upgraded: upgradedCount,
        gmail,
      });
    } catch (err) {
      console.error("handleGoogleSheetWebhook error:", err);
      return res.status(500).json({ error: "Lỗi xử lý Google Sheet webhook." });
    }
  },
};