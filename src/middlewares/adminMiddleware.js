// src/middlewares/adminMiddleware.js
function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin) {
    return res.status(403).send("Forbidden - Bạn không phải admin");
  }
  next();
}

module.exports = {
  requireAdmin,
};
