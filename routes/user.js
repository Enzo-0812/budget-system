const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const router = express.Router();

const SECRET = process.env.JWT_SECRET || 'budget-secret-2026';
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const getCurrentUser = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, SECRET);
    const res = await db.query('SELECT * FROM users WHERE username = $1', [decoded.username]);
    return res.rows[0];
  } catch {
    return null;
  }
};

router.post('/password', async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ msg: '请先登录' });

  const { oldPwd, newPwd, confirmPwd } = req.body;

  const isCorrect = await bcrypt.compare(oldPwd, user.password);
  if (!isCorrect) return res.json({ success: false, msg: '原密码输入错误' });
  if (newPwd !== confirmPwd) return res.json({ success: false, msg: '两次新密码不一致' });
  if (newPwd.length < 6) return res.json({ success: false, msg: '新密码至少6位' });

  const newHash = await bcrypt.hash(newPwd, 10);
  await db.query('UPDATE users SET password = $1 WHERE id = $2', [newHash, user.id]);
  res.json({ success: true, msg: '密码修改成功！请重新登录' });
});

module.exports = router;
