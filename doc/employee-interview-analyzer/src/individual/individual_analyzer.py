#!/usr/bin/env python3
"""
个体访谈分析器

对单个员工的访谈内容进行深度分析，输出：
- 假设验证结果
- 矛盾信号检测
- 新增洞察提取
- 个人画像更新建议
- 个人行动建议
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass
import re
from collections import defaultdict


@dataclass
class Hypothesis:
    """假设数据结构"""
    hypothesis: str
    status: str  # "confirmed" / "refuted" / "inconclusive"
    evidence: List[str]
    confidence: str  # "high" / "medium" / "low"


@dataclass
class Contradiction:
    """矛盾信号结构"""
    profile_tag: str
    interview_signal: str
    severity: str  # "high" / "medium" / "low"
    possible_explanation: str
    evidence: str


@dataclass
class Insight:
    """洞察结构"""
    title: str
    description: str
    evidence: List[str]
    root_cause: Optional[str]
    recommendation: Optional[str]
    is_new: bool  # 是否是新洞察（画像中不存在）


class IndividualAnalyzer:
    """个体访谈分析器"""
    
    # HR 分析维度
    HR_DIMENSIONS = {
        "work_motivation": ["动机", "动力", "热情", "成就感", "意义", "喜欢", "愿意"],
        "engagement": ["投入", "加班", "主动", "承担", "专注", "倦怠", "疲惫"],
        "capability": ["能力", "技能", "学习", "成长", "瓶颈", "提升"],
        "management": ["管理", "带团队", "辅导", "授权", "决策"],
        "collaboration": ["协作", "跨部门", "沟通", "配合", "推不动"],
        "culture_fit": ["文化", "价值观", "氛围", "认同", "归属"],
        "incentive": ["绩效", "激励", "回报", "公平", "晋升", "薪酬"],
        "retention": ["离职", "跳槽", "走", "留下", "机会", "猎头"]
    }
    
    # 情绪信号
    EMOTION_SIGNALS = {
        "positive": ["开心", "满意", "认可", "欣赏", "喜欢", "成就感", "自豪"],
        "negative": ["沮丧", "失望", "焦虑", "不满", "抱怨", "无奈", "疲惫", "倦怠"]
    }
    
    def analyze(self, employee: Any) -> Dict[str, Any]:
        """
        执行个体分析
        
        Args:
            employee: EmployeeData 对象
            
        Returns:
            Dict: 分析结果
        """
        profile = employee.profile
        transcript = employee.transcript
        
        # Step 1: 基于画像生成假设
        hypotheses = self._generate_hypotheses(profile)
        
        # Step 2: 验证假设
        validated_hypotheses = self._validate_hypotheses(hypotheses, transcript)
        
        # Step 3: 检测矛盾信号
        contradictions = self._detect_contradictions(profile, transcript)
        
        # Step 4: 提取新洞察
        insights = self._extract_insights(profile, transcript)
        
        # Step 5: 识别风险
        risks = self._identify_risks(transcript)
        
        # Step 6: 生成画像更新建议
        profile_updates = self._generate_profile_updates(
            profile, insights, risks
        )
        
        # Step 7: 生成行动建议
        recommendations = self._generate_recommendations(
            profile, insights, risks
        )
        
        return {
            "hypotheses": [self._hypothesis_to_dict(h) for h in validated_hypotheses],
            "contradictions": [self._contradiction_to_dict(c) for c in contradictions],
            "insights": [self._insight_to_dict(i) for i in insights],
            "risks": risks,
            "profile_updates": profile_updates,
            "recommendations": recommendations
        }
    
    def _generate_hypotheses(
        self,
        profile: Dict[str, Any]
    ) -> List[Hypothesis]:
        """
        基于员工画像生成分析假设
        
        假设来源：
        - 绩效等级（高绩效可能遇到瓶颈）
        -  tenure（新员工融入问题，老员工倦怠问题）
        - 是否管理者（新管理者适应问题）
        - 现有标签
        """
        hypotheses = []
        
        # 绩效相关假设
        performance = profile.get("performance", "")
        if performance == "O":
            hypotheses.append(Hypothesis(
                hypothesis="高绩效员工可能遇到成长瓶颈或缺乏挑战",
                status="inconclusive",
                evidence=[],
                confidence="medium"
            ))
            hypotheses.append(Hypothesis(
                hypothesis="高绩效员工可能对晋升/激励有更高期待",
                status="inconclusive",
                evidence=[],
                confidence="medium"
            ))
        elif performance == "U":
            hypotheses.append(Hypothesis(
                hypothesis="低绩效员工可能存在能力 gap 或动机问题",
                status="inconclusive",
                evidence=[],
                confidence="medium"
            ))
        
        # tenure 相关假设
        tenure = profile.get("tenure_months", 0)
        if tenure < 6:
            hypotheses.append(Hypothesis(
                hypothesis="新员工可能存在融入障碍或期望落差",
                status="inconclusive",
                evidence=[],
                confidence="high"
            ))
        elif tenure > 24:
            hypotheses.append(Hypothesis(
                hypothesis="老员工可能存在倦怠或成长停滞",
                status="inconclusive",
                evidence=[],
                confidence="medium"
            ))
        
        # 管理者相关假设
        if profile.get("is_manager", False):
            hypotheses.append(Hypothesis(
                hypothesis="管理者可能面临团队管理或跨部门协作挑战",
                status="inconclusive",
                evidence=[],
                confidence="medium"
            ))
        
        # 标签相关假设
        tags = profile.get("tags", [])
        if "高潜" in tags:
            hypotheses.append(Hypothesis(
                hypothesis="高潜员工可能对发展机会有更高需求",
                status="inconclusive",
                evidence=[],
                confidence="medium"
            ))
        
        return hypotheses
    
    def _validate_hypotheses(
        self,
        hypotheses: List[Hypothesis],
        transcript: str
    ) -> List[Hypothesis]:
        """验证假设"""
        validated = []
        
        for hyp in hypotheses:
            # 在访谈文本中查找支持/反对证据
            supporting_evidence = self._find_supporting_evidence(
                hyp.hypothesis, transcript
            )
            refuting_evidence = self._find_refuting_evidence(
                hyp.hypothesis, transcript
            )
            
            hyp.evidence = supporting_evidence + refuting_evidence
            
            # 判断验证状态
            if len(supporting_evidence) >= 2:
                hyp.status = "confirmed"
                hyp.confidence = "high" if len(supporting_evidence) >= 3 else "medium"
            elif len(refuting_evidence) >= 2:
                hyp.status = "refuted"
                hyp.confidence = "high" if len(refuting_evidence) >= 3 else "medium"
            else:
                hyp.status = "inconclusive"
            
            validated.append(hyp)
        
        return validated
    
    def _find_supporting_evidence(
        self,
        hypothesis: str,
        transcript: str
    ) -> List[str]:
        """查找支持假设的证据"""
        evidence = []
        
        # 提取假设中的关键词
        keywords = self._extract_keywords(hypothesis)
        
        # 在文本中查找包含关键词的句子
        sentences = transcript.split('。')
        for sentence in sentences:
            if any(kw in sentence for kw in keywords):
                evidence.append(sentence.strip() + '。')
        
        return evidence[:5]  # 最多 5 条证据
    
    def _find_refuting_evidence(
        self,
        hypothesis: str,
        transcript: str
    ) -> List[str]:
        """查找反对假设的证据"""
        # 简化实现：查找反向表达
        refuting_keywords = ["不", "没有", "没问题", "很好", "满意"]
        
        keywords = self._extract_keywords(hypothesis)
        evidence = []
        
        sentences = transcript.split('。')
        for sentence in sentences:
            if any(kw in sentence for kw in keywords):
                if any(neg in sentence for neg in refuting_keywords):
                    evidence.append(sentence.strip() + '。')
        
        return evidence[:3]
    
    def _extract_keywords(self, text: str) -> List[str]:
        """提取关键词"""
        # 简化实现：按常见分隔符拆分
        separators = ['可能', '存在', '遇到', '面临', '的']
        words = text
        for sep in separators:
            words = words.replace(sep, ' ')
        
        # 提取 2-4 字的词
        words = words.split()
        keywords = [w for w in words if 2 <= len(w) <= 4]
        
        return keywords[:10]
    
    def _detect_contradictions(
        self,
        profile: Dict[str, Any],
        transcript: str
    ) -> List[Contradiction]:
        """检测矛盾信号"""
        contradictions = []
        
        tags = profile.get("tags", [])
        
        # 检查每个标签是否有矛盾信号
        for tag in tags:
            contradiction = self._check_tag_contradiction(tag, transcript)
            if contradiction:
                contradictions.append(contradiction)
        
        return contradictions
    
    def _check_tag_contradiction(
        self,
        tag: str,
        transcript: str
    ) -> Optional[Contradiction]:
        """检查单个标签的矛盾信号"""
        # 定义标签的矛盾信号映射
        contradiction_map = {
            "高潜": ["瓶颈", "学不到", "停滞", "重复", "没挑战"],
            "高投入": ["倦怠", "疲惫", "撑不住", "想休息", "burnout"],
            "沟通好": ["沟通.*难", "推不动", "不理解", "冲突"],
            "项目驱动": ["没意思", "无聊", "应付", "不想做"]
        }
        
        if tag not in contradiction_map:
            return None
        
        # 查找矛盾信号
        for signal_pattern in contradiction_map[tag]:
            matches = re.findall(signal_pattern, transcript, re.IGNORECASE)
            if matches:
                # 找到矛盾证据
                evidence = self._find_evidence_context(signal_pattern, transcript)
                return Contradiction(
                    profile_tag=tag,
                    interview_signal=signal_pattern,
                    severity="high" if len(matches) >= 3 else "medium",
                    possible_explanation=self._generate_explanation(tag, signal_pattern),
                    evidence=evidence
                )
        
        return None
    
    def _find_evidence_context(
        self,
        pattern: str,
        transcript: str
    ) -> str:
        """查找证据上下文"""
        match = re.search(pattern, transcript, re.IGNORECASE)
        if match:
            start = max(0, match.start() - 30)
            end = min(len(transcript), match.end() + 30)
            return transcript[start:end].strip()
        return ""
    
    def _generate_explanation(
        self,
        tag: str,
        signal: str
    ) -> str:
        """生成矛盾的可能解释"""
        explanations = {
            ("高潜", "瓶颈"): "可能当前岗位已无法满足成长需求",
            ("高投入", "倦怠"): "可能长期高负荷工作导致 burnout",
            ("沟通好", "推不动"): "可能是跨部门影响力不足，而非沟通能力问题",
        }
        return explanations.get((tag, signal), "需要进一步访谈确认")
    
    def _extract_insights(
        self,
        profile: Dict[str, Any],
        transcript: str
    ) -> List[Insight]:
        """提取新洞察"""
        insights = []
        
        # 按 HR 维度编码
        dimension_codes = self._encode_by_dimensions(transcript)
        
        # 识别高频主题
        for dimension, codes in dimension_codes.items():
            if len(codes) >= 2:  # 至少 2 次提及
                insight = self._generate_insight(dimension, codes, profile)
                if insight:
                    insights.append(insight)
        
        # 根因分析（5 Why）
        for insight in insights:
            insight.root_cause = self._five_whys(insight.description, transcript)
        
        return insights
    
    def _encode_by_dimensions(
        self,
        transcript: str
    ) -> Dict[str, List[str]]:
        """按 HR 维度编码"""
        codes = defaultdict(list)
        
        for dimension, keywords in self.HR_DIMENSIONS.items():
            for keyword in keywords:
                if keyword in transcript:
                    # 提取上下文
                    context = self._find_evidence_context(keyword, transcript)
                    if context:
                        codes[dimension].append(context)
        
        return codes
    
    def _generate_insight(
        self,
        dimension: str,
        codes: List[str],
        profile: Dict[str, Any]
    ) -> Optional[Insight]:
        """生成洞察"""
        dimension_names = {
            "work_motivation": "工作动机",
            "engagement": "敬业度",
            "capability": "能力发展",
            "management": "管理能力",
            "collaboration": "协作效率",
            "culture_fit": "文化认同",
            "incentive": "激励机制",
            "retention": "留存风险"
        }
        
        # 判断是否是新增洞察（基于现有标签）
        tags = profile.get("tags", [])
        is_new = dimension not in tags
        
        return Insight(
            title=dimension_names.get(dimension, dimension),
            description=f"在{dimension_names.get(dimension, dimension)}维度发现模式",
            evidence=codes[:3],
            root_cause=None,  # 后续填充
            recommendation=self._generate_recommendation(dimension),
            is_new=is_new
        )
    
    def _five_whys(
        self,
        problem: str,
        transcript: str
    ) -> str:
        """5 Why 根因分析（简化版）"""
        # 简化实现：基于关键词推断
        if "跨部门" in problem or "推不动" in problem:
            return "可能根因：缺乏跨部门 SLA 机制 + 个人影响力网络未建立"
        elif "绩效" in problem or "公平" in problem:
            return "可能根因：绩效评估标准模糊 + 缺乏校准机制"
        elif "瓶颈" in problem or "学不到" in problem:
            return "可能根因：岗位挑战性不足 + 缺乏系统培养计划"
        else:
            return "需要进一步分析确认根因"
    
    def _generate_recommendation(
        self,
        dimension: str
    ) -> str:
        """生成建议"""
        recommendations = {
            "work_motivation": "建议：重塑工作意义，增加客户反馈曝光",
            "engagement": "建议：评估工作负荷，考虑弹性工作制",
            "capability": "建议：提供挑战性项目或轮岗机会",
            "management": "建议：参加新经理 90 天培养计划",
            "collaboration": "建议：建立跨部门 SLA，指定接口人",
            "culture_fit": "建议：加强文化沟通，组织团建活动",
            "incentive": "建议：澄清绩效标准，提供校准机制",
            "retention": "建议：HRBP 介入保留面谈"
        }
        return recommendations.get(dimension, "建议：进一步访谈确认")
    
    def _identify_risks(
        self,
        transcript: str
    ) -> List[Dict[str, Any]]:
        """识别风险"""
        risks = []
        
        # 离职风险
        retention_signals = ["离职", "跳槽", "看机会", "走", "猎头", "面试"]
        retention_count = sum(1 for sig in retention_signals if sig in transcript)
        
        if retention_count >= 2:
            risks.append({
                "type": "retention_risk",
                "level": "high" if retention_count >= 4 else "medium",
                "description": f"检测到{retention_count}条离职风险信号",
                "evidence": [self._find_evidence_context(sig, transcript) 
                           for sig in retention_signals if sig in transcript][:3]
            })
        
        # 倦怠风险
        burnout_signals = ["倦怠", "疲惫", "撑不住", "burnout", "累"]
        burnout_count = sum(1 for sig in burnout_signals if sig in transcript)
        
        if burnout_count >= 2:
            risks.append({
                "type": "burnout_risk",
                "level": "high" if burnout_count >= 4 else "medium",
                "description": f"检测到{burnout_count}条倦怠信号",
                "evidence": [self._find_evidence_context(sig, transcript) 
                           for sig in burnout_signals if sig in transcript][:3]
            })
        
        return risks
    
    def _generate_profile_updates(
        self,
        profile: Dict[str, Any],
        insights: List[Insight],
        risks: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """生成画像更新建议"""
        current_tags = set(profile.get("tags", []))
        new_tags = set()
        
        # 从新洞察中添加标签
        for insight in insights:
            if insight.is_new:
                tag = self._insight_to_tag(insight.title)
                if tag:
                    new_tags.add(tag)
        
        # 从风险中添加标签
        for risk in risks:
            if risk["type"] == "retention_risk":
                new_tags.add("离职风险")
            elif risk["type"] == "burnout_risk":
                new_tags.add("burnout 预警")
        
        # 计算风险等级
        risk_level = "low"
        if any(r["level"] == "high" for r in risks):
            risk_level = "high"
        elif risks:
            risk_level = "medium"
        
        return {
            "add_tags": list(new_tags - current_tags),
            "remove_tags": [],  # 不自动删除标签
            "risk_level": risk_level,
            "follow_up": {
                "needed": risk_level in ["high", "medium"],
                "type": "HRBP 介入" if risk_level == "high" else "关注",
                "timeline": "1 周内" if risk_level == "high" else "2 周内"
            }
        }
    
    def _insight_to_tag(self, insight_title: str) -> Optional[str]:
        """将洞察转换为标签"""
        mapping = {
            "工作动机": "动机不足",
            "敬业度": "敬业度预警",
            "能力发展": "成长需求",
            "管理能力": "管理待提升",
            "协作效率": "跨部门协作挑战",
            "文化认同": "文化认同待加强",
            "激励机制": "激励诉求",
            "留存风险": "离职风险"
        }
        return mapping.get(insight_title)
    
    def _generate_recommendations(
        self,
        profile: Dict[str, Any],
        insights: List[Insight],
        risks: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """生成行动建议"""
        recommendations = []
        
        # 基于风险的建议
        for risk in risks:
            if risk["type"] == "retention_risk":
                recommendations.append({
                    "priority": "critical",
                    "category": "retention",
                    "action": "HRBP 保留面谈",
                    "description": "针对离职风险进行一对一保留面谈",
                    "timeline": "1 周内",
                    "owner": "HRBP + 直接管理者"
                })
            elif risk["type"] == "burnout_risk":
                recommendations.append({
                    "priority": "high",
                    "category": "wellbeing",
                    "action": "工作负荷评估",
                    "description": "评估并优化工作负荷分配",
                    "timeline": "2 周内",
                    "owner": "直接管理者"
                })
        
        # 基于洞察的建议
        for insight in insights[:3]:  # 最多 3 条
            recommendations.append({
                "priority": "medium",
                "category": "development",
                "action": insight.recommendation.split("：")[-1] if "：" in insight.recommendation else insight.recommendation,
                "description": insight.description,
                "timeline": "1 个月内",
                "owner": "直接管理者 + HRBP"
            })
        
        # 按优先级排序
        priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        recommendations.sort(key=lambda x: priority_order.get(x["priority"], 3))
        
        return recommendations
    
    # 辅助方法：转换为字典
    def _hypothesis_to_dict(self, h: Hypothesis) -> Dict[str, Any]:
        return {
            "hypothesis": h.hypothesis,
            "status": h.status,
            "evidence": h.evidence,
            "confidence": h.confidence
        }
    
    def _contradiction_to_dict(self, c: Contradiction) -> Dict[str, Any]:
        return {
            "profile_tag": c.profile_tag,
            "interview_signal": c.interview_signal,
            "severity": c.severity,
            "possible_explanation": c.possible_explanation,
            "evidence": c.evidence
        }
    
    def _insight_to_dict(self, i: Insight) -> Dict[str, Any]:
        return {
            "title": i.title,
            "description": i.description,
            "evidence": i.evidence,
            "root_cause": i.root_cause,
            "recommendation": i.recommendation,
            "is_new": i.is_new
        }
