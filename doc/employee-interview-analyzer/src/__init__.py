"""
employee-interview-analyzer - 员工访谈分析技能

支持两种分析模式：
- individual: 个体访谈分析
- organization: 组织诊断分析

元信息:
- 版本：v1.0.0
- 生产者：tommyyang@tencent
- 创建日期：2026-03-13
- 许可证：Apache-2.0
"""

from .interview_analyzer import (
    InterviewAnalyzer,
    EmployeeData,
    AnalysisResult,
    IndividualResult,
    OrganizationResult
)

__version__ = "1.0.0"
__version_info__ = (1, 0, 0)
__author__ = "tommyyang@tencent"
__producer__ = "tommyyang@tencent"
__build_date__ = "2026-03-13"
__license__ = "Apache-2.0"

__all__ = [
    "InterviewAnalyzer",
    "EmployeeData",
    "AnalysisResult",
    "IndividualResult",
    "OrganizationResult"
]
