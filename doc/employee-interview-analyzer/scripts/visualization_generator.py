#!/usr/bin/env python3
"""
数据可视化生成脚本
根据访谈分析结果生成 Chart.js 可视化图表
"""

import json
import os
from typing import Dict, List, Optional


class VisualizationGenerator:
    """可视化图表生成器"""
    
    def __init__(self, output_dir: str = "."):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
    
    def generate_radar_chart(self, 
                            title: str,
                            labels: List[str],
                            datasets: List[Dict[str, any]],
                            output_file: str) -> str:
        """
        生成雷达图
        
        Args:
            title: 图表标题
            labels: 维度标签列表
            datasets: 数据集列表,每个数据集包含 label 和 data
            output_file: 输出文件路径
        
        Returns:
            生成的 HTML 文件路径
        """
        html_content = self._get_radar_chart_template(title, labels, datasets)
        file_path = os.path.join(self.output_dir, output_file)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        return file_path
    
    def generate_bar_chart(self,
                          title: str,
                          labels: List[str],
                          datasets: List[Dict[str, any]],
                          output_file: str) -> str:
        """
        生成柱状图
        
        Args:
            title: 图表标题
            labels: 维度标签列表
            datasets: 数据集列表
            output_file: 输出文件路径
        
        Returns:
            生成的 HTML 文件路径
        """
        html_content = self._get_bar_chart_template(title, labels, datasets)
        file_path = os.path.join(self.output_dir, output_file)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        return file_path
    
    def generate_line_chart(self,
                          title: str,
                          labels: List[str],
                          datasets: List[Dict[str, any]],
                          output_file: str) -> str:
        """
        生成折线图
        
        Args:
            title: 图表标题
            labels: 时间轴标签列表
            datasets: 数据集列表
            output_file: 输出文件路径
        
        Returns:
            生成的 HTML 文件路径
        """
        html_content = self._get_line_chart_template(title, labels, datasets)
        file_path = os.path.join(self.output_dir, output_file)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        return file_path
    
    def _get_radar_chart_template(self, title: str, labels: List[str], datasets: List[Dict]) -> str:
        """获取雷达图 HTML 模板"""
        datasets_json = json.dumps(datasets, ensure_ascii=False)
        labels_json = json.dumps(labels, ensure_ascii=False)
        
        return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }}
        .chart-container {{
            max-width: 800px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        h1 {{
            text-align: center;
            color: #333;
            margin-bottom: 30px;
        }}
        canvas {{
            max-height: 600px;
        }}
    </style>
</head>
<body>
    <div class="chart-container">
        <h1>{title}</h1>
        <canvas id="radarChart"></canvas>
    </div>
    <script>
        const ctx = document.getElementById('radarChart').getContext('2d');
        const chart = new Chart(ctx, {{
            type: 'radar',
            data: {{
                labels: {labels_json},
                datasets: {datasets_json}
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: true,
                scales: {{
                    r: {{
                        beginAtZero: true,
                        max: 5,
                        ticks: {{
                            stepSize: 1
                        }},
                        pointLabels: {{
                            font: {{
                                size: 14
                            }}
                        }}
                    }}
                }},
                plugins: {{
                    legend: {{
                        position: 'top',
                        labels: {{
                            font: {{
                                size: 14
                            }}
                        }}
                    }},
                    tooltip: {{
                        callbacks: {{
                            label: function(context) {{
                                return context.dataset.label + ': ' + context.parsed.r + ' / 5';
                            }}
                        }}
                    }}
                }}
            }}
        }});
    </script>
</body>
</html>"""
    
    def _get_bar_chart_template(self, title: str, labels: List[str], datasets: List[Dict]) -> str:
        """获取柱状图 HTML 模板"""
        datasets_json = json.dumps(datasets, ensure_ascii=False)
        labels_json = json.dumps(labels, ensure_ascii=False)
        
        return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }}
        .chart-container {{
            max-width: 800px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        h1 {{
            text-align: center;
            color: #333;
            margin-bottom: 30px;
        }}
        canvas {{
            max-height: 500px;
        }}
    </style>
</head>
<body>
    <div class="chart-container">
        <h1>{title}</h1>
        <canvas id="barChart"></canvas>
    </div>
    <script>
        const ctx = document.getElementById('barChart').getContext('2d');
        const chart = new Chart(ctx, {{
            type: 'bar',
            data: {{
                labels: {labels_json},
                datasets: {datasets_json}
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: true,
                scales: {{
                    y: {{
                        beginAtZero: true,
                        max: 5,
                        ticks: {{
                            stepSize: 1
                        }}
                    }}
                }},
                plugins: {{
                    legend: {{
                        position: 'top',
                        labels: {{
                            font: {{
                                size: 14
                            }}
                        }}
                    }}
                }}
            }}
        }});
    </script>
</body>
</html>"""
    
    def _get_line_chart_template(self, title: str, labels: List[str], datasets: List[Dict]) -> str:
        """获取折线图 HTML 模板"""
        datasets_json = json.dumps(datasets, ensure_ascii=False)
        labels_json = json.dumps(labels, ensure_ascii=False)
        
        return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }}
        .chart-container {{
            max-width: 800px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        h1 {{
            text-align: center;
            color: #333;
            margin-bottom: 30px;
        }}
        canvas {{
            max-height: 500px;
        }}
    </style>
</head>
<body>
    <div class="chart-container">
        <h1>{title}</h1>
        <canvas id="lineChart"></canvas>
    </div>
    <script>
        const ctx = document.getElementById('lineChart').getContext('2d');
        const chart = new Chart(ctx, {{
            type: 'line',
            data: {{
                labels: {labels_json},
                datasets: {datasets_json}
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: true,
                scales: {{
                    y: {{
                        beginAtZero: true,
                        max: 5,
                        ticks: {{
                            stepSize: 1
                        }}
                    }}
                }},
                plugins: {{
                    legend: {{
                        position: 'top',
                        labels: {{
                            font: {{
                                size: 14
                            }}
                        }}
                    }}
                }}
            }}
        }});
    </script>
</body>
</html>"""


def generate_visualizations(analysis_result: Dict, output_dir: str = ".") -> List[str]:
    """
    根据分析结果自动生成可视化图表
    
    Args:
        analysis_result: 访谈分析结果字典
        output_dir: 输出目录
    
    Returns:
        生成的 HTML 文件路径列表
    """
    generator = VisualizationGenerator(output_dir)
    generated_files = []
    
    # 判断是否需要生成雷达图(多维度评估)
    scores = analysis_result.get("scores", {})
    if len(scores) >= 3:
        labels = list(scores.keys())
        current_data = list(scores.values())
        
        # 雷达图数据集
        datasets = [
            {
                "label": "当前状态",
                "data": current_data,
                "backgroundColor": "rgba(102, 126, 234, 0.2)",
                "borderColor": "rgba(102, 126, 234, 1)",
                "borderWidth": 2,
                "pointBackgroundColor": "rgba(102, 126, 234, 1)"
            }
        ]
        
        # 如果有理想状态对比,添加第二个数据集
        ideal_scores = analysis_result.get("ideal_scores")
        if ideal_scores:
            datasets.append({
                "label": "理想状态",
                "data": list(ideal_scores.values()),
                "borderColor": "rgba(255, 99, 132, 1)",
                "borderWidth": 2,
                "borderDash": [5, 5],
                "pointBackgroundColor": "rgba(255, 99, 132, 1)"
            })
        
        # 生成雷达图
        radar_file = generator.generate_radar_chart(
            title=analysis_result.get("chart_title", "多维度能力评估"),
            labels=labels,
            datasets=datasets,
            output_file=f"{analysis_result.get('interviewee', '能力评估')}-雷达图.html"
        )
        generated_files.append(radar_file)
    
    # 判断是否需要生成柱状图(对比分析)
    comparison_data = analysis_result.get("comparison_data")
    if comparison_data:
        labels = list(comparison_data.keys())
        datasets = [
            {
                "label": "评分",
                "data": list(comparison_data.values()),
                "backgroundColor": [
                    "rgba(75, 192, 192, 0.6)",
                    "rgba(75, 192, 192, 0.6)",
                    "rgba(75, 192, 192, 0.6)",
                    "rgba(255, 99, 132, 0.6)",
                    "rgba(255, 99, 132, 0.6)",
                ]
            }
        ]
        
        bar_file = generator.generate_bar_chart(
            title=analysis_result.get("comparison_title", "对比分析"),
            labels=labels,
            datasets=datasets,
            output_file=f"{analysis_result.get('interviewee', '对比分析')}-柱状图.html"
        )
        generated_files.append(bar_file)
    
    # 判断是否需要生成折线图(趋势分析)
    trend_data = analysis_result.get("trend_data")
    if trend_data:
        labels = list(trend_data.keys())
        datasets = [
            {
                "label": "趋势",
                "data": list(trend_data.values()),
                "borderColor": "rgba(102, 126, 234, 1)",
                "backgroundColor": "rgba(102, 126, 234, 0.2)",
                "tension": 0.3,
                "fill": True
            }
        ]
        
        line_file = generator.generate_line_chart(
            title=analysis_result.get("trend_title", "趋势分析"),
            labels=labels,
            datasets=datasets,
            output_file=f"{analysis_result.get('interviewee', '趋势分析')}-折线图.html"
        )
        generated_files.append(line_file)
    
    return generated_files


if __name__ == "__main__":
    # 测试示例
    test_result = {
        "interviewee": "翁行",
        "chart_title": "翁行-AI素养评估",
        "scores": {
            "AI工具素养": 5.0,
            "人机协作": 4.0,
            "岗位演进认知": 5.0,
            "组织AI成熟度": 2.0
        },
        "ideal_scores": {
            "AI工具素养": 5.0,
            "人机协作": 5.0,
            "岗位演进认知": 5.0,
            "组织AI成熟度": 5.0
        }
    }
    
    files = generate_visualizations(test_result, output_dir=".")
    print(f"生成的文件: {files}")
