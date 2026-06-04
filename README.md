# 考虑风光资源下的储能规划系统

本仓库用于存放“考虑风光资源下的储能规划系统”的项目代码、数据处理脚本、模型与相关文档。

当前版本：**风光储自发自用优化调度系统 V0.1**

## 项目结构

后续可按实际开发内容补充目录说明。

## 储能优化调度第一版

当前实现位于 `src/storage_dispatch_milp.py`，采用 MILP 计算风光储系统的最佳充放电计划。

优化目标：

1. 优先最小化上网电量。
2. 在上网电量尽可能小的前提下，最小化下网电量。

储能输出约定：

- `battery_energy_kwh < 0`：储能充电
- `battery_energy_kwh > 0`：储能放电
- `battery_energy_kwh = 0`：储能不动作

输入 CSV 需要包含以下列：

```csv
pv_kw,wind_kw,load_kw
```

运行示例：

```bash
pip install -r requirements.txt
python examples/run_sample.py
```

使用配置文件运行：

```bash
python src/storage_dispatch_milp.py --config config/sample_config.yml
```

配置文件示例：

```yaml
input_csv: ../examples/sample_timeseries.csv
output_csv: ../outputs/sample_result.csv

storage:
  capacity_kwh: 100
  max_charge_kw: 50
  max_discharge_kw: 50
  initial_soc_kwh: 50
  min_soc_kwh: 10
  charge_efficiency: 0.95
  discharge_efficiency: 0.95
  dt_hours: 1

objective:
  export_priority_weight: 1000

constraints:
  enforce_terminal_soc: true
```

也可以直接使用命令行：

```bash
python src/storage_dispatch_milp.py ^
  --input examples/sample_timeseries.csv ^
  --output examples/sample_result.csv ^
  --capacity-kwh 100 ^
  --max-charge-kw 50 ^
  --max-discharge-kw 50 ^
  --initial-soc-kwh 50 ^
  --min-soc-kwh 10 ^
  --dt-hours 1
```

## 前端页面

前端位于 `frontend/index.html`，可以直接打开，也可以启动本地静态服务：

```bash
python -m http.server 8000
```

然后访问：

```text
http://localhost:8000/frontend/index.html
```
