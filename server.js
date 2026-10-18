const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = 'budget-secret-2026-final';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ msg: '未登录' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ msg: '登录已过期，请重新登录' });
  }
}

app.post('/api/admin/reset-db', async (req, res) => {
  try {
    if (req.body.secret !== 'reset-2026') {
      return res.status(403).json({ msg: '无权限' });
    }

    console.log('🔄 重置数据库...');

    await db.query('DROP TABLE IF EXISTS requests CASCADE');
    await db.query('DROP TABLE IF EXISTS budgets CASCADE');
    await db.query('DROP TABLE IF EXISTS users CASCADE');

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
      INSERT INTO users (username, name, password, department, role) VALUES
      ('admin', '系统管理员', '123456', 'zonghe', 'admin'),
      ('Enzo', 'Enzo', 'ZZY1995zxakk', 'zonghe', 'admin')
    `);
    console.log('✅ 用户创建成功');

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

    console.log('✅ 预算数据导入完成，共', budgets.length, '条');
    res.json({ ok: true, msg: '重置成功！请用 admin / 123456 登录' });
  } catch (err) {
    console.error('❌ 重置失败：', err);
    res.status(500).json({ ok: false, msg: '重置失败: ' + err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log('🔐 登录请求:', username);

    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user) {
      console.log('❌ 账号不存在');
      return res.status(400).json({ msg: '账号不存在' });
    }

    if (user.password !== password) {
      console.log('❌ 密码错误');
      return res.status(400).json({ msg: '密码错误' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('✅ 登录成功:', user.name);
    res.json({ token, name: user.name, role: user.role });
  } catch (err) {
    console.error('❌ 登录异常:', err);
    res.status(500).json({ msg: '系统错误: ' + err.message });
  }
});

app.get('/api/budgets', auth, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM budgets ORDER BY dept_id, category_id');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ msg: '查询失败' });
  }
});

app.post('/api/budgets', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ msg: '无权限' });
  }
  try {
    const { dept_id, category_id, total_amount, warning_rate } = req.body;
    await db.query(
      `INSERT INTO budgets (dept_id, category_id, total_amount, used_amount, warning_rate)
       VALUES ($1, $2, $3, 0, COALESCE($4, 80))
       ON CONFLICT (dept_id, category_id) DO UPDATE 
       SET total_amount = $3, warning_rate = COALESCE($4, 80)`,
      [dept_id, category_id, total_amount, warning_rate]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ msg: '保存失败' });
  }
});

app.get('/api/requests', auth, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM requests ORDER BY created_at DESC LIMIT 50');
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ msg: '查询失败' });
  }
});

app.post('/api/requests', auth, async (req, res) => {
  try {
    const { dept, category, amount, purpose } = req.body;
    const no = 'BUD' + Date.now();

    const budgetRes = await db.query(
      'SELECT * FROM budgets WHERE dept_id = $1 AND category_id = $2',
      [dept, category]
    );
    const budget = budgetRes.rows[0];
    if (!budget) {
      return res.json({ ok: false, msg: '该科目未设置预算' });
    }

    const used = Number(budget.used_amount);
    const total = Number(budget.total_amount);
    if (used + amount > total) {
      return res.json({ ok: false, msg: `超出预算！总额: ${(total/10000).toFixed(2)}万，已用: ${(used/10000).toFixed(2)}万` });
    }

    await db.query(
      'UPDATE budgets SET used_amount = used_amount + $1 WHERE dept_id = $2 AND category_id = $3',
      [amount, dept, category]
    );

    await db.query(
      `INSERT INTO requests (request_no, dept_id, category, amount, purpose, applicant_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [no, dept, category, amount, purpose, req.user.id]
    );

    const remain = total - used - amount;
    const pct = (used + amount) / total * 100;
    const warn = pct >= Number(budget.warning_rate) ? `使用率${pct.toFixed(1)}%` : null;

    res.json({ ok: true, no, remain, warn });
  } catch (err) {
    console.error('申请失败：', err);
    res.status(500).json({ msg: '提交失败' });
  }
});

app.post('/user/password', auth, async (req, res) => {
  try {
    const { oldPwd, newPwd, confirmPwd } = req.body;
    if (newPwd !== confirmPwd) {
      return res.json({ success: false, msg: '两次密码不一致' });
    }
    if (newPwd.length < 6) {
      return res.json({ success: false, msg: '密码至少6位' });
    }

    const userRes = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = userRes.rows[0];
    if (user.password !== oldPwd) {
      return res.json({ success: false, msg: '原密码错误' });
    }

    await db.query('UPDATE users SET password = $1 WHERE id = $2', [newPwd, req.user.id]);
    res.json({ success: true, msg: '修改成功，请重新登录' });
  } catch (err) {
    res.json({ success: false, msg: '操作失败' });
  }
});

app.get('/api/export/excel', auth, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM requests ORDER BY created_at DESC');
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

    const csv = '\uFEFF申请单号,部门,科目,金额(万美元),用途,状态,时间\n' + rows.rows.map(r => {
      const catName = allCats.find(c => c.id === r.category)?.name || r.category;
      return `"${r.request_no}","${r.dept_id}","${catName}",${(Number(r.amount)/10000).toFixed(2)},"${(r.purpose||'').replace(/"/g,'""')}","${r.status}","${r.created_at}"`;
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv;charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment;filename=预算记录.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).send('导出失败');
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 服务运行在端口 ${PORT}`);
});
