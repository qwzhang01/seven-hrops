# About - 关于本技能

## 📦 生产者信息

| 项目 | 信息 |
|-----|------|
| **技能名称** | employee-interview-generator |
| **中文名** | 员工访谈提纲生成器 |
| **作者** | tommyyang@tencent |
| **版本** | 1.0.0 |
| **创建时间** | 2026-03-12 |
| **许可协议** | Apache License 2.0 |
| **代码仓库** | [GitHub](https://github.com/openclaw/workspace/tree/main/skills/employee-interview-generator) |

---

## 👤 关于作者

**tommyyang@tencent** - OpenClaw AI 助手

- **定位**：温暖、友好、带点小幽默的 AI 数字伙伴
- **专长**：OpenClaw 技能开发、自动化工作流、企业效率工具
- **愿景**：让 AI 真正成为人类的高效助手

---

## 🎯 技能背景

### 为什么创建这个技能？

在互联网公司 HR 的日常工作中，员工访谈是一项高频且重要的工作：

- 📊 **场景多样** - 入职、绩效、离职、晋升、职业发展等多种访谈类型
- ⏰ **耗时费力** - 每次访谈需要花费大量时间准备提纲
- 📝 **质量参差** - 不同 HR 的访谈提纲质量差异大
- 🔍 **信息分散** - 员工信息散落在各个系统，难以整合

基于这些痛点，我创建了 `employee-interview-generator` 技能，帮助 HR 快速生成专业、结构化的访谈提纲。

---

## 🌟 核心优势

### 1. 专业化
- 基于互联网公司 HR 实际场景设计
- 8 种访谈类型全覆盖
- 100+ 主问题，300+ 追问提示

### 2. 智能化
- 支持上传员工信息文件自动分析（Excel/PDF/PPTX/Word/TXT）
- 支持网页链接抓取分析
- 自动生成≤300 字访谈思路供确认

### 3. 本地化
- 腾讯文档深度集成
- 中国互联网公司语境（职级、绩效、组织文化）
- 中文优先，理解本土 HR 场景

### 4. 系统化
- 标准化的访谈流程
- 问题设计遵循 OPEN 模型
- 敏感话题处理指南
- 风险预警机制

---

## 📚 技术栈

- **运行平台**：OpenClaw
- **文件格式**：Markdown
- **集成工具**：
  - `tencent-docs` - 腾讯文档创建
  - `document-handler` - 文档解析
  - `document-parser` - PDF 解析
  - `web_fetch` - 网页内容抓取

---

## 🙏 致谢

本技能灵感来源于：

1. **[obra/superpowers](https://github.com/obra/superpowers)** - 代码开发方法论的四阶段流程
2. **[anthropics/skills](https://github.com/anthropics/skills)** - skill-creator 的迭代优化理念
3. **Geoff Smart 的 Topgrading 面试法** - 结构化访谈设计
4. **Lou Adler 的绩效导向面试** - 基于实际工作表现的评估

---

## 📝 更新日志

### v1.0.0 (2026-03-12)

**✨ 初始版本发布**

- 📁 支持 8 种访谈类型（入职/绩效/离职/晋升/发展/反馈/挽留/转岗）
- 📄 支持文件上传分析（Excel/PDF/PPTX/Word/TXT）
- 🔗 支持网页链接分析
- 📝 腾讯文档集成
- 📚 完整问题库（100+ 主问题，300+ 追问）
- 📖 3 个完整示例输出
- 📊 访谈后评估体系
- ⚠️ 敏感话题处理指南

---

## 🤝 贡献指南

欢迎贡献！您可以通过以下方式帮助改进本技能：

1. **报告问题** - [提交 Issue](https://github.com/openclaw/workspace/issues)
2. **提出建议** - 新的访谈类型、问题优化、功能建议
3. **分享案例** - 实际使用案例和反馈
4. **改进文档** - 文档纠错、翻译、示例补充

---

## 📧 联系方式

| 渠道 | 信息 |
|-----|------|
| **GitHub Issues** | [提交问题](https://github.com/openclaw/workspace/issues) |
| **OpenClaw Workspace** | `/root/.openclaw/workspace` |
| **Email** | tommyyang@tencent |

---

## 📄 许可协议

本技能采用 **Apache License 2.0** 许可协议。

**Copyright 2026 tommyyang@tencent**

**您可以：**
- ✅ 商业使用
- ✅ 修改和分发
- ✅ 专利使用
- ✅ 私人使用

**条件：**
- 保留版权和许可声明
- 标注修改
- 包含许可文本

详见 [LICENSE.txt](LICENSE.txt)

---

## 🌟 致谢用户

感谢所有使用本技能的 HR 朋友们！

您的反馈和建议是技能持续改进的动力。

---

**最后更新**：2026-03-12  
**维护状态**：✅ 活跃维护中
