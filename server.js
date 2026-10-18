const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'budget-secret-2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Pool({
  connectionString: process.env.DATABASE_URL
});

function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ msg: '未登录' });
  const token = authHeader.replace('Bearer ', '');
  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ msg: '登录已过期' });
  }
}

async function initDatabase() {
  try {
    // 建表
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(50),
        password VARCHAR(255) NOT NULL,
        department VARCHAR(50),
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS dept_config (
        dept_id VARCHAR(20) PRIMARY KEY,
        display_name VARCHAR(50) NOT NULL
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS category_config (
        cat_id VARCHAR(20) PRIMARY KEY,
        display_name VARCHAR(50) NOT NULL
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id SERIAL PRIMARY KEY,
        dept_id VARCHAR(20) NOT NULL,
        category_id VARCHAR(20) NOT NULL,
        total_amount DECIMAL(15,2) DEFAULT 0,
        used_amount DECIMAL(15,2) DEFAULT 0,
        warning_rate DECIMAL(5,2) DEFAULT 80.00,
        UNIQUE(dept_id, category_id)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id SERIAL PRIMARY KEY,
        request_no VARCHAR(30) UNIQUE NOT NULL,
        dept_id VARCHAR(20) NOT NULL,
        category VARCHAR(20) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        purpose TEXT,
        applicant_id INT REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'approved',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 部门
    const depts = [['admin','综合管理部'],['finance','财务部'],['director','管理层']];
    for (const [id, name] of depts) {
      await db.query(`INSERT INTO dept_config VALUES ($1,$2) ON CONFLICT (dept_id) DO UPDATE SET display_name=$2`, [id, name]);
    }

    // 科目
    const cats = [['office','日常办公费'],['travel','差旅交通费'],['procurement','固定资产采购'],['business','业务招待费'],['project','专项项目支出']];
    for (const [id, name] of cats) {
      await db.query(`INSERT INTO category_config VALUES ($1,$2) ON CONFLICT (cat_id) DO UPDATE SET display_name=$2`, [id, name]);
    }

    // 👇 关键：清空所有用户 → 重新生成（密码强制重置）
    await db.query('DELETE FROM users');

    const users = [
      { username: 'Enzo', name: 'Enzo', password: 'ZZY1995zxakk', department: 'admin', role: 'admin' },
      { username: 'SHI', name: 'SHI', password: '123456', department: 'finance', role: 'user' },
      { username: 'ZHAN', name: 'ZHAN', password: '123456', department: 'director', role: 'user' },
      { username: 'Lucia', name: 'LIU', password: '123456', department: 'admin', role: 'user' },
      { username: 'Zazi', name: 'ZHANG', password: '123456', department: 'director', role: 'user' },
      { username: 'Lea', name: 'YANG', password: '123456', department: 'director', role: 'user' },
      { username: 'Ignes', name: 'XINYUE', password: '123456', department: 'director', role: 'user' },
      { username: 'Leonel', name: 'XIAO', password: '123456', department: 'director', role: 'user' },
      { username: 'Jullie', name: 'LIN', password: '123456', department: 'director', role: 'user' },
      { username: 'Rafaye', name: 'Rafaye', password: '123456', department: 'director', role: 'user' }
    ];

    for (const u of users) {
      const hash = await bcrypt.hash(u.password, 10);
      await db.query(
        'INSERT INTO users (username, name, password, department, role) VALUES ($1, $2, $3, $4, $5)',
        [u.username, u.name, hash, u.department, u.role]
      );
    }

    console.log('✅ 用户全部重建完成');
  } catch (err) {
    console.error('❌ 初始化失败:', err);
  }
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const u = (await db.query('SELECT * FROM users WHERE username = $1', [username])).rows[0];
  if (!u) return res.status(400).json({ msg: '账号或密码错误' });
  const ok = await bcrypt.compare(password, u.password);
  if (!ok) return res.status(400).json({ msg: '账号或密码错误' });
  const token = jwt.sign(
    { id: u.id, username: u.username, name: u.name, role: u.role, dept: u.department },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ token, name: u.name, role: u.role });
});

