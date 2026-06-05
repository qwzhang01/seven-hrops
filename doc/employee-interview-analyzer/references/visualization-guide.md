# 📊 数据可视化生成指南

本文档说明如何在访谈分析报告中生成数据可视化图表。

## 📐 支持的图表类型

### 1. 雷达图 (Radar Chart)

**适用场景：**
- 杨三角理论三支柱评估（思维、能力、治理）
- 韦斯伯德六盒模型六维度评估
- 冰山模型六层评估
- 职业锚八维度分析
- 综合能力评估

**示例：杨三角三支柱雷达图**

```javascript
// 使用 Chart.js 生成雷达图
const ctx = document.getElementById('radarChart').getContext('2d');
const radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
        labels: ['员工思维', '员工能力', '员工治理'],
        datasets: [{
            label: '当前状态',
            data: [4.5, 4.8, 1.5],
            backgroundColor: 'rgba(102, 126, 234, 0.2)',
            borderColor: 'rgba(102, 126, 234, 1)',
            borderWidth: 2,
            pointBackgroundColor: 'rgba(102, 126, 234, 1)'
        }, {
            label: '理想状态',
            data: [5.0, 5.0, 5.0],
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 2,
            borderDash: [5, 5],
            pointBackgroundColor: 'rgba(255, 99, 132, 1)'
        }]
    },
    options: {
        scales: {
            r: {
                beginAtZero: true,
                max: 5,
                ticks: {
                    stepSize: 1
                }
            }
        }
    }
});
```

**HTML 模板：**
```html
<div style="width: 600px; height: 400px; margin: 20px auto;">
    <canvas id="radarChart"></canvas>
</div>
```

---

### 2. 柱状图 (Bar Chart)

**适用场景：**
- 健康度评分对比
- 推拉力强度对比
- 多选项统计
- 优先级矩阵
- 方法论维度评分

**示例：杨三角三支柱健康度评分**

```javascript
const ctx = document.getElementById('barChart').getContext('2d');
const barChart = new Chart(ctx, {
    type: 'bar',
    data: {
        labels: ['员工思维', '员工能力', '员工治理'],
        datasets: [{
            label: '健康度评分',
            data: [4.5, 4.8, 1.5],
            backgroundColor: [
                'rgba(75, 192, 192, 0.6)',  // 绿色 - 高
                'rgba(75, 192, 192, 0.6)',  // 绿色 - 高
                'rgba(255, 99, 132, 0.6)'   // 红色 - 低
            ],
            borderColor: [
                'rgba(75, 192, 192, 1)',
                'rgba(75, 192, 192, 1)',
                'rgba(255, 99, 132, 1)'
            ],
            borderWidth: 2
        }]
    },
    options: {
        scales: {
            y: {
                beginAtZero: true,
                max: 5,
                ticks: {
                    stepSize: 1
                }
            }
        },
        plugins: {
            legend: {
                display: false
            }
        }
    }
});
```

**颜色编码规则：**
- 🟢 高分（4.0-5.0）：`rgba(75, 192, 192, 0.6)`
- 🟡 中分（2.5-3.9）：`rgba(255, 206, 86, 0.6)`
- 🔴 低分（0-2.4）：`rgba(255, 99, 132, 0.6)`

---

### 3. 折线图 (Line Chart)

**适用场景：**
- 多次访谈趋势分析
- 时间序列数据
- 绩效变化趋势
- 成长轨迹展示

**示例：绩效趋势分析（6个月）**

```javascript
const ctx = document.getElementById('lineChart').getContext('2d');
const lineChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: ['1月', '2月', '3月', '4月', '5月', '6月'],
        datasets: [{
            label: '绩效评分',
            data: [3.5, 3.8, 3.2, 4.0, 4.2, 4.5],
            borderColor: 'rgba(102, 126, 234, 1)',
            backgroundColor: 'rgba(102, 126, 234, 0.1)',
            borderWidth: 3,
            tension: 0.3,  // 平滑曲线
            fill: true,
            pointRadius: 5,
            pointBackgroundColor: 'rgba(102, 126, 234, 1)',
            pointBorderColor: '#fff',
            pointBorderWidth: 2
        }]
    },
    options: {
        scales: {
            y: {
                beginAtZero: false,
                min: 2.5,
                max: 5,
                ticks: {
                    stepSize: 0.5
                }
            }
        }
    }
});
```

---

## 🎨 图表样式规范

### 配色方案

**主色调：**
- 主色：`#667eea` (紫蓝色)
- 辅色：`#764ba2` (紫色)
- 强调色：`#ffc107` (黄色)
- 危险色：`#dc3545` (红色)
- 成功色：`#28a745` (绿色)

**透明度：**
- 填充：`0.2` (20%)
- 边框：`1.0` (100%)

### 字体规范

- 标题：18px, bold
- 副标题：14px, normal
- 标签：12px, normal
- 数值：14px, bold

---

## 📋 生成流程

### 1. 分析完成后询问用户

```
📊 数据可视化选项：
"分析已完成！是否需要生成数据可视化图表？
  1️⃣ 雷达图（多维度评估，如杨三角三支柱）
  2️⃣ 柱状图（维度对比，如健康度评分）
  3️⃣ 折线图（趋势分析，如时间序列）
  4️⃣ 全部生成
  5️⃣ 暂不需要"
```

### 2. 根据分析结果提取数据

**雷达图数据提取：**
```python
# 从方法论分析结果中提取数据
def extract_radar_data(methodology_result):
    if methodology == "杨三角理论":
        labels = ["员工思维", "员工能力", "员工治理"]
        values = [
            result["mindset_score"],
            result["competence_score"],
            result["governance_score"]
        ]
        return {"labels": labels, "values": values}
```

### 3. 生成图表代码

根据选择的图表类型和数据，生成对应的 Chart.js 代码。

### 4. 嵌入到HTML报告

```html
<!DOCTYPE html>
<html>
<head>
    <title>访谈分析报告 - 可视化</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <h1>📊 数据可视化分析</h1>
    
    <!-- 雷达图 -->
    <div style="width: 600px; height: 400px; margin: 20px auto;">
        <canvas id="radarChart"></canvas>
    </div>
    
    <script>
        // 雷达图代码
        const radarData = {...};
        new Chart(document.getElementById('radarChart'), radarData);
    </script>
</body>
</html>
```

---

## 💡 使用建议

1. **雷达图**：适用于展示多个维度的综合评估，能直观看出各维度的平衡性
2. **柱状图**：适用于对比分析，能清晰看出各维度的差异和排名
3. **折线图**：适用于展示时间趋势，能看出变化方向和幅度

**最佳实践：**
- 每种图表都应配有清晰的标题和图例
- 使用一致的颜色方案，便于对比
- 添加网格线和标签，提升可读性
- 在图表下方添加简要的文字说明

---

## 🔧 技术实现

**依赖库：**
- Chart.js v3.x 或 v4.x
- 支持 ECharts 或其他图表库

**兼容性：**
- 支持导出为 HTML（包含图表交互）
- 支持导出为 PNG/JPG（静态图片）
- 支持嵌入到 Markdown 文档（通过图片链接）

---

## 📚 示例

完整的可视化示例请参考：
- `/examples/radar-chart-example.html` - 雷达图示例
- `/examples/bar-chart-example.html` - 柱状图示例
- `/examples/line-chart-example.html` - 折线图示例
- `/examples/complete-report.html` - 完整报告示例（包含所有图表）
