#!/usr/bin/env python3
"""
报告生成器

支持个体报告和组织报告两种格式
"""

from typing import Union, Any
from datetime import datetime


class ReportGenerator:
    """报告生成器"""
    
    def generate(
        self,
        result: Any,
        format: str = "markdown"
    ) -> str:
        """
        生成报告
        
        Args:
            result: 分析结果（IndividualResult 或 OrganizationResult）
            format: 输出格式
            
        Returns:
            str: 报告内容
        """
        if result.analysis_mode == "individual":
            return self._generate_individual_report(result)
        else:
            return self._generate_organization_report(result)
    
    def _generate_individual_report(self, result: Any) -> str:
        """生成个体访谈报告"""
        lines = []
        
        # 标题
        lines.append(f"# 访谈洞察报告 - {result.employee_name}")
        lines.append(f"**访谈日期：** {datetime.now().strftime('%Y-%m-%d')}")
        lines.append("")
        lines.append("---")
        lines.append("")
        
        # 假设验证结果
        lines.append("## 📊 假设验证结果")
        lines.append("")
        if result.hypotheses:
            lines.append("| 假设 | 验证状态 | 置信度 |")
            lines.append("|------|----------|--------|")
            for hyp in result.hypotheses:
                status_icon = "✅" if hyp["status"] == "confirmed" else "❌" if hyp["status"] == "refuted" else "⏳"
                lines.append(f"| {hyp['hypothesis']} | {status_icon} {hyp['status']} | {hyp['confidence']} |")
            lines.append("")
            
            # 展开证据
            lines.append("### 关键证据")
            lines.append("")
            for hyp in result.hypotheses:
                if hyp["evidence"]:
                    lines.append(f"**{hyp['hypothesis']}**:")
                    for ev in hyp["evidence"][:2]:
                        lines.append(f"> {ev}")
                    lines.append("")
        else:
            lines.append("暂无假设验证结果")
            lines.append("")
        
        lines.append("---")
        lines.append("")
        
        # 矛盾信号检测
        lines.append("## ⚠️ 矛盾信号检测")
        lines.append("")
        if result.contradictions:
            lines.append("| 画像标签 | 访谈信号 | 矛盾程度 | 可能解释 |")
            lines.append("|----------|----------|----------|----------|")
            for con in result.contradictions:
                severity_icon = "🔴" if con["severity"] == "high" else "🟡"
                lines.append(f"| {con['profile_tag']} | {con['interview_signal']} | {severity_icon} {con['severity']} | {con['possible_explanation']} |")
            lines.append("")
        else:
            lines.append("✅ 未检测到明显矛盾信号")
            lines.append("")
        
        lines.append("---")
        lines.append("")
        
        # 新增洞察
        lines.append("## 🆕 新增洞察")
        lines.append("")
        if result.insights:
            for i, insight in enumerate(result.insights, 1):
                new_tag = "🆕" if insight["is_new"] else ""
                lines.append(f"### {i}. {insight['title']} {new_tag}")
                lines.append(f"{insight['description']}")
                lines.append("")
                if insight["evidence"]:
                    lines.append("**证据**:")
                    for ev in insight["evidence"]:
                        lines.append(f"> {ev}")
                    lines.append("")
                if insight["root_cause"]:
                    lines.append(f"**根因分析**: {insight['root_cause']}")
                    lines.append("")
                if insight["recommendation"]:
                    lines.append(f"**建议**: {insight['recommendation']}")
                    lines.append("")
        else:
            lines.append("暂无新增洞察")
            lines.append("")
        
        lines.append("---")
        lines.append("")
        
        # 风险信号
        lines.append("## 🚨 风险信号")
        lines.append("")
        if result.risks:
            for risk in result.risks:
                level_icon = "🔴" if risk["level"] == "high" else "🟡"
                lines.append(f"- {level_icon} **{risk['type']}**: {risk['description']}")
                if risk.get("evidence"):
                    for ev in risk["evidence"]:
                        lines.append(f"  > {ev}")
        else:
            lines.append("✅ 未检测到明显风险信号")
        lines.append("")
        
        lines.append("---")
        lines.append("")
        
        # 画像更新建议
        lines.append("## 🏷️ 画像更新建议")
        lines.append("")
        profile_updates = result.profile_updates
        if profile_updates.get("add_tags"):
            lines.append(f"**新增标签**: {', '.join(profile_updates['add_tags'])}")
        if profile_updates.get("remove_tags"):
            lines.append(f"**移除标签**: {', '.join(profile_updates['remove_tags'])}")
        lines.append(f"**风险等级**: {profile_updates.get('risk_level', 'low')}")
        lines.append("")
        
        if profile_updates.get("follow_up", {}).get("needed"):
            follow_up = profile_updates["follow_up"]
            lines.append(f"**跟进建议**: {follow_up.get('type')}（{follow_up.get('timeline')}）")
        lines.append("")
        
        lines.append("---")
        lines.append("")
        
        # ⭐⭐ Step 11: 结论文章（强制生成，不可跳过）
        lines.append("## 📝 访谈结论文章")
        lines.append("")
        if hasattr(result, 'conclusion_article') and result.conclusion_article:
            lines.append(result.conclusion_article)
        else:
            lines.append("⚠️ **结论文章缺失！请检查 Step 11 是否正确执行。**")
            lines.append("")
            lines.append("> 结论文章为强制步骤，必须包含以下5部分：")
            lines.append("> 1. 访谈背景（约150字）")
            lines.append("> 2. 核心发现（约400字）")
            lines.append("> 3. 深度分析（约300字）")
            lines.append("> 4. 建议与展望（约250字）")
            lines.append("> 5. 总结（约100字）")
        lines.append("")
        
        lines.append("---")
        lines.append("")
        
        # 行动建议
        lines.append("## 📋 行动建议")
        lines.append("")
        if result.recommendations:
            for i, rec in enumerate(result.recommendations, 1):
                priority_icon = "🔴" if rec["priority"] == "critical" else "🟡" if rec["priority"] == "high" else "🟢"
                lines.append(f"### {priority_icon} {i}. {rec['action']}")
                lines.append(f"- **描述**: {rec['description']}")
                lines.append(f"- **负责人**: {rec.get('owner', 'TBD')}")
                lines.append(f"- **时间**: {rec.get('timeline', 'TBD')}")
                lines.append("")
        else:
            lines.append("暂无具体行动建议")
            lines.append("")
        
        lines.append("---")
        lines.append("")
        
        # ⭐⭐⭐ Step 13: 腾讯文档生成提示
        lines.append("## 📄 腾讯文档")
        lines.append("")
        if hasattr(result, 'tencent_doc_url') and result.tencent_doc_url:
            lines.append(f"✅ 报告已同步至腾讯文档：[点击查看]({result.tencent_doc_url})")
        else:
            lines.append("⚠️ **腾讯文档尚未生成。请确保 Step 13 正确执行。**")
            lines.append("")
            lines.append("> 使用 `tencent-docs` skill 将本报告内容创建为在线腾讯文档。")
        lines.append("")
        
        lines.append("---")
        lines.append("")
        lines.append("*本报告由 employee-interview-analyzer skill v2.5.0 自动生成*")
        lines.append("")
        lines.append(f"**技能版本：** v2.5.0  |  **生产者：** tommyyang@tencent")
        
        return "\n".join(lines)
    
    def _generate_organization_report(self, result: Any) -> str:
        """生成组织诊断报告"""
        lines = []
        
        # 标题
        lines.append(f"# 组织诊断报告 - {result.organization}")
        lines.append(f"**诊断周期：** {result.diagnosis_period}  |  **样本：** {result.sample_size}人  |  **战略：** {result.strategic_goal}")
        lines.append(f"**生成时间：** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        lines.append("")
        lines.append("---")
        lines.append("")
        
        # 杨三角健康度总览
        lines.append("## 📊 杨三角健康度总览")
        lines.append("")
        
        dim_scores = result.dimension_scores
        mindset_score = dim_scores.get("employee_mindset", {}).get("score", 5.0)
        competence_score = dim_scores.get("employee_competence", {}).get("score", 5.0)
        governance_score = dim_scores.get("employee_governance", {}).get("score", 5.0)
        
        lines.append("```")
        lines.append(f"        员工思维 (愿不愿意)")
        lines.append(f"              {mindset_score}/10 {self._get_status_emoji(mindset_score)}")
        lines.append(f"             /       \\")
        lines.append(f"            /         \\")
        lines.append(f"           /           \\")
        lines.append(f"   员工能力 (能不能) ——— 员工治理 (允不允许)")
        lines.append(f"        {competence_score}/10 {self._get_status_emoji(competence_score)}           {governance_score}/10 {self._get_status_emoji(governance_score)}")
        lines.append("```")
        lines.append("")
        
        overall_status = self._get_status_emoji(result.overall_score)
        lines.append(f"**综合得分：{result.overall_score}/10** {overall_status} {self._get_overall_comment(result.overall_score)}")
        lines.append("")
        lines.append(f"**最短木板：{self._get_dim_name(result.weakest_link)}** → 这是限制组织能力的关键瓶颈")
        lines.append("")
        lines.append("---")
        lines.append("")
        
        # 三个维度详情
        dim_info = [
            ("employee_mindset", "🧠", "员工思维", "愿不愿意"),
            ("employee_competence", "💪", "员工能力", "能不能"),
            ("employee_governance", "🏛️", "员工治理", "允不允许")
        ]
        
        for item in dim_info:
            dim_key, icon, dim_name, subtitle = item
            dim_result = dim_scores.get(dim_key, {})
            score = dim_result.get("score", 5.0)
            
            lines.append(f"## {icon} {dim_name}（{subtitle}）- {score}/10 {self._get_status_emoji(score)}")
            lines.append("")
            
            # 子维度得分
            sub_scores = dim_result.get("sub_scores", {})
            if sub_scores:
                lines.append("### 子维度得分")
                lines.append("")
                lines.append("| 子维度 | 得分 | 状态 |")
                lines.append("|--------|------|------|")
                for subdim, sub_score in sub_scores.items():
                    lines.append(f"| {subdim} | {sub_score}/10 | {self._get_status_emoji(sub_score)} |")
                lines.append("")
            
            # 风险信号
            risks = dim_result.get("risks", [])
            if risks:
                lines.append("### ⚠️ 风险信号")
                lines.append("")
                for risk in risks:
                    lines.append(f"- {risk.get('description', '未知风险')}")
                lines.append("")
            
            lines.append("---")
            lines.append("")
        
        # 战略对齐度
        lines.append("## 🎯 战略对齐度分析")
        lines.append("")
        lines.append(f"**战略目标：** {result.strategic_goal}")
        lines.append("")
        lines.append("| 维度 | 对齐度 | 状态 |")
        lines.append("|------|--------|------|")
        
        strategy_alignment = result.strategy_alignment
        for item in dim_info:
            dim_key, _, dim_name, _ = item
            alignment = strategy_alignment.get(dim_key, 50.0)
            status = "🟢" if alignment >= 80 else "🟡" if alignment >= 60 else "🔴"
            lines.append(f"| {dim_name} | {alignment}% | {status} |")
        lines.append("")
        
        # 共识性问题
        patterns = result.patterns
        consensus_issues = patterns.get("consensus_issues", [])
        if consensus_issues:
            lines.append("## 🔍 系统性问题（≥70% 员工提及）")
            lines.append("")
            for issue in consensus_issues[:3]:
                lines.append(f"### {issue.get('dimension', '未知维度')}")
                lines.append(f"- **提及率**: {issue.get('mention_rate', 'N/A')}")
                lines.append(f"- **严重程度**: {issue.get('severity', 'medium')}")
                if issue.get("evidence"):
                    lines.append("- **典型原话**:")
                    for ev in issue["evidence"][:2]:
                        lines.append(f"  > {ev[:100]}...")
                lines.append("")
        
        lines.append("---")
        lines.append("")
        
        # 干预建议
        lines.append("## 🚨 优先级干预建议")
        lines.append("")
        
        interventions = result.interventions
        critical = [i for i in interventions if i.get("priority") == "critical"]
        high = [i for i in interventions if i.get("priority") == "high"]
        
        if critical:
            lines.append("### 🔴 第一优先级（立即行动）")
            lines.append("")
            for i, intervention in enumerate(critical[:3], 1):
                lines.append(f"#### {i}. {intervention.get('name', '未知')}")
                lines.append(f"- **问题**: {intervention.get('description', '')}")
                if intervention.get("actions"):
                    lines.append(f"- **动作**:")
                    for action in intervention["actions"][:4]:
                        lines.append(f"  - {action}")
                lines.append(f"- **负责人**: {intervention.get('owner', 'TBD')}")
                lines.append(f"- **时间**: {intervention.get('timeline', 'TBD')}")
                lines.append("")
        
        if high:
            lines.append("### 🟡 第二优先级（1-3 个月内）")
            lines.append("")
            for i, intervention in enumerate(high[:3], 1):
                lines.append(f"#### {i}. {intervention.get('name', '未知')}")
                lines.append(f"- **动作**: {', '.join(intervention.get('actions', [])[:3])}")
                lines.append(f"- **负责人**: {intervention.get('owner', 'TBD')}")
                lines.append("")
        
        lines.append("---")
        lines.append("")
        
        # ⭐⭐ Step 11: 结论文章（强制生成，不可跳过）
        lines.append("## 📝 组织诊断结论文章")
        lines.append("")
        if hasattr(result, 'conclusion_article') and result.conclusion_article:
            lines.append(result.conclusion_article)
        else:
            lines.append("⚠️ **结论文章缺失！请检查 Step 11 是否正确执行。**")
            lines.append("")
            lines.append("> 组织诊断结论文章为强制步骤，必须包含以下5部分：")
            lines.append("> 1. 诊断背景（约200字）")
            lines.append("> 2. 核心发现——杨三角三维度总结（约500字）")
            lines.append("> 3. 系统性问题深度分析（约400字）")
            lines.append("> 4. 干预建议与战略对齐展望（约300字）")
            lines.append("> 5. 总结（约150字）")
        lines.append("")
        
        lines.append("---")
        lines.append("")
        
        # 附录
        lines.append("## 📎 附录")
        lines.append("")
        lines.append(f"- 访谈总人数：{result.sample_size}人")
        lines.append(f"- 分析框架：杨三角理论（员工思维 × 员工能力 × 员工治理）")
        lines.append(f"- 模式识别阈值：≥70% 员工提及 = 系统问题")
        lines.append("")
        lines.append("---")
        lines.append("")
        
        # ⭐⭐⭐ Step 13: 腾讯文档生成提示
        lines.append("## 📄 腾讯文档")
        lines.append("")
        if hasattr(result, 'tencent_doc_url') and result.tencent_doc_url:
            lines.append(f"✅ 报告已同步至腾讯文档：[点击查看]({result.tencent_doc_url})")
        else:
            lines.append("⚠️ **腾讯文档尚未生成。请确保 Step 13 正确执行。**")
            lines.append("")
            lines.append("> 使用 `tencent-docs` skill 将本报告内容创建为在线腾讯文档。")
        lines.append("")
        
        lines.append("---")
        lines.append("")
        lines.append("*本报告由 employee-interview-analyzer skill v2.5.0 自动生成*")
        lines.append("")
        lines.append(f"**技能版本：** v2.5.0  |  **生产者：** tommyyang@tencent")
        
        return "\n".join(lines)
    
    def _get_status_emoji(self, score: float) -> str:
        if score >= 8.0:
            return "🟢"
        elif score >= 6.0:
            return "🟡"
        else:
            return "🔴"
    
    def _get_overall_comment(self, score: float) -> str:
        if score >= 8.0:
            return "组织健康度优秀"
        elif score >= 7.0:
            return "组织健康度良好"
        elif score >= 6.0:
            return "需干预"
        elif score >= 5.0:
            return "需重点关注"
        else:
            return "需立即干预"
    
    def _get_dim_name(self, dim_key: str) -> str:
        names = {
            "employee_mindset": "员工思维",
            "employee_competence": "员工能力",
            "employee_governance": "员工治理"
        }
        return names.get(dim_key, dim_key)
