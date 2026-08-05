const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl: { rejectUnauthorized: false } // nếu dùng Railway/Render có SSL
});

async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

module.exports = { query, pool };
