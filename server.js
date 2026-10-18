const express = require('express');
const { Pool } = require('pg');
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
    // 重建表结构
    await db.query('DROP TABLE IF EXISTS users CASCADE');
    await db.query('DROP TABLE IF EXISTS budgets CASCADE');
    await db.query('DROP TABLE IF EXISTS requests CASCADE');
    await db.query('DROP TABLE IF EXISTS dept_config CASCADE');
    await db.query('DROP TABLE IF EXISTS category_config CASCADE');

    await db.query(`
      CREATE TABLE users (
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
      CREATE TABLE dept_config (
        dept_id VARCHAR(20) PRIMARY KEY,
        display_name VARCHAR(50) NOT NULL
      )
    `);

    await db.query(`
      CREATE TABLE category_config (
        cat_id VARCHAR(30) PRIMARY KEY,
        display_name VARCHAR(50) NOT NULL,
        cat_type VARCHAR(10) DEFAULT 'admin'
      )
    `);

    await db.query(`
      CREATE TABLE budgets (
        id SERIAL PRIMARY KEY,
        dept_id VARCHAR(20) NOT NULL,
        category_id VARCHAR(30) NOT NULL,
        total_amount DECIMAL(15,2) DEFAULT 0,
        used_amount DECIMAL(15,2) DEFAULT 0,
        warning_rate DECIMAL(5,2) DEFAULT 80.00,
        UNIQUE(dept_id, category_id)
      )
    `);

    await db.query(`
      CREATE TABLE requests (
        id SERIAL PRIMARY KEY,
        request_no VARCHAR(30) UNIQUE NOT NULL,
        dept_id VARCHAR(20) NOT NULL,
        category VARCHAR(30) NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        purpose TEXT,
        applicant_id INT REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'approved',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 部门
    const depts = [
      ['zonghe','综合部'],
      ['shangwu','商务部'],
      ['gongcheng','工程部'],
      ['anzhi','安质部'],
      ['caiwu','财务部'],
      ['qihua','企化部'],
      ['jingying','经营开发中心']
    ];
    for (const [id, name] of depts) {
      await db.query('INSERT INTO dept_config VALUES ($1,$2)', [id, name]);
    }

    // 科目
    const cats = [
      ['staff_pay','职工薪酬','admin'],
      ['salary_total','工资总额','admin'],
      ['welfare','福利费用','admin'],
      ['fixed_asset_dep','固定资产折旧','admin'],
      ['low_value_amort','低值易耗品摊销','admin'],
      ['travel','差旅费','admin'],
      ['office','办公费','admin'],
      ['rent','租赁费','admin'],
      ['agency','中介费用','admin'],
      ['pollution_fee','排污绿化费','admin'],
      ['property_fee','物业管理费','admin'],
      ['vehicle_fee','车辆费用','admin'],
      ['conference','会议费','admin'],
      ['labor_insurance','劳保费','admin'],
      ['other_admin','其他','admin'],
      ['staff_pay_s','职工薪酬','sales'],
      ['salary_total_s','工资总额','sales'],
      ['welfare_s','福利费用','sales'],
      ['office_s','办公费','sales'],
      ['transport_s','交通费','sales'],
      ['travel_s','差旅费','sales'],
      ['entertainment_s','业务招待费','sales'],
      ['rent_s','租赁费用','sales'],
      ['labor_insurance_s','劳保费','sales'],
      ['other_sales','其他','sales']
    ];
    for (const [id, name, type] of cats) {
      await db.query('INSERT INTO category_config VALUES ($1,$2,$3)', [id, name, type]);
    }

    // ========== 预算数据：单位 万美元 → 内部转元存储 ==========
    const budgets = [
      // 综合部 - 管理费用
      ['zonghe','staff_pay',326.02,128.13],
      ['zonghe','salary_total',230.98,86.26],
      ['zonghe','welfare',0.77,7.28],
      ['zonghe','fixed_asset_dep',8.68,0.73],
      ['zonghe','low_value_amort',2.55,3.44],
      ['zonghe','travel',20.95,11.42],
      ['zonghe','office',6.73,5.05],
      ['zonghe','rent',13.05,13.00],
      ['zonghe','agency',18.77,7.22],
      ['zonghe','pollution_fee',0.40,0],
      ['zonghe','property_fee',3.17,0.72],
      ['zonghe','vehicle_fee',1.86,1.95],
      ['zonghe','conference',3.45,0.17],
      ['zonghe','labor_insurance',24.52,8.28],
      ['zonghe','other_admin',15.09,1.36],
      // 经营开发中心 - 销售费用
      ['jingying','staff_pay_s',218.36,90.10],
      ['jingying','salary_total_s',161.80,62.04],
      ['jingying','welfare_s',1.28,5.19],
      ['jingying','office_s',11.22,3.27],
      ['jingying','transport_s',11.40,0.64],
      ['jingying','travel_s',33.08,4.93],
      ['jingying','entertainment_s',5.00,0.19],
      ['jingying','rent_s',69.48,45.16],
      ['jingying','labor_insurance_s',40.86,7.21],
      ['jingying','other_sales',8.13,1.27]
    ];

    for (const [deptId, catId, totalWan, usedWan] of budgets) {
      await db.query(
        `INSERT INTO budgets (dept_id, category_id, total_amount, used_amount, warning_rate)
         VALUES ($1, $2, $3, $4, 80)`,
        [deptId, catId, Math.round(totalWan * 10000), Math.round(usedWan * 10000)]
      );
    }

    // 用户
    const users = [
      { username: 'admin', name: '系统管理员', password: '123456', department: 'zonghe', role: 'admin' },
      { username: 'Enzo', name: 'Enzo', password: 'ZZY1995zxakk', department: 'zonghe', role: 'admin' }
    ];
    for (const u of users) {
      await db.query(
        'INSERT INTO users (username, name, password, department, role) VALUES ($1, $2, $3, $4, $5)',
        [u.username, u.name, u.password, u.department, u.role]
      );
    }

    console.log('✅ 全部预算数据预置完成！');
  } catch (err) {
    console.error('❌', err);
  }
}

// 登录
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const u = (await db.query('SELECT * FROM users WHERE username = $1', [username])).rows[0];
  if (!u) return res.status(400).json({ msg: '账号或密码错误' });
  if (u.password !== password) return res.status(400).json({ msg: '账号或密码错误' });
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

app.get('/api/categories', auth, async (_, res) => {
  const r = await db.query('SELECT cat_id, display_name, cat_type FROM category_config ORDER BY cat_type, cat_id');
  res.json(r.rows);
});

app.get('/api/budgets', auth, async (_, res) => {
  const r = await db.query('SELECT * FROM budgets');
  res.json(r.rows);
});

app.post('/api/budgets', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: '无权限' });
  const { dept_id, category_id, total_amount, warning_rate } = req.body;
  await db.query(
    `INSERT INTO budgets (dept_id, category_id, total_amount, used_amount, warning_rate)
     VALUES ($1, $2, $3, 0, COALESCE($4, 80))
     ON CONFLICT (dept_id, category_id) 
     DO UPDATE SET total_amount = $3, warning_rate = COALESCE($4, 80)`,
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
  if (!b) return res.json({ ok: false, msg: '该部门科目未设置预算，请先在预算设置中填写' });
  const used = +b.used_amount, total = +b.total_amount;
  if (used + amount > total) return res.json({ ok: false, msg: `超出预算额度！总额: ${(total/10000).toFixed(2)}万，已用: ${(used/10000).toFixed(2)}万` });
  
  await db.query('UPDATE budgets SET used_amount = used_amount + $1 WHERE dept_id = $2 AND category_id = $3', [amount, dept, category]);
  await db.query(
    'INSERT INTO requests (request_no, dept_id, category, amount, purpose, applicant_id) VALUES ($1, $2, $3, $4, $5, $6)',
    [no, dept, category, amount, purpose, req.user.id]
  );
  
  const remain = total - used - amount;
  const pct = (used + amount) / total * 100;
  let warn = null;
  if (pct >= +b.warning_rate) {
    warn = `该科目使用率已达${pct.toFixed(1)}%（预警线${b.warning_rate}%）`;
  }
  res.json({ ok: true, no, remain, warn });
});

app.post('/user/password', auth, async (req, res) => {
  const { oldPwd, newPwd, confirmPwd } = req.body;
  if (newPwd !== confirmPwd) return res.json({ success: false, msg: '两次新密码不一致' });
  if (newPwd.length < 6) return res.json({ success: false, msg: '密码至少6位' });
  const u = (await db.query('SELECT * FROM users WHERE id = $1', [req.user.id])).rows[0];
  if (u.password !== oldPwd) return res.json({ success: false, msg: '原密码错误' });
  await db.query('UPDATE users SET password = $1 WHERE id = $2', [newPwd, req.user.id]);
  res.json({ success: true, msg: '密码修改成功，请重新登录' });
});

app.get('/api/export/excel', auth, async (_, res) => {
  const rows = (await db.query('SELECT * FROM requests ORDER BY created_at DESC')).rows;
  const csv = '\uFEFF申请单号,部门,科目,金额(万美元),用途,状态,申请时间\n' + rows.map(r =>
    `"${r.request_no}","${r.dept_id}","${r.category}",${(+r.amount/10000).toFixed(2)},"${(r.purpose||'').replace(/"/g,'""')}","${r.status}","${r.created_at}"`
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv;charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment;filename=预算记录.csv');
  res.send(csv);
});

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDatabase().then(() => app.listen(PORT, () => console.log(`🚀 运行在端口 ${PORT}`)));
