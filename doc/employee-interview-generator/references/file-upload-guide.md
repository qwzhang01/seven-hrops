# 文件上传与网页链接处理指南

本技能支持上传员工信息文件或提供网页链接，自动分析员工信息后生成访谈提纲。

---

## 📁 支持的文件格式

| 格式 | 最大大小 | 适用场景 | 处理工具 |
|-----|---------|---------|---------|
| **Excel** (.xlsx/.xls) | 10MB | 绩效数据、考勤记录、项目清单 | document-handler / tencent-docs |
| **PDF** (.pdf) | 20MB | 简历、绩效报告、评估文档 | document-parser / document-handler |
| **Word** (.docx/.doc) | 10MB | 工作总结、述职报告 | document-handler |
| **PPTX** (.pptx) | 20MB | 述职报告、项目汇报 | document-handler |
| **TXT** (.txt) | 5MB | 纯文本记录、笔记 | 直接读取 |

---

## 🔗 支持的网页链接

| 链接类型 | 示例 | 处理方式 |
|---------|------|---------|
| **腾讯文档** | https://docs.qq.com/... | tencent-docs.get_content |
| **飞书文档** | https://[tenant].feishu.cn/... | feishu_doc.read |
| **GitHub** | https://github.com/username | web_fetch |
| **LinkedIn** | https://linkedin.com/in/... | web_fetch |
| **博客/个人主页** | https://... | web_fetch / browser.snapshot |
| **公司内部系统** | 需提供访问权限 | 需确认是否可访问 |

---

## 🔄 处理流程

### 方式 A：文件上传处理

```
1. 用户上传文件
   ↓
2. 检测文件格式
   ↓
3. 调用相应工具解析
   - Excel → document-handler / tencent-docs
   - PDF → document-parser
   - Word → document-handler
   - PPTX → document-handler
   - TXT → 直接读取
   ↓
4. 提取员工相关信息
   ↓
5. 分类整理并呈现给 HR
   ↓
6. HR 确认/补充/修正
   ↓
7. 继续访谈思路生成
```

### 方式 B：网页链接处理

```
1. 用户提供网页链接
   ↓
2. 检测链接类型
   ↓
3. 调用相应工具抓取
   - 腾讯文档 → tencent-docs.get_content
   - 飞书文档 → feishu_doc.read
   - 普通网页 → web_fetch
   - 复杂网页 → browser.snapshot
   ↓
4. 提取员工相关信息
   ↓
5. 分类整理并呈现给 HR
   ↓
6. HR 确认/补充/修正
   ↓
7. 继续访谈思路生成
```

---

## 📊 信息提取规则

### 基本信息提取

```yaml
姓名：从文件名、文档标题、内容中识别
职位/职级：查找"职位"、"职级"、"岗位"、"title"等关键词
部门：查找"部门"、"团队"、"organization"等关键词
入职时间：查找"入职"、"join"、"start date"等关键词
汇报对象：查找"汇报"、"上级"、"manager"等关键词
```

### 绩效表现提取

```yaml
绩效评级：查找"绩效"、"评级"、"rating"、"performance"等关键词
项目名称：查找"项目"、"project"、"负责"等关键词
项目角色：查找"角色"、"role"、"负责"等关键词
项目成果：查找"成果"、"成果"、"achievement"、"提升"等关键词
```

### 能力特长提取

```yaml
技术栈：查找技术名词（编程语言、框架、工具等）
证书资质：查找"证书"、"认证"、"certification"等关键词
培训经历：查找"培训"、"学习"、"training"等关键词
```

### 特殊情况提取

```yaml
工作负荷：查找"加班"、"负荷"、"压力"等关键词
晋升意向：查找"晋升"、"发展"、"成长"等关键词
离职倾向：查找"离职"、"机会"、"考虑"等关键词
其他异常：情绪词汇、负面表达等
```

---

## 🛠️ 工具调用示例

### Excel 文件处理

```bash
# 如 Excel 在腾讯文档中
mcporter call tencent-docs.get_content --args '{"file_id": "xxx"}'

# 如为本地文件，使用 document-handler
mcporter call document-handler.read_file --args '{"path": "/path/to/file.xlsx"}'
```

### PDF 文件处理

