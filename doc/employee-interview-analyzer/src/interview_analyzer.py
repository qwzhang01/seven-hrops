#!/usr/bin/env python3
"""
员工访谈分析器 - 统一入口

支持两种分析模式：
- individual: 个体访谈分析
- organization: 组织诊断分析
"""

import json
import yaml
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass
from pathlib import Path

from .individual.individual_analyzer import IndividualAnalyzer
from .organization.org_analyzer import OrganizationAnalyzer
from .report_generator import ReportGenerator


@dataclass
class EmployeeData:
    """员工数据结构"""
    profile: Dict[str, Any]
    interview: Dict[str, Any]
    transcript: str


@dataclass
class AnalysisResult:
    """分析结果基类"""
    analysis_mode: str  # "individual" or "organization"


@dataclass
class IndividualResult(AnalysisResult):
    """个体分析结果"""
    employee_name: str
    hypotheses: List[Dict[str, Any]]
    contradictions: List[Dict[str, Any]]
    insights: List[Dict[str, Any]]
    risks: List[Dict[str, Any]]
    profile_updates: Dict[str, Any]
    recommendations: List[Dict[str, Any]]
    conclusion_article: Optional[str] = None  # ⭐⭐ Step 11: 结论文章（v2.5.0 新增）
    tencent_doc_url: Optional[str] = None     # ⭐⭐⭐ Step 13: 腾讯文档链接（v2.5.0 新增）


@dataclass
class OrganizationResult(AnalysisResult):
    """组织分析结果"""
    organization: str
    diagnosis_period: str
    strategic_goal: str
    sample_size: int
    dimension_scores: Dict[str, Dict[str, Any]]
    overall_score: float
    weakest_link: str
    strategy_alignment: Dict[str, float]
    patterns: Dict[str, List[Dict[str, Any]]]
    interventions: List[Dict[str, Any]]
    individual_results: List[IndividualResult]  # 包含个体分析结果
    conclusion_article: Optional[str] = None  # ⭐⭐ Step 11: 结论文章（v2.5.0 新增）
    tencent_doc_url: Optional[str] = None     # ⭐⭐⭐ Step 13: 腾讯文档链接（v2.5.0 新增）