app.get('/api/depts', auth, async (_, res) => {
  const r = await db.query('SELECT dept_id, display_name FROM dept_config ORDER BY dept_id');
  res.json(r.rows);
});
app.post('/api/depts', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: '无权限' });
  const { dept_id, display_name } = req.body;
  await db.query(`INSERT INTO dept_config VALUES ($1,$2) ON CONFLICT (dept_id) DO UPDATE SET display_name=$2`, [dept_id, display_name]);
  res.json({ ok: true });
});
app.delete('/api/depts/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: '无权限' });
  await db.query('DELETE FROM dept_config WHERE dept_id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/categories', auth, async (_, res) => {
  const r = await db.query('SELECT cat_id, display_name FROM category_config ORDER BY cat_id');
  res.json(r.rows);
});
app.post('/api/categories', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: '无权限' });
  const { cat_id, display_name } = req.body;
  await db.query(`INSERT INTO category_config VALUES ($1,$2) ON CONFLICT (cat_id) DO UPDATE SET display_name=$2`, [cat_id, display_name]);
  res.json({ ok: true });
});
app.delete('/api/categories/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: '无权限' });
  await db.query('DELETE FROM category_config WHERE cat_id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/budgets', auth, async (_, res) => {
  const r = await db.query('SELECT * FROM budgets');
  res.json(r.rows);
});
app.post('/api/budgets', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: '无权限' });
  const { dept_id, category_id, total_amount, warning_rate } = req.body;
  await db.query(
    `INSERT INTO budgets VALUES ($1,$2,$3,0,COALESCE($4,80)) ON CONFLICT (dept_id,category_id) DO UPDATE SET total_amount=$3,warning_rate=COALESCE($4,80)`,
    [dept_id, category_id, total_amount, warning_rate]
  );
  res.json({ ok: true });
});

app.get('/api/requests', auth, async (_, res) => {
  const r = await db.query('SELECT * FROM requests ORDER BY created_at DESC');
  res.json(r.rows);
});
app.post('/api/requests', auth, async (req, res) => {
  const { dept, category, amount, purpose } = req.body;
  const no = 'BUD' + Date.now();
  const b = (await db.query('SELECT * FROM budgets WHERE dept_id=$1 AND category_id=$2', [dept, category])).rows[0];
  if (!b) return res.json({ ok: false, msg: '该部门科目未设置预算' });
  const used = +b.used_amount, total = +b.total_amount;
  if (used + amount > total) return res.json({ ok: false, msg: '超出预算额度' });
  await db.query('UPDATE budgets SET used_amount=used_amount+$1 WHERE dept_id=$2 AND category_id=$3', [amount, dept, category]);
  await db.query(`INSERT INTO requests (request_no,dept_id,category,amount,purpose,applicant_id) VALUES ($1,$2,$3,$4,$5,$6)`, [no, dept, category, amount, purpose, req.user.id]);
  const remain = total - used - amount;
  const pct = (used + amount) / total * 100;
  let warn = null;
  if (pct >= +b.warning_rate) warn = `该科目使用率已达${pct.toFixed(1)}%（预警线${b.warning_rate}%）`;
  res.json({ ok: true, no, remain, warn });
});

app.post('/user/password', auth, async (req, res) => {
  const { oldPwd, newPwd, confirmPwd } = req.body;
  if (newPwd !== confirmPwd) return res.json({ success: false, msg: '两次新密码不一致' });
  if (newPwd.length < 6) return res.json({ success: false, msg: '密码至少6位' });
  const u = (await db.query('SELECT * FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!await bcrypt.compare(oldPwd, u.password)) return res.json({ success: false, msg: '原密码错误' });
  const hash = await bcrypt.hash(newPwd, 10);
  await db.query('UPDATE users SET password=$1 WHERE id=$2', [hash, req.user.id]);
  res.json({ success: true, msg: '密码修改成功，请重新登录' });
});

app.get('/api/export/excel', auth, async (_, res) => {
  const rows = (await db.query('SELECT * FROM requests ORDER BY created_at DESC')).rows;
  const csv = '\uFEFF申请单号,部门,科目,金额,用途,状态,申请时间\n' + rows.map(r =>
    `"${r.request_no}","${r.dept_id}","${r.category}",${r.amount},"${(r.purpose||'').replace(/"/g,'""')}","${r.status}","${r.created_at}"`
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv;charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment;filename=预算记录.csv');
  res.send(csv);
});

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDatabase().then(() => app.listen(PORT, () => console.log(`🚀 运行在端口 ${PORT}`)));
