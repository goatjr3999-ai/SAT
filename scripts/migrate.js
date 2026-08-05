require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("../src/utils/db");

(async () => {
  try {
    const schemaPath = path.join(__dirname, "..", "schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf8");

    console.log("🚀 Running migrations from schema.sql...");
    await pool.query(sql);
    console.log("✅ Migrations done!");
  } catch (err) {
    console.error("❌ Migration error (ignored):", err.message);
    // ❌ KHÔNG process.exit
  } finally {
    await pool.end().catch(() => {});
  }
})();
