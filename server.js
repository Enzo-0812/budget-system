const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const SECRET = process.env.JWT_SECRET || 'budget-secret-2026';

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await db.query(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  real_name VARCHAR(50) NOT NULL,
  dept_id VARCHAR(20) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'staff',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS budgets (
  id SERIAL PRIMARY KEY,
  dept_id VARCHAR(20) NOT NULL,
  category VARCHAR(50) NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  used_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  UNIQUE (dept_id, category)
);

CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  request_no VARCHAR(32) UNIQUE NOT NULL,
  applicant_id INT NOT NULL REFERENCES users(id),
  dept_id VARCHAR(20) NOT NULL,
  category VARCHAR(50) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  purpose TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'approved',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
  `);

  const admin = await db.query('SELECT id FROM users WHERE username=$1', ['admin']);
  if (!admin.rows.length) {
    const hash = await bcrypt.hash('123456', 10);
    await db.query(
      'INSERT INTO users (username,password,real_name,dept_id,role) VALUES ($1,$2,$3,$4,$5)',
      ['admin', hash, '系统管理员', 'admin', 'admin']
    );
    const depts = ['admin','sales','tech','ops'];
    const cats = [['office',50000],['travel',30000],['procurement',60000],['business',15000],['project',40000]];
    for (const d of depts) {
      for (const [c,t] of cats) {
        await db.query(
          'INSERT INTO budgets (dept_id,category,total_amount,used_amount) VALUES ($1,$2,$3,$4)',
          [d, c, t, Math.floor(Math.random() * t * 0.7)]
        );
      }
    }
  }
}

app.post('/api/login', async (req, res) => {
  const {username, password} = req.body;
  const {rows} = await db.query('SELECT * FROM users WHERE username=$1', [username]);
  if (!rows.length) return res.status(400).json({msg:'账号或密码错误'});
  const ok = await bcrypt.compare(password, rows[0].password);
  if (!ok) return res.status(400).json({msg:'账号或密码错误'});
  const token = jwt.sign({id:rows[0].id, role:rows[0].role}, SECRET, {expiresIn:'24h'});
  res.json({token, user:{name:rows[0].real_name, role:rows[0].role}});
});

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({msg:'未登录'});
  try {
    req.user = jwt.verify(h.split(' ')[1], SECRET);
    next();
  } catch { res.status(401).json({msg:'登录已过期'}); }
}

app.get('/api/budgets', auth, async (req, res) => {
  const {rows} = await db.query('SELECT dept_id,category,total_amount,used_amount FROM budgets');
  res.json(rows);
});

app.post('/api/requests', auth, async (req, res) => {
  const {dept, category, amount, purpose} = req.body;
  const {rows} = await db.query('SELECT total_amount,used_amount FROM budgets WHERE dept_id=$1 AND category=$2', [dept, category]);
  if (!rows.length) return res.status(400).json({msg:'预算科目不存在'});
  const remain = Number(rows[0].total_amount) - Number(rows[0].used_amount);
  if (amount > remain) return res.json({ok:false, msg:`预算不足！剩余¥${remain.toFixed(2)}`});
  
  await db.query('UPDATE budgets SET used_amount=used_amount+$1 WHERE dept_id=$2 AND category=$3', [amount, dept, category]);
  const no = `REQ${Date.now()}`;
  await db.query(
    'INSERT INTO requests (request_no,applicant_id,dept_id,category,amount,purpose,status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [no, req.user.id, dept, category, amount, purpose, 'approved']
  );
  res.json({ok:true, no, remain: remain - amount});
});

app.get('/api/requests', auth, async (req, res) => {
  const {rows} = await db.query(`
    SELECT r.*, u.real_name as applicant_name 
    FROM requests r LEFT JOIN users u ON r.applicant_id=u.id 
    ORDER BY r.created_at DESC LIMIT 50
  `);
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  console.log('✅ 系统已就绪');
  app.listen(PORT, () => console.log(`🚀 服务运行中`));
}).catch(e => console.error('❌ 启动失败:', e));