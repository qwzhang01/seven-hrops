#!/usr/bin/env python3
"""
组织诊断分析器

基于杨三角理论对多个员工访谈进行聚合分析
直接内嵌简化的杨三角分析逻辑，避免依赖问题
"""

import re
from typing import Dict, List, Any
from collections import defaultdict


class OrganizationAnalyzer:
    """组织分析器（内嵌杨三角分析逻辑）"""
    
    # 杨三角三个维度及其子维度
    DIMENSIONS = {
        "employee_mindset": {
            "name": "员工思维",
            "subtitle": "愿不愿意",
            "sub_dimensions": {
                "work_motivation": ["动机", "热情", "成就感", "意义", "喜欢", "愿意", "主动"],
                "engagement": ["投入", "加班", "专注", "倦怠", "疲惫", "应付"],
                "culture_fit": ["文化", "价值观", "认同", "氛围"],
                "belonging": ["归属", "融入", "接纳", "自己人", "局外人"],
                "retention_risk": ["离职", "跳槽", "走", "机会", "猎头", "动摇"]
            }
        },
        "employee_competence": {
            "name": "员工能力",
            "subtitle": "能不能",
            "sub_dimensions": {
                "professional_skills": ["专业", "技能", "技术", "熟练", "精通"],
                "core_competencies": ["核心", "竞争力", "优势"],
                "learning_agility": ["学习", "成长", "提升", "瓶颈", "停滞"],
                "management_capability": ["管理", "带团队", "辅导", "授权"],
                "talent_density": ["人才", "高手", "大牛", "密度", "强"]
            }
        },
        "employee_governance": {
            "name": "员工治理",
            "subtitle": "允不允许",
            "sub_dimensions": {
                "org_structure": ["架构", "职责", "汇报", "分工", "边界"],
                "process_mechanism": ["流程", "审批", "协作", "推不动", "效率", "SLA"],
                "information_system": ["系统", "工具", "信息", "数据"],
                "incentive_system": ["激励", "绩效", "回报", "公平", "晋升", "薪酬"],
                "decision_efficiency": ["决策", "拍板", "审批", "慢", "层层"]
            }
        }
    }
    
    def __init__(
        self,
        pattern_threshold: float = 0.7,
        segment_analysis: bool = True,
        contradiction_detection: bool = True
    ):
        self.pattern_threshold = pattern_threshold
        self.segment_analysis = segment_analysis
        self.contradiction_detection = contradiction_detection
    
    def analyze(
        self,
        employees: list,
        strategic_goal: str
    ) -> dict:
        """
        执行组织分析
        
        Args:
            employees: EmployeeData 对象列表
            strategic_goal: 战略目标
            
        Returns:
            dict: 组织分析结果
        """
        # Step 1: 对每个维度进行编码分析
        dimension_results = {}
        
        for dim_key, dim_config in self.DIMENSIONS.items():
            dim_result = self._analyze_dimension(employees, dim_key, dim_config)
            dimension_results[dim_key] = dim_result
        
        # Step 2: 计算综合得分
        overall_score = self._calculate_overall_score(dimension_results)
        
        # Step 3: 识别最短木板
        weakest_link = self._identify_weakest_link(dimension_results)
        
        # Step 4: 战略对齐度分析
        strategy_alignment = self._analyze_strategy_alignment(
            dimension_results, strategic_goal
        )
        
        # Step 5: 识别跨个体模式
        patterns = self._detect_patterns(employees, dimension_results)
        
        # Step 6: 生成干预建议
        interventions = self._generate_interventions(
            dimension_results, weakest_link, patterns
        )
        
        return {
            "dimension_scores": dimension_results,
            "overall_score": overall_score,
            "weakest_link": weakest_link,
            "strategy_alignment": strategy_alignment,
            "patterns": patterns,
            "interventions": interventions
        }
    
    def _analyze_dimension(
        self,
        employees: list,
        dim_key: str,
        dim_config: dict
    ) -> dict:
        """分析单个维度"""
        sub_scores = {}
        all_evidence = []
        
        for subdim_name, keywords in dim_config["sub_dimensions"].items():
            codes = []
            for emp in employees:
                transcript = emp.transcript if hasattr(emp, 'transcript') else emp.get('transcript', '')
                emp_profile = emp.profile if hasattr(emp, 'profile') else emp.get('profile', {})
                
                # 查找关键词匹配
                for keyword in keywords:
                    if keyword in transcript:
                        # 提取上下文
                        start = max(0, transcript.find(keyword) - 30)
                        end = min(len(transcript), transcript.find(keyword) + 50)
                        context = transcript[start:end].strip()
                        
                        # 判断情感倾向
                        is_negative = self._is_negative_context(transcript, keyword)
                        codes.append({
                            "keyword": keyword,
                            "evidence": context,
                            "sentiment": "negative" if is_negative else "positive",
                            "employee": emp_profile.get("name", "未知")
                        })
                        all_evidence.append(context)
            
            # 计算子维度得分
            if codes:
                negative_count = sum(1 for c in codes if c["sentiment"] == "negative")
                positive_ratio = (len(codes) - negative_count) / len(codes)
                score = round(positive_ratio * 10, 1)
            else:
                score = 5.0
            
            sub_scores[subdim_name] = score
        
        # 计算维度总分
        overall_score = round(sum(sub_scores.values()) / len(sub_scores), 1) if sub_scores else 5.0
        
        return {
            "score": overall_score,
            "sub_scores": sub_scores,
            "evidence": all_evidence[:10],  # 限制证据数量
            "patterns": [],
            "risks": []
        }
    
    def _is_negative_context(
        self,
        transcript: str,
        keyword: str
    ) -> bool:
        """判断关键词上下文是否为负向"""
        negative_words = ["不", "难", "差", "低", "慢", "少", "弱", "混乱", "问题", "风险", "担忧", "不满"]
        
        # 查找关键词位置
        pos = transcript.find(keyword)
        if pos == -1:
            return False
        
        # 检查前后 50 字是否有负向词
        start = max(0, pos - 50)
        end = min(len(transcript), pos + len(keyword) + 50)
        context = transcript[start:end]
        
        return any(neg in context for neg in negative_words)
    
    def _calculate_overall_score(
        self,
        dimension_results: dict
    ) -> float:
        """计算综合得分"""
        scores = [d["score"] for d in dimension_results.values()]
        return round(sum(scores) / len(scores), 1) if scores else 5.0
    
    def _identify_weakest_link(
        self,
        dimension_results: dict
    ) -> str:
        """识别最短木板"""
        min_score = float('inf')
        weakest = ""
        
        for dim_key, result in dimension_results.items():
            score = result.get("score", 5.0)
            if score < min_score:
                min_score = score
                weakest = dim_key
        
        return weakest
    
    def _analyze_strategy_alignment(
        self,
        dimension_results: dict,
        strategic_goal: str
    ) -> dict:
        """分析战略对齐度"""
        if not strategic_goal:
            return {
                "employee_mindset": 50.0,
                "employee_competence": 50.0,
                "employee_governance": 50.0
            }
        
        # 简化实现：基于维度得分计算对齐度
        alignment = {}
        for dim_key, result in dimension_results.items():
            score = result.get("score", 5.0)
            alignment[dim_key] = round(score / 10 * 100, 1)
        
        return alignment
    
    def _detect_patterns(
        self,
        employees: list,
        dimension_results: dict
    ) -> dict:
        """检测跨个体模式"""
        patterns = {
            "consensus_issues": [],
            "segment_issues": [],
            "contradictions": []
        }
        
        total_employees = len(employees)
        
        # 检查每个维度的共识性问题
        for dim_key, result in dimension_results.items():
            evidence = result.get("evidence", [])
            if len(evidence) >= total_employees * 0.7:  # ≥70% 提及
                patterns["consensus_issues"].append({
                    "dimension": dim_key,
                    "type": "systemic_issue",
                    "mention_rate": f"{len(evidence)}/{total_employees}",
                    "severity": "high",
                    "evidence": evidence[:3]
                })
        
        return patterns
    
    def _generate_interventions(
        self,
        dimension_results: dict,
        weakest_link: str,
        patterns: dict
    ) -> list:
        """生成干预建议"""
        interventions = []
        
        # 基于最短木板生成建议
        if weakest_link == "employee_governance":
            interventions.extend([
                {
                    "priority": "critical",
                    "name": "跨部门 SLA 机制",
                    "description": "建立跨部门协作时效标准",
                    "actions": [
                        "识别关键协作流程",
                        "定义 SLA 时效标准",
                        "建立升级机制"
                    ],
                    "owner": "COO + 各部门负责人",
                    "timeline": "4 周内"
                },
                {
                    "priority": "critical",
                    "name": "绩效评估校准机制",
                    "description": "提升绩效评估公平性",
                    "actions": [
                        "引入量化评估模板",
                        "建立跨团队校准会",
                        "管理者评估培训"
                    ],
                    "owner": "HRD + 各 L2 管理者",
                    "timeline": "下个绩效周期前"
                }
            ])
        
        if weakest_link == "employee_mindset":
            interventions.append({
                "priority": "high",
                "name": "员工敬业度提升计划",
                "description": "提升员工工作动机和归属感",
                "actions": [
                    "工作意义重塑",
                    "弹性工作制试点",
                    "新员工 onboarding 优化"
                ],
                "owner": "HRD + 各部门",
                "timeline": "2 个月内"
            })
        
        if weakest_link == "employee_competence":
            interventions.append({
                "priority": "high",
                "name": "能力提升计划",
                "description": "系统性提升员工能力",
                "actions": [
                    "技能差距分析",
                    "内外部培训课程",
                    "新经理 90 天培养计划"
                ],
                "owner": "培训团队 + HRBP",
                "timeline": "3 个月内"
            })
        
        return interventions
