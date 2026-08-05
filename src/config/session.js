// src/config/session.js
const session = require("express-session");
const PgSessionStore = require("./pgSessionStore");

const sessionStore = new PgSessionStore();

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "very-secret-key",
  resave: false,
  saveUninitialized: false,
});

module.exports = sessionMiddleware;