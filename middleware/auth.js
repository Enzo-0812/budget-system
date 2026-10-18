const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const SECRET = process.env.JWT_SECRET || 'budget-secret-2026';
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const getCurrentUser = async (username) => {
  const res = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  return res.rows[0];
};

const setDataScope = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ msg: '未登录' });
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);
    const user = await getCurrentUser(decoded.username);
    if (!user) return res.status(401).json({ msg: '用户不存在' });
    req.user = user;
    req.deptFilter = user.role === 'admin' ? {} : { dept_id: user.dept_id };
    next();
  } catch {
    return res.status(401).json({ msg: '登录已过期' });
  }
};

module.exports = { setDataScope };
