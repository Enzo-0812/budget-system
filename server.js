const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = 'budget-secret-2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Pool({
  connectionString: process.env.DATABASE_URL
});

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: '未登录' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ msg: '登录已过期' });
  }
}

// 一次性初始化标记
let initialized = false;

async function initOnce() {
  if (initialized) return;
  try {
    console.log('🔍 检查数据库状态...');
    
    // 检查表是否存在
    const res = await db.query(`
      SELECT to_regclass('public.users') AS exists
    `);
    
    if (!res.rows[0].exists) {
      console.log('📦 首次初始化数据库...');
      
      // 用户表
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
      
      // 预算表
      await db.query(`
        CREATE TABLE budgets (
          id SERIAL PRIMARY KEY,
          dept_id VARCHAR(20) NOT NULL,
          category_id VARCHAR(30) NOT NULL,
          total_amount NUMERIC(15,2) DEFAULT 0,
          used_amount NUMERIC(15,2) DEFAULT 0,
          warning_rate NUMERIC(5,2) DEFAULT 80,
          UNIQUE(dept_id, category_id)
        )
      `);
      
      // 申请表
      await db.query(`
        CREATE TABLE requests (
          id SERIAL PRIMARY KEY,
          request_no VARCHAR(30) UNIQUE NOT NULL,
          dept_id VARCHAR(20) NOT NULL,
          category VARCHAR(30) NOT NULL,
          amount NUMERIC(15,2) NOT NULL,
          purpose TEXT,
          applicant_id INT REFERENCES users(id),
          status VARCHAR(20) DEFAULT 'approved',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 插入用户
      await db.query(`
        INSERT INTO users (username, name, password, department, role) VALUES
        ('admin', '系统管理员', '123456', 'zonghe', 'admin'),
        ('Enzo', 'Enzo', 'ZZY1995zxakk', 'zonghe', 'admin')
      `);
      
      // 插入预算数据
      const budgets = [
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
      
      console.log('✅ 数据库初始化完成');
    } else {
      console.log('✅ 数据库已存在，跳过初始化');
    }
    
    initialized = true;
  } catch (err) {
    console.error('❌ 初始化失败：', err);
  }
}

// 手动重置接口 —— 仅你可用
app.post('/api/admin/reset-db', async (req, res) => {
  try {
    // 检查密钥
    if (req.body.secret !== 'reset-2026') {
      return res.status(403).json({ msg: '无权限' });
    }
    
    await db.query('DROP TABLE IF EXISTS requests CASCADE');
    await db.query('DROP TABLE IF EXISTS budgets CASCADE');
    await db.query('DROP TABLE IF EXISTS users CASCADE');
    
    initialized = false;
    await initOnce();
    
    res.json({ ok: true, msg: '数据库已重置！admin/123456 登录' });
  } catch (err) {
    res.status(500).json({ msg: '重置失败：' + err.message });
  }
});

// 登录
app.post('/api/login', async (req, res) => {
  await initOnce();
  const { username, password } = req.body;
  
  try {
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    const u = result.rows[0];
    
    if (!u) return res.status(400).json({ msg: '账号不存在' });
    if (u.password !== password) return res.status(400).json({ msg: '密码错误' });
    
    const token = jwt.sign(
      { id: u.id, username: u.username, name: u.name, role: u.role, dept: u.department },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, name: u.name, role: u.role });
  } catch (err) {
    console.error('登录错误：', err);
    res.status(500).json({ msg: '系统错误，请稍后重试' });
  }
});

app.get('/api/budgets', auth, async (_, res) => {
  const r = await db.query('SELECT * FROM budgets ORDER BY dept_id, category_id');
  res.json(r.rows);
});

app.post('/api/budgets', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ msg: '无权限' });
  const { dept_id, category_id, total_amount, warning_rate } = req.body;
  await db.query(
    `INSERT INTO budgets (dept_id, category_id, total_amount, used_amount, warning_rate)
     VALUES ($1, $2, $3, 0, COALESCE($4, 80))
     ON CONFLICT (dept_id, category_id) DO UPDATE SET total_amount=$3, warning_rate=COALESCE($4, 80)`,
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
  if (!b) return res.json({ ok: false, msg: '该科目未设置预算' });
  const used = +b.used_amount, total = +b.total_amount;
  if (used + amount > total) return res.json({ ok: false, msg: '超出预算额度' });
  
  await db.query('UPDATE budgets SET used_amount=used_amount+$1 WHERE dept_id=$2 AND category_id=$3', [amount, dept, category]);
  await db.query(
    'INSERT INTO requests (request_no,dept_id,category,amount,purpose,applicant_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [no, dept, category, amount, purpose, req.user.id]
  );
  
  const remain = total - used - amount;
  const pct = (used + amount) / total * 100;
  const warn = pct >= +b.warning_rate ? `⚠️ 使用率${pct.toFixed(1)}%` : null;
  res.json({ ok: true, no, remain, warn });
});

app.post('/user/password', auth, async (req, res) => {
  const { oldPwd, newPwd, confirmPwd } = req.body;
  if (newPwd !== confirmPwd) return res.json({ success: false, msg: '两次密码不一致' });
  if (newPwd.length < 6) return res.json({ success: false, msg: '密码至少6位' });
  const u = (await db.query('SELECT * FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (u.password !== oldPwd) return res.json({ success: false, msg: '原密码错误' });
  await db.query('UPDATE users SET password=$1 WHERE id=$2', [newPwd, req.user.id]);
  res.json({ success: true, msg: '修改成功，请重新登录' });
});

app.get('/api/export/excel', auth, async (_, res) => {
  const rows = (await db.query('SELECT * FROM requests ORDER BY created_at DESC')).rows;
  const allCats = [
    {id:'staff_pay',name:'职工薪酬'},{id:'salary_total',name:'工资总额'},{id:'welfare',name:'福利费用'},
    {id:'fixed_asset_dep',name:'固定资产折旧'},{id:'low_value_amort',name:'低值易耗品摊销'},{id:'travel',name:'差旅费'},
    {id:'office',name:'办公费'},{id:'rent',name:'租赁费'},{id:'agency',name:'中介费用'},
    {id:'pollution_fee',name:'排污绿化费'},{id:'property_fee',name:'物业管理费'},{id:'vehicle_fee',name:'车辆费用'},
    {id:'conference',name:'会议费'},{id:'labor_insurance',name:'劳保费'},{id:'other_admin',name:'其他'},
    {id:'staff_pay_s',name:'职工薪酬'},{id:'salary_total_s',name:'工资总额'},{id:'welfare_s',name:'福利费用'},
    {id:'office_s',name:'办公费'},{id:'transport_s',name:'交通费'},{id:'travel_s',name:'差旅费'},
    {id:'entertainment_s',name:'业务招待费'},{id:'rent_s',name:'租赁费用'},{id:'labor_insurance_s',name:'劳保费'},{id:'other_sales',name:'其他'}
  ];
  const csv = '\uFEFF申请单号,部门,科目,金额(万美元),用途,状态,时间\n' + rows.map(r => {
    const catName = allCats.find(c => c.id === r.category)?.name || r.category;
    return `"${r.request_no}","${r.dept_id}","${catName}",${(+r.amount/10000).toFixed(2)},"${(r.purpose||'').replace(/"/g,'""')}","${r.status}","${r.created_at}"`;
  }).join('\n');
  res.setHeader('Content-Type', 'text/csv;charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment;filename=预算记录.csv');
  res.send(csv);
});

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initOnce().then(() => app.listen(PORT, () => console.log(`🚀 运行在端口 ${PORT}`)));
