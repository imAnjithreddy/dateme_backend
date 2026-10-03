const jwt = require('jsonwebtoken');

const signToken = (payload) => {
  const secret = process.env.JWT_SECRET || 'the_quad_jwt_secret_token_dev_auth_supersecure_key_2026';
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign(payload, secret, { expiresIn });
};

const verifyToken = (token) => {
  const secret = process.env.JWT_SECRET || 'the_quad_jwt_secret_token_dev_auth_supersecure_key_2026';
  return jwt.verify(token, secret);
};

module.exports = {
  signToken,
  verifyToken
};
