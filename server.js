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

// 数据库连接
const db = new Pool({
  connectionString: process.env.DATABASE_URL
});

// JWT 认证中间件
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

// 初始化数据库表
async function initDatabase() {
  try {
    // 用户表
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

    // 部门配置表
    await db.query(`
      CREATE TABLE IF NOT EXISTS dept_config (
        dept_id VARCHAR(20) PRIMARY KEY,
        display_name VARCHAR(50) NOT NULL
      )
    `);

    // 科目配置表
    await db.query(`
      CREATE TABLE IF NOT EXISTS category_config (
        cat_id VARCHAR(20) PRIMARY KEY,
        display_name VARCHAR(50) NOT NULL
      )
    `);

    // 预算表
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

    // 申请表
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

    // 初始化默认部门
    const depts = [
      ['admin','综合管理部'],
      ['finance','财务部'],
      ['director','管理层']
    ];
    for (const [id, name] of depts) {
      await db.query(
        'INSERT INTO dept_config (dept_id, display_name) VALUES ($1, $2) ON CONFLICT (dept_id) DO NOTHING',
        [id, name]
      );
    }

    // 初始化默认科目
    const cats = [
      ['office','日常办公费'],
      ['travel','差旅交通费'],
      ['procurement','固定资产采购'],
      ['business','业务招待费'],
      ['project','专项项目支出']
    ];
    for (const [id, name] of cats) {
      await db.query(
        'INSERT INTO category_config (cat_id, display_name) VALUES ($1, $2) ON CONFLICT (cat_id) DO NOTHING',
        [id, name]
      );
    }

    // 初始化管理员
    const adminCheck = await db.query('SELECT * FROM users WHERE username = $1', ['admin']);
    if (adminCheck.rows.length === 0) {
      const hash = await bcrypt.hash('123456', 10);
      await db.query(
        'INSERT INTO users (username, name, password, department, role) VALUES ($1, $2, $3, $4, $5)',
        ['admin', '系统管理员', hash, 'admin', 'admin']
      );
    }

    console.log('✅ 数据库初始化完成');
  } catch (err) {
    console.error('❌ 初始化失败:', err);
  }
}

// 登录接口
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  if (result.rows.length === 0) {
    return res.status(400).json({ msg: '账号或密码错误' });
  }
  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ msg: '账号或密码错误' });
  
  const token = jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role, dept: user.department },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ token, name: user.name, role: user.role });
});

// 获取部门列表
app.get('/api/depts', auth, async (req, res) => {
  const result = await db.query('SELECT dept_id, display_name FROM dept_config ORDER BY dept_id');
  res.json(result.rows);
});

// 新增/修改部门
app.post('/api/depts', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: '无权限' });
  const { dept_id, display_name } = req.body;
  await db.query(`
    INSERT INTO dept_config (dept_id, display_name) VALUES ($1, $2)
    ON CONFLICT (dept_id) DO UPDATE SET display_name = $2
  `, [dept_id, display_name]);
  res.json({ ok: true });
});

// 获取科目列表
app.get('/api/categories', auth, async (req, res) => {
  const result = await db.query('SELECT cat_id, display_name FROM category_config ORDER BY cat_id');
  res.json(result.rows);
});

// 新增/修改科目
app.post('/api/categories', auth, async (req, res) => {
  if (req.user.role !== 'admin')