class InterviewAnalyzer:
    """员工访谈分析器"""
    
    def __init__(
        self,
        pattern_threshold: float = 0.7,
        segment_analysis: bool = True,
        contradiction_detection: bool = True
    ):
        """
        初始化分析器
        
        Args:
            pattern_threshold: 组织分析的模式识别阈值
            segment_analysis: 是否启用群体差异分析
            contradiction_detection: 是否启用矛盾信号检测
        """
        self.pattern_threshold = pattern_threshold
        self.segment_analysis = segment_analysis
        self.contradiction_detection = contradiction_detection
        
        # 初始化分析器
        self.individual_analyzer = IndividualAnalyzer()
        self.org_analyzer = OrganizationAnalyzer(
            pattern_threshold=pattern_threshold,
            segment_analysis=segment_analysis,
            contradiction_detection=contradiction_detection
        )
        self.report_generator = ReportGenerator()
    
    def load_input(self, input_path: str) -> Dict[str, Any]:
        """加载输入数据"""
        path = Path(input_path)
        
        with open(path, 'r', encoding='utf-8') as f:
            if path.suffix == '.json':
                return json.load(f)
            elif path.suffix in ['.yaml', '.yml']:
                return yaml.safe_load(f)
            else:
                raise ValueError(f"Unsupported file format: {path.suffix}")
    
    def analyze(
        self,
        input_data: Dict[str, Any]
    ) -> Union[IndividualResult, OrganizationResult]:
        """
        执行分析（自动识别模式）
        
        Args:
            input_data: 输入数据
            
        Returns:
            分析结果
        """
        analysis_mode = input_data.get("analysis_mode", "individual")
        
        if analysis_mode == "individual":
            return self.analyze_individual(input_data)
        elif analysis_mode == "organization":
            return self.analyze_organization(input_data)
        else:
            raise ValueError(f"Unknown analysis mode: {analysis_mode}")
    
    def analyze_individual(
        self,
        input_data: Dict[str, Any]
    ) -> IndividualResult:
        """
        个体访谈分析
        
        Args:
            input_data: 个体分析输入数据
            
        Returns:
            IndividualResult: 个体分析结果
        """
        employee_data = input_data.get("employee", {})
        
        # 创建 EmployeeData 对象
        emp = EmployeeData(
            profile=employee_data.get("profile", {}),
            interview=employee_data.get("interview", {}),
            transcript=employee_data.get("transcript", "")
        )
        
        # 执行个体分析
        result = self.individual_analyzer.analyze(emp)
        
        return IndividualResult(
            analysis_mode="individual",
            employee_name=emp.profile.get("name", "未知"),
            hypotheses=result.get("hypotheses", []),
            contradictions=result.get("contradictions", []),
            insights=result.get("insights", []),
            risks=result.get("risks", []),
            profile_updates=result.get("profile_updates", {}),
            recommendations=result.get("recommendations", []),
            conclusion_article=result.get("conclusion_article", None),  # ⭐⭐ Step 11
        )
    
    def analyze_organization(
        self,
        input_data: Dict[str, Any]
    ) -> OrganizationResult:
        """
        组织诊断分析
        
        Args:
            input_data: 组织分析输入数据
            
        Returns:
            OrganizationResult: 组织分析结果
        """
        employees_data = input_data.get("employees", [])
        strategic_goal = input_data.get("strategic_goal", "")
        
        # 创建 EmployeeData 对象列表
        employees = [
            EmployeeData(
                profile=emp.get("profile", {}),
                interview=emp.get("interview", {}),
                transcript=emp.get("transcript", "")
            )
            for emp in employees_data
        ]
        
        # Step 1: 先对每个员工进行个体分析
        individual_results = []
        for emp in employees:
            ind_result = self.individual_analyzer.analyze(emp)
            individual_results.append(IndividualResult(
                analysis_mode="individual",
                employee_name=emp.profile.get("name", "未知"),
                hypotheses=ind_result.get("hypotheses", []),
                contradictions=ind_result.get("contradictions", []),
                insights=ind_result.get("insights", []),
                risks=ind_result.get("risks", []),
                profile_updates=ind_result.get("profile_updates", {}),
                recommendations=ind_result.get("recommendations", []),
                conclusion_article=ind_result.get("conclusion_article", None),  # ⭐⭐ Step 11
            ))
        
        # Step 2: 进行组织分析
        org_result = self.org_analyzer.analyze(
            employees=employees,
            strategic_goal=strategic_goal
        )
        
        return OrganizationResult(
            analysis_mode="organization",
            organization=input_data.get("organization", ""),
            diagnosis_period=input_data.get("diagnosis_period", ""),
            strategic_goal=strategic_goal,
            sample_size=len(employees),
            dimension_scores=org_result.get("dimension_scores", {}),
            overall_score=org_result.get("overall_score", 0.0),
            weakest_link=org_result.get("weakest_link", ""),
            strategy_alignment=org_result.get("strategy_alignment", {}),
            patterns=org_result.get("patterns", {}),
            interventions=org_result.get("interventions", []),
            individual_results=individual_results
        )
    
    def generate_report(
        self,
        result: Union[IndividualResult, OrganizationResult],
        format: str = "markdown",
        output_path: Optional[str] = None,
        create_tencent_doc: bool = True
    ) -> str:
        """
        生成报告
        
        Args:
            result: 分析结果
            format: 输出格式
            output_path: 输出路径
            create_tencent_doc: 是否创建腾讯文档（⭐⭐⭐ Step 13，默认开启）
            
        Returns:
            str: 报告内容
        """
        report = self.report_generator.generate(result, format)
        
        if output_path:
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(report)
        
        # ⭐⭐⭐ Step 13: 腾讯文档生成（强制步骤）
        # 注意：实际调用 tencent-docs skill 在 SKILL.md 的指令层执行
        # 此处记录状态，供报告渲染时使用
        if create_tencent_doc:
            doc_title = self._get_doc_title(result)
            print(f"\n📄 [Step 13] 腾讯文档生成待执行：")
            print(f"   标题：{doc_title}")
            print(f"   请使用 tencent-docs skill 创建文档。")
            print(f"   示例调用：tencent-docs create --title \"{doc_title}\" --content <report>")
        
        return report
    
    def _get_doc_title(self, result: Union[IndividualResult, OrganizationResult]) -> str:
        """生成腾讯文档标题"""
        from datetime import datetime
        date_str = datetime.now().strftime('%Y%m%d')
        if result.analysis_mode == "individual":
            return f"访谈洞察报告-{result.employee_name}-{date_str}"
        else:
            return f"组织诊断报告-{result.organization}-{date_str}"


def main():
    """CLI 入口"""
    import argparse
    
    parser = argparse.ArgumentParser(description="员工访谈分析器")
    parser.add_argument("--input", required=True, help="输入文件路径")
    parser.add_argument("--output", required=True, help="输出文件路径")
    parser.add_argument("--mode", choices=["individual", "organization"],
                        help="分析模式（可选，自动检测）")
    parser.add_argument("--pattern-threshold", type=float, default=0.7,
                        help="模式识别阈值")
    
    args = parser.parse_args()
    
    # 初始化分析器
    analyzer = InterviewAnalyzer(
        pattern_threshold=args.pattern_threshold
    )
    
    # 加载输入
    input_data = analyzer.load_input(args.input)
    
    # 执行分析
    result = analyzer.analyze(input_data)
    
    # 生成报告
    report = analyzer.generate_report(result, output_path=args.output)
    print(f"报告已生成：{args.output}")
    print(f"分析模式：{result.analysis_mode}")
    
    if result.analysis_mode == "individual":
        print(f"员工姓名：{result.employee_name}")
    else:
        print(f"组织名称：{result.organization}")
        print(f"样本数量：{result.sample_size}")
        print(f"综合得分：{result.overall_score}/10")


if __name__ == "__main__":
    main()