```bash
mcporter call document-parser.parse --args '{"file_path": "/path/to/file.pdf"}'
```

### Word 文件处理

```bash
mcporter call document-handler.read_file --args '{"path": "/path/to/file.docx"}'
```

### PPTX 文件处理

```bash
mcporter call document-handler.read_file --args '{"path": "/path/to/file.pptx"}'
```

### 网页链接处理

```bash
# 普通网页
web_fetch --url "https://example.com" --extractMode markdown

# 腾讯文档
mcporter call tencent-docs.get_content --args '{"file_id": "xxx"}'

# 复杂网页（需要 JavaScript 渲染）
browser.snapshot --url "https://example.com" --refs aria
```

---

## ⚠️ 注意事项

### 文件处理

1. **文件大小限制** - 超过限制需告知用户
2. **加密文件** - 不支持加密文件，需告知用户
3. **扫描版 PDF** - 可能需要 OCR，告知用户识别率可能不高
4. **隐私保护** - 提醒用户不要上传敏感信息

### 网页链接

1. **访问权限** - 确认链接可公开访问或已授权
2. **登录要求** - 需要登录的页面无法访问
3. **动态内容** - 部分网页需要 JavaScript 渲染，使用 browser.snapshot
4. **隐私保护** - 提醒用户不要提供涉及隐私的链接

### 信息准确性

1. **信息时效性** - 告知用户信息可能有过时风险
2. **信息完整性** - 文件/链接可能不包含全部信息，需 HR 补充
3. **信息确认** - 必须经 HR 确认后再使用

---

## 📝 输出示例

### 员工信息分析结果

```markdown
## 📊 员工信息分析结果

**信息来源**：上传文件《张 XXX-2024 年度述职报告.pdf》

### 基本信息
- 姓名：张 XXX
- 职位：后端开发工程师 P6
- 部门：技术部 - 基础架构组
- 入职时间：2023 年 3 月（2 年）
- 汇报对象：李 XXX（技术总监）

### 绩效表现
- 2024 Q1-Q4：连续 4 季度超出预期
- 年度评级：S（前 10%）
- 360 评估：同事评分 4.8/5.0

### 核心项目
1. **项目 A - 高并发系统优化**
   - 角色：核心开发
   - 成果：响应时间降低 30%，支撑 10 倍流量增长

2. **项目 B - 微服务架构重构**
   - 角色：技术负责人
   - 成果：完成 5 个核心服务拆分，系统稳定性提升 50%

### 能力特长
- 技术栈：Go/Python/K8s/Redis
- 特长：高并发系统设计、性能优化
- 证书：AWS 认证工程师

### 特殊情况（从述职报告中识别）
- 近期工作负荷较大（提及"连续加班 3 个月"）
- 有晋升意向（提及"希望承担更多责任"）
- 团队管理兴趣（提及"指导 2 名新人"）

---

**请确认以上信息是否准确？如有需要补充或修正，请告诉我。**
```

### 访谈思路示例

```markdown
## 💡 访谈思路

**本次绩效访谈聚焦三大重点：**

1. **肯定高绩效表现** - 连续 4 季度超出预期，需充分认可成绩，强化成就感
2. **评估工作状态** - 连续加班 3 个月，需了解 burnout 风险，探讨工作生活平衡
3. **探索发展诉求** - 有晋升意向和管理兴趣，需明确发展路径和机会

**问题策略：**
以开放式问题为主，先肯定成绩建立信任，再深入探讨工作状态。晋升话题需谨慎，本期名额有限，避免过度承诺。

**注意事项：**
- 避免过度施压，关注员工身心健康
- 晋升话题谨慎回应，强调长期发展
- 如表露离职倾向，立即启动挽留评估

---

**请确认以上访谈思路是否合适？如需要调整，请告诉我。**
```

---

## 🔄 与主流程的衔接

```
文件/链接处理 → 信息分析呈现 → HR 确认 → 访谈思路生成 → HR 确认 → 完整提纲生成
```

**关键检查点：**
1. ✅ 信息提取完成后，必须 HR 确认
2. ✅ 访谈思路生成后，必须 HR 确认
3. ✅ 任一环节 HR 要求修改，需返回上一步

---

**本指南为文件上传和网页链接处理的详细说明，实际使用时需根据具体场景灵活调整。**
