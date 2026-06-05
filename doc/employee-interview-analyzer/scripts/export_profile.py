#!/usr/bin/env python3
"""
画像导出脚本（v2.6.0 增强版）
支持管理干部画像和普通员工画像两种类型的导出

v2.6.0 变更：
- 新增管理干部画像导出支持（基础画像 + 多场景管理表现）
- 原有员工画像导出逻辑保持不变
- 自动根据 profile_type 字段判断导出类型
"""

import json
import os
from typing import Dict, List, Optional


class ProfileExporter:
    """画像导出器（支持管理干部/普通员工双轨）"""
    
    def __init__(self, output_dir: str = "."):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
    
    def export_to_markdown(self, 
                          profile_data: Dict, 
                          interviewee_name: str) -> str:
        """
        将画像导出为 Markdown 文件
        自动判断画像类型（管理干部/普通员工）并调用对应生成逻辑
        
        Args:
            profile_data: 画像数据（含 profile_type 字段）
            interviewee_name: 被访谈者姓名
        
        Returns:
            导出的文件路径
        """
        profile_type = profile_data.get("profile_type", "employee_profile")
        
        if profile_type == "manager_profile":
            md_content = self._generate_manager_profile(profile_data, interviewee_name)
            filename = f"{interviewee_name}-管理干部画像.md"
        else:
            md_content = self._generate_markdown_content(profile_data, interviewee_name)
            filename = f"{interviewee_name}-员工画像.md"
        
        filepath = os.path.join(self.output_dir, filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(md_content)
        
        return filepath
    
    def _generate_manager_profile(self, profile_data: Dict, name: str) -> str:
        """生成管理干部画像 Markdown 内容"""
        
        basic_info = profile_data.get("basic_info", {})
        
        content = f"""# {name} - 管理干部画像

> 本画像基于访谈内容生成，用于管理干部档案补充

---

## 📋 基础信息

| 维度 | 内容 |
|------|------|
| **姓名** | {name} |
| **职位** | {basic_info.get("position", "未知")} |
| **职级** | {basic_info.get("level", "未知")} |
| **司龄** | {basic_info.get("tenure", "未知")} |
| **部门** | {basic_info.get("department", "未知")} |
| **团队规模** | {basic_info.get("team_size", "未知")} |

---

## 第一部分：基础画像

| 维度 | 评估 |
|------|------|
"""
        
        # 基础画像维度
        base_profile = profile_data.get("base_profile", {})
        dimensions = [
            ("工作投入度", "work_engagement"),
            ("异动风险", "transfer_risk"),
            ("战场", "battlefield"),
            ("战场匹配度", "battlefield_match"),
            ("战场当前风险与挑战", "battlefield_risks"),
            ("个人优劣势", "strengths_weaknesses"),
            ("个人发展诉求", "development_needs"),
        ]
        
        for dim_name, dim_key in dimensions:
            value = base_profile.get(dim_key, "未评估")
            content += f"| **{dim_name}** | {value} |\n"
        
        content += """
---

## 第二部分：多场景管理表现画像

"""
        
        # 多场景管理表现
        scenes = profile_data.get("management_scenes", [])
        
        if not scenes:
            content += "> 访谈内容中未提取到充足的管理场景信息\n"
        else:
            for scene in scenes:
                scene_name = scene.get("scene_name", "未知场景")
                sentiment = scene.get("sentiment_label", "🟡 中立")
                title = scene.get("title", "")
                
                content += f"### 📌 {scene_name} {sentiment}\n\n"
                content += f"**{title}**\n\n"
                
                star = scene.get("star", {})
                content += f"**情境(S)：** {star.get('situation', '')}\n\n"
                content += f"**任务(T)：** {star.get('task', '')}\n\n"
                content += f"**行动(A)：** {star.get('action', '')}\n\n"
                content += f"**结果(R)：** {star.get('result', '')}\n\n"
                
                quote = scene.get("key_quote", "")
                if quote:
                    content += f"> 💬 关键原文引用：「{quote}」\n\n"
                
                content += "---\n\n"
        
        # 补充说明
        content += f"""
## 📝 补充说明

- 本画像基于访谈内容生成，反映了管理者在特定时间点的管理状态和能力表现
- 基础画像中的评估基于访谈事实，建议结合360评估、绩效数据等进行综合判断
- 多场景管理表现仅涵盖访谈中有事实依据的场景，非全面评估
- 画像数据可用于管理者发展计划制定、岗位匹配评估、继任者规划等场景

---

*生成时间: {profile_data.get('generated_at', '')}*
*数据来源: 访谈分析*
*画像类型: 管理干部画像 (v2.6.0)*
"""
        
        return content
    
    def _generate_markdown_content(self, profile_data: Dict, name: str) -> str:
        """生成 Markdown 内容"""
        
        # 基础信息
        basic_info = profile_data.get("basic_info", {})
        
        content = f"""# {name} - 员工画像补充材料

> 本画像基于访谈内容生成,用于补充员工档案

---

## 📋 基础信息

| 维度 | 内容 |
|------|------|
| **姓名** | {name} |
| **职位** | {basic_info.get("position", "未知")} |
| **职级** | {basic_info.get("level", "未知")} |
| **司龄** | {basic_info.get("tenure", "未知")} |
| **部门** | {basic_info.get("department", "未知")} |

---

## 💪 能力特征画像

### 专业能力
"""
        
        # 专业能力
        professional = profile_data.get("professional_skills", [])
        for skill in professional:
            content += f"\n- **{skill.get('name', '')}**: {skill.get('score', '')} - 证据: \"{skill.get('evidence', '')}\"\n"
        
        content += "\n### 软技能\n"
        soft_skills = profile_data.get("soft_skills", [])
        for skill in soft_skills:
            content += f"- **{skill.get('name', '')}**: {skill.get('description', '')} - 表现: \"{skill.get('evidence', '')}\"\n"
        
        # 职业锚与价值观
        content += "\n### 职业锚与价值观\n"
        content += f"- **职业锚类型**: {profile_data.get('career_anchor', '未识别')}\n"
        
        values = profile_data.get("core_values", [])
        if values:
            content += f"- **核心价值观**: {', '.join(values)}\n"
        
        content += f"- **工作动机**: {profile_data.get('work_motivation', '未明确')}\n"
        
        # AI 素养
        content += "\n### AI 素养\n"
        ai_skills = profile_data.get("ai_skills", {})
        content += f"- **AI工具使用**: {ai_skills.get('usage_level', '未评估')} - {ai_skills.get('tools', '')}\n"
        content += f"- **人机协作**: {ai_skills.get('collaboration_level', '未评估')}\n"
        content += f"- **AI时代适应性**: {ai_skills.get('adaptability', '未评估')}\n"
        
        # 性格与行为模式
        content += "\n## 🎭 性格与行为模式\n"
        personality = profile_data.get("personality", {})
        content += f"- **性格特点**: {personality.get('traits', '')} - 行为证据: \"{personality.get('evidence', '')}\"\n"
        content += f"- **沟通风格**: {personality.get('communication_style', '')} - 典型表达: \"{personality.get('example', '')}\"\n"
        content += f"- **决策方式**: {personality.get('decision_style', '')} - 示例: \"{personality.get('example', '')}\"\n"
        content += f"- **压力反应**: {personality.get('stress_response', '')} - 情境: \"{personality.get('example', '')}\"\n"
        
        # 战场画像
        battlefield = profile_data.get("battlefield", {})
        if battlefield:
            content += "\n## ⚔️ 战场画像\n"
            
            current_work = battlefield.get("current_work", {})
            if current_work:
                content += "\n### 当前\"战场\"描述\n"
                content += "**核心工作内容:**\n"
                for work in current_work.get("areas", []):
                    content += f"- {work.get('name', '')}: {work.get('description', '')}\n"
                
                challenges = current_work.get("challenges", [])
                if challenges:
                    content += "\n**关键挑战:**\n"
                    for challenge in challenges:
                        content += f"- {challenge.get('name', '')}: {challenge.get('description', '')}\n"
                
                content += f"\n**工作环境:** {current_work.get('environment', '')}\n"
                content += f"\n**战场特征:**\n"
                features = current_work.get("features", {})
                content += f"- 复杂度: {features.get('complexity', '')}\n"
                content += f"- 不确定性: {features.get('uncertainty', '')}\n"
                content += f"- 压力水平: {features.get('pressure', '')}\n"
                content += f"- 技术前沿性: {features.get('tech_frontier', '')}\n"
            
            performance = battlefield.get("performance", {})
            if performance:
                content += "\n### 当前\"战场\"表现(自我感知)\n"
                
                achievements = performance.get("achievements", [])
                if achievements:
                    content += "**工作成果:**\n"
                    for achievement in achievements:
                        content += f"- {achievement.get('name', '')}: {achievement.get('description', '')} - 证据: \"{achievement.get('evidence', '')}\"\n"
                
                content += f"\n**自我评估:**\n"
                content += f"- 工作满意度: {performance.get('satisfaction', '')}\n"
                content += f"- 能力发挥度: {performance.get('ability_utilization', '')}\n"
                content += f"- 成就感来源: {performance.get('achievement_source', '')}\n"
                
                difficulties = performance.get("difficulties", [])
                if difficulties:
                    content += "\n**遇到的困难:**\n"
                    for difficulty in difficulties:
                        content += f"- {difficulty.get('name', '')}: {difficulty.get('description', '')} - 应对方式: \"{difficulty.get('response', '')}\"\n"
                
                advantages = performance.get("advantages", [])
                if advantages:
                    content += "\n**优势领域:**\n"
                    for advantage in advantages:
                        content += f"- {advantage.get('name', '')}: {advantage.get('description', '')} - 表现: \"{advantage.get('evidence', '')}\"\n"
            
            plans = battlefield.get("plans", {})
            if plans:
                content += "\n### 后续工作计划\n"
                
                short_term = plans.get("short_term", [])
                if short_term:
                    content += "**短期计划(1-3个月):**\n"
                    for plan in short_term:
                        content += f"- {plan.get('name', '')}: {plan.get('action', '')}\n"
                
                medium_term = plans.get("medium_term", [])
                if medium_term:
                    content += "\n**中期计划(3-6个月):**\n"
                    for plan in medium_term:
                        content += f"- {plan.get('name', '')}: {plan.get('goal', '')}\n"
                
                long_term = plans.get("long_term", [])
                if long_term:
                    content += "\n**长期展望(6个月以上):**\n"
                    for plan in long_term:
                        content += f"- {plan.get('name', '')}: {plan.get('direction', '')}\n"
                
                improvements = plans.get("improvements", [])
                if improvements:
                    content += "\n**能力提升需求:**\n"
                    for improvement in improvements:
                        content += f"- {improvement.get('name', '')}: {improvement.get('plan', '')}\n"
                
                support = plans.get("support", [])
                if support:
                    content += "\n**支持需求:**\n"
                    for item in support:
                        content += f"- {item.get('name', '')}: {item.get('content', '')}\n"
        
        # 个人优劣势（v2.6.0 新增）
        strengths_weaknesses = profile_data.get("strengths_weaknesses", {})
        if strengths_weaknesses:
            content += "\n## 💪 个人优劣势\n"
            
            strengths = strengths_weaknesses.get("strengths", [])
            if strengths:
                content += "\n### 个人优势\n"
                for item in strengths:
                    content += f"- **{item.get('name', '')}**: {item.get('description', '')} — 证据: \"{item.get('evidence', '')}\"\n"
            
            weaknesses = strengths_weaknesses.get("weaknesses", [])
            if weaknesses:
                content += "\n### 个人劣势/待提升项\n"
                for item in weaknesses:
                    content += f"- **{item.get('name', '')}**: {item.get('description', '')} — 证据: \"{item.get('evidence', '')}\"\n"
        
        # 个人发展诉求（v2.6.0 新增）
        dev_aspirations = profile_data.get("development_aspirations", {})
        if dev_aspirations:
            content += "\n## 🎯 个人发展诉求\n"
            content += f"- **职业发展方向**: {dev_aspirations.get('career_direction', '未明确')} — 证据: \"{dev_aspirations.get('career_direction_evidence', '')}\"\n"
            content += f"- **短期诉求（1年内）**: {dev_aspirations.get('short_term', '未明确')} — 证据: \"{dev_aspirations.get('short_term_evidence', '')}\"\n"
            content += f"- **中长期诉求（1-3年）**: {dev_aspirations.get('long_term', '未明确')} — 证据: \"{dev_aspirations.get('long_term_evidence', '')}\"\n"
            content += f"- **晋升意愿**: {dev_aspirations.get('promotion_desire', '未明确')}\n"
            content += f"- **转岗/活水意向**: {dev_aspirations.get('transfer_intention', '无意向')}\n"
            content += f"- **能力提升期望**: {dev_aspirations.get('skill_improvement', '未明确')}\n"
            
            support = dev_aspirations.get('expected_support', '')
            if support:
                content += f"- **期望获得的支持**: {support}\n"
        
        # 发展潜力与风险
        content += "\n## 🚀 发展潜力与风险\n"
        
        potential = profile_data.get("potential", {})
        if potential:
            advantages = potential.get("advantages", [])
            if advantages:
                content += "### 发展潜力\n"
                for advantage in advantages:
                    content += f"- **{advantage.get('name', '')}**: {advantage.get('description', '')} - 发展建议: \"{advantage.get('suggestion', '')}\"\n"
            
            growth = potential.get("growth", [])
            if growth:
                content += "\n**成长空间:**\n"
                for item in growth:
                    content += f"- {item.get('name', '')}: {item.get('description', '')} - 提升路径: \"{item.get('path', '')}\"\n"
        
        risks = profile_data.get("risks", [])
        if risks:
            content += "\n### 潜在风险\n"
            for risk in risks:
                content += f"- **{risk.get('name', '')}**: {risk.get('description', '')} - 信号: \"{risk.get('signal', '')}\"\n"
        
        # 补充说明
        content += f"""
---

## 📝 补充说明

- 本画像基于访谈内容生成,反映了被访谈者在特定时间点的工作状态和认知
- 建议结合其他评估工具和绩效数据进行综合判断
- 画像数据可用于员工发展计划制定、岗位匹配评估等场景

---

*生成时间: {profile_data.get('generated_at', '')}*
*数据来源: 访谈分析*
"""
        
        return content


def export_profile(profile_data: Dict, name: str, output_dir: str = ".") -> str:
    """
    导出画像（自动判断管理干部/普通员工类型）
    
    Args:
        profile_data: 画像数据（含 profile_type 字段）
        name: 被访谈者姓名
        output_dir: 输出目录
    
    Returns:
        导出文件的路径
    """
    exporter = ProfileExporter(output_dir)
    return exporter.export_to_markdown(profile_data, name)


if __name__ == "__main__":
    # ============ 测试1: 普通员工画像 ============
    test_employee_profile = {
        "profile_type": "employee_profile",
        "basic_info": {
            "position": "前端开发工程师",
            "level": "T8",
            "tenure": "2年3个月",
            "department": "QQ业务线"
        },
        "professional_skills": [
            {"name": "前端开发", "score": "⭐⭐⭐⭐⭐", "evidence": "使用CodeBuddy完成平台demo"},
            {"name": "AI工具使用", "score": "⭐⭐⭐⭐⭐", "evidence": "日均高频使用CodeBuddy"}
        ],
        "soft_skills": [
            {"name": "创新意识", "description": "强", "evidence": "主动探索新工具"}
        ],
        "career_anchor": "技术/职能型",
        "core_values": ["技术创新", "效率提升"],
        "work_motivation": "通过技术解决实际问题",
        "ai_skills": {
            "usage_level": "广泛",
            "tools": "CodeBuddy、内部AI平台",
            "collaboration_level": "成熟",
            "adaptability": "强"
        },
        "personality": {
            "traits": "积极主动、创新性强",
            "evidence": "30分钟完成1周工作",
            "communication_style": "直接高效",
            "example": "表达清晰明确",
            "decision_style": "数据驱动",
            "stress_response": "抗压能力强"
        },
        "battlefield": {
            "current_work": {
                "areas": [
                    {"name": "AI平台开发", "description": "负责AI相关功能开发"}
                ],
                "challenges": [
                    {"name": "资源限制", "description": "外部模型调用受限"}
                ],
                "environment": "技术创新团队",
                "features": {
                    "complexity": "高",
                    "uncertainty": "中",
                    "pressure": "中",
                    "tech_frontier": "高"
                }
            }
        },
        "potential": {
            "advantages": [
                {"name": "AI工具掌握", "description": "熟练掌握AI工具", "suggestion": "可担任AI导师"}
            ]
        },
        "strengths_weaknesses": {
            "strengths": [
                {"name": "AI工具掌握", "description": "熟练掌握多种AI工具，能快速应用到实际工作", "evidence": "日均高频使用CodeBuddy，30分钟完成1周工作"},
                {"name": "技术学习能力", "description": "对新技术敏感度高，学习速度快", "evidence": "快速上手多个AI平台并完成demo开发"}
            ],
            "weaknesses": [
                {"name": "知识共享", "description": "个人AI使用经验难以系统化传递给团队", "evidence": "提到'个人的memory和上下文很难跟别人同步'"}
            ]
        },
        "development_aspirations": {
            "career_direction": "技术专家",
            "career_direction_evidence": "表达了对前端+AI方向的深入兴趣",
            "short_term": "深化AI开发能力，参与更多AI产品项目",
            "short_term_evidence": "提到'想把AI融入到更多日常开发中'",
            "long_term": "成为前端AI领域的技术专家",
            "long_term_evidence": "[推断] 基于其持续的AI工具探索和技术热情",
            "promotion_desire": "一般",
            "transfer_intention": "无意向",
            "skill_improvement": "大模型应用、AI Agent开发",
            "expected_support": "希望有更多AI相关项目的参与机会"
        },
        "risks": [
            {"name": "团队协作", "description": "个人memory难以共享", "signal": "多AI上下文不同步"}
        ],
        "generated_at": "2026-03-24"
    }
    
    filepath = export_profile(test_employee_profile, "翁行", output_dir=".")
    print(f"普通员工画像导出: {filepath}")
    
    # ============ 测试2: 管理干部画像 ============
    test_manager_profile = {
        "profile_type": "manager_profile",
        "basic_info": {
            "position": "技术总监",
            "level": "T12",
            "tenure": "6年8个月",
            "department": "XX产品部",
            "team_size": "约20人"
        },
        "base_profile": {
            "work_engagement": "🟢 高 — 每周工作时间超过60小时，主动关注团队每个人的状态",
            "transfer_risk": "🟡 中 — 对薪酬有一定不满，但对团队有责任感",
            "battlefield": "负责XX产品线的全栈技术团队，覆盖前后端、算法和测试",
            "battlefield_match": "🟢 高 — 技术背景深厚，团队信任度高",
            "battlefield_risks": "业务增长放缓；核心成员面临被活水风险；AI转型压力",
            "strengths_weaknesses": "优势：技术判断力强、团队凝聚力好 / 劣势：向上管理较弱、跨部门影响力不足",
            "development_needs": "希望承担更大业务范围，期望在技术管理通道上进一步晋升"
        },
        "management_scenes": [
            {
                "scene_name": "业务管理场景",
                "sentiment_label": "🟢 正向",
                "title": "面对业务增长放缓时的战略调整",
                "star": {
                    "situation": "2025年Q3，XX产品线日活从800万下滑至650万，公司推动AI转型。",
                    "task": "需要稳住存量用户，同时找到AI驱动的新增长曲线。",
                    "action": "组织团队进行用户行为数据分析，将团队分为\"守城\"和\"攻城\"两组，亲自带攻城组做了3轮MVP验证。",
                    "result": "Q4日活止跌回升至720万，AI推荐模块A/B测试显示用户停留时长提升12%。"
                },
                "key_quote": "当时业务数据下滑挺厉害的，我知道不能等，就把团队拆成两拨人..."
            },
            {
                "scene_name": "团队管理场景",
                "sentiment_label": "🟡 中立",
                "title": "核心成员离职后的团队重建",
                "star": {
                    "situation": "2025年初，2名核心高级工程师通过活水转岗离开，技术能力出现断层。",
                    "task": "短期内补充核心技术力量，重建团队信心。",
                    "action": "逐一沟通了解担忧，紧急启动社招，推行技术传帮带机制。但培养节奏过快给部分同事太大压力。",
                    "result": "3个月补充1名T9，培养2名T8成长。但仍有1名T8表达活水意向。"
                },
                "key_quote": "那两个人走了之后我确实有点着急，想快速把人补上来..."
            }
        ],
        "generated_at": "2026-03-25"
    }
    
    filepath = export_profile(test_manager_profile, "张明", output_dir=".")
    print(f"管理干部画像导出: {filepath}")
