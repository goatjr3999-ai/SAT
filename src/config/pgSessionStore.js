const session = require("express-session");
const { pool } = require("../utils/db");

const SESSION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR(255) PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expire
  ON user_sessions (expire);
`;

class PgSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.pool = options.pool || pool;
    this.initialized = false;
  }

  async ensureInitialized() {
    if (this.initialized) return;
    await this.pool.query(SESSION_TABLE_SQL);
    this.initialized = true;
  }

  get(sid, callback) {
    this.ensureInitialized()
      .then(() =>
        this.pool.query(
          `SELECT sess
           FROM user_sessions
           WHERE sid = $1 AND expire >= NOW()`,
          [sid]
        )
      )
      .then((result) => {
        if (!result.rows.length) return callback(null, null);
        callback(null, result.rows[0].sess);
      })
      .catch((error) => callback(error));
  }

  set(sid, sessionData, callback) {
    const maxAge = sessionData?.cookie?.maxAge || 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + maxAge);

    this.ensureInitialized()
      .then(() =>
        this.pool.query(
          `INSERT INTO user_sessions (sid, sess, expire)
           VALUES ($1, $2::json, $3)
           ON CONFLICT (sid)
           DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
          [sid, JSON.stringify(sessionData), expiresAt]
        )
      )
      .then(() => callback && callback(null))
      .catch((error) => callback && callback(error));
  }

  destroy(sid, callback) {
    this.ensureInitialized()
      .then(() => this.pool.query(`DELETE FROM user_sessions WHERE sid = $1`, [sid]))
      .then(() => callback && callback(null))
      .catch((error) => callback && callback(error));
  }

  touch(sid, sessionData, callback) {
    const maxAge = sessionData?.cookie?.maxAge || 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + maxAge);

    this.ensureInitialized()
      .then(() =>
        this.pool.query(`UPDATE user_sessions SET expire = $2 WHERE sid = $1`, [sid, expiresAt])
      )
      .then(() => callback && callback(null))
      .catch((error) => callback && callback(error));
  }

  cleanupExpiredSessions() {
    return this.ensureInitialized().then(() =>
      this.pool.query(`DELETE FROM user_sessions WHERE expire < NOW()`)
    );
  }
}

module.exports = PgSessionStore;