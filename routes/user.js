const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { setDataScope } = require('../middleware/auth');
const router = express.Router();

// 修改密码页面
router.get('/password', setDataScope, (req, res) => {
  res.render('user/password', { user: req.user });
});

// 提交修改密码
router.post('/password', setDataScope, async (req, res) => {
  const { oldPwd, newPwd, confirmPwd } = req.body;
  const user = req.user;

  // 验证原密码
  const isCorrect = await bcrypt.compare(oldPwd, user.password);
  if (!isCorrect) {
    return res.render('user/password', { err: '原密码输入错误', user });
  }

  // 确认两次新密码一致
  if (newPwd !== confirmPwd) {
    return res.render('user/password', { err: '两次输入的新密码不一致', user });
  }

  // 密码长度校验
  if (newPwd.length < 6) {
    return res.render('user/password', { err: '新密码至少6位', user });
  }

  // 加密并保存新密码
  const newHash = await bcrypt.hash(newPwd, 10);
  await query('UPDATE users SET password = $1 WHERE id = $2', [newHash, user.id]);

  // 成功跳转
  req.flash('success', '密码修改成功！请用新密码重新登录');
  res.redirect('/');
});

module.exports = router;
