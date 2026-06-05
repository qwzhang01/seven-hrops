# employee-interview-generator v3.0.0 发布指南

## 📋 发布前检查清单

- [x] SKILL.md 已更新到 v3.0.0
- [x] 招聘面试场景已添加
- [x] 示例文件已准备（examples/）
- [x] 测试已通过（output/recruitment-interview-test.md）
- [x] 发布说明已编写（RELEASE-v3.0.0.md）
- [ ] clawhub 登录验证
- [ ] 执行发布命令
- [ ] 验证发布成功

---

## 🚀 发布步骤

### 步骤 1：验证 clawhub 登录

```bash
# 检查是否已登录
clawhub whoami

# 如未登录，执行登录
clawhub login
# 会打开浏览器进行 OAuth 授权
# 或使用 token 登录
clawhub login --token YOUR_API_TOKEN
```

### 步骤 2：执行发布

```bash
# 进入技能目录
cd /root/.openclaw/workspace/skills/employee-interview-generator

# 发布到 clawhub
clawhub publish . \
  --version 3.0.0 \
  --name "Employee Interview Generator" \
  --changelog "v3.0.0 - 新增招聘面试场景支持

新功能:
- 支持招聘面试场景（外部候选人）
- 新增 STAR 面试法框架
- 新增文化匹配度评估
- 新增面试评估表（100 分制量化评分）

改进:
- 扩展输入类型：支持简历 + JD + 胜任力模型
- 新增 5 种面试类型：初面/业务面/高管面/校招/社招
- 新增红线信号检查清单
- 新增面试问题评分标准

方法论:
- 新增 STAR 面试法
- 新增文化匹配度框架
- 扩展冰山模型用于候选人评估" \
  --tags "latest,recruitment,star,hr,interview"
```

### 步骤 3：验证发布

```bash
# 查看已发布的技能
clawhub list

# 或访问 clawhub.com 查看
# https://clawhub.com/skills/employee-interview-generator
```

---

## 🔑 获取 API Token

如果还没有 clawhub API token：

1. 访问 https://clawhub.com
2. 登录账号
3. 进入"设置" → "API Tokens"
4. 点击"创建新 Token"
5. 复制 Token 并保存
6. 使用 token 登录：
   ```bash
   clawhub login --token YOUR_TOKEN_HERE
   ```

---

## 📊 发布后验证

### 1. 检查 clawhub 页面

访问：https://clawhub.com/skills/employee-interview-generator

确认信息：
- [ ] 版本号显示 v3.0.0
- [ ] 描述包含"招聘面试"
- [ ] Tags 包含 recruitment/star
- [ ] 变更说明正确显示

### 2. 测试安装

```bash
# 安装新版本
openclaw skill install employee-interview-generator@3.0.0

# 验证安装
openclaw skill list | grep employee-interview-generator
```

### 3. 测试功能

```bash
# 测试员工访谈场景（原有功能）
openclaw run employee-interview-generator \
  --input examples/employee-example.json \
  --output test-employee-output.md

# 测试招聘面试场景（新增功能）
openclaw run employee-interview-generator \
  --input examples/recruitment-interview-example.json \
  --output test-recruitment-output.md
```

---

## ⚠️ 常见问题

### Q1: 发布失败 "Not logged in"

**解决：**
```bash
clawhub login
# 或
clawhub login --token YOUR_TOKEN
```

### Q2: 发布失败 "Version already exists"

**解决：** 版本号已存在，需要升级版本号
```bash
# 修改 SKILL.md 中的 version 为 3.0.1
# 然后重新发布
clawhub publish . --version 3.0.1
```

### Q3: 发布失败 "Invalid skill structure"

**解决：** 检查技能文件结构
```bash
# 确保有以下文件
ls -la SKILL.md README.md examples/
```

### Q4: 安装后功能不生效

**解决：** 清除缓存重新安装
```bash
openclaw skill uninstall employee-interview-generator
openclaw cache clear
openclaw skill install employee-interview-generator@3.0.0
```

---

## 📝 发布记录

| 版本 | 日期 | 操作 | 状态 |
|------|------|------|------|
| v3.0.0 | 2026-03-13 | 新增招聘面试场景 | 待发布 |
| v2.5.0 | 2026-03-12 | 职级体系优化 | 已发布 |
| v2.4.0 | 2026-03-10 | 离职访谈优化 | 已发布 |

---

## 🎯 发布后任务

- [ ] 更新 GitHub README
- [ ] 通知团队成员
- [ ] 更新内部文档
- [ ] 收集用户反馈
- [ ] 规划 v3.1.0 功能

---

**最后更新：** 2026-03-13  
**负责人：** tommyyang@tencent
