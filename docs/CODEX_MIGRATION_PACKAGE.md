# Codex Migration Package

项目名称：考虑风光资源下的储能规划系统  
当前建议交接版本：V0.3.1 文档迁移包  
上一功能版本：V0.3 配储项目达标评估  
仓库地址：https://github.com/Joe-PaiPai/optimal-system-of-battery-under-PV-and-wind

## 1. 项目目标

本项目用于风电、光伏、负荷和储能系统的优化调度分析。

核心输出是每个时段的储能充放电电量：

- `battery_energy_kwh < 0`：储能充电
- `battery_energy_kwh > 0`：储能放电
- `battery_energy_kwh = 0`：储能不动作

当前系统包含两部分：

1. Python 后端 MILP 优化模型：`src/storage_dispatch_milp.py`
2. 静态前端页面：`frontend/index.html`

## 2. 当前版本记录

- `V0.1`：风光储自发自用优化调度系统原型
- `V0.2`：新增三种优化目标方案选择
- `V0.3`：新增配储项目达标评估表
- `V0.3.1`：迁移包和交接文档

版本管理规则：

- 每次功能更新都需要给出更新名称和版本号。
- 新功能默认递增：`V0.4`、`V0.5`。
- 小修复或文档更新用补丁号：`V0.3.1`、`V0.3.2`。
- 更新后需要 commit、tag，并 push 到 GitHub。

## 3. 仓库结构

```text
.
├── config/
│   └── sample_config.yml
├── docs/
│   └── CODEX_MIGRATION_PACKAGE.md
├── examples/
│   ├── run_sample.py
│   └── sample_timeseries.csv
├── frontend/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   └── storage_dispatch_milp.py
├── README.md
└── requirements.txt
```

重要提醒：

- `examples/sample_timeseries.csv` 当前有用户未提交改动，不要擅自还原。
- `outputs/*.csv` 是运行生成结果，已被 `.gitignore` 忽略。
- `.venv/` 是本地虚拟环境，已被 `.gitignore` 忽略。

## 4. 后端模型说明

后端文件：

```text
src/storage_dispatch_milp.py
```

求解方式：

```text
MILP，使用 PuLP + CBC 求解器
```

主要输入：

- `pv_kw`：光伏出力
- `wind_kw`：风电出力
- `load_kw`：负荷
- `grid_buy_price`：下网购电价格，可选
- `grid_sell_price`：上网售电价格，可选

主要储能参数：

- `capacity_kwh`
- `max_charge_kw`
- `max_discharge_kw`
- `initial_soc_kwh`
- `min_soc_kwh`
- `charge_efficiency`
- `discharge_efficiency`
- `dt_hours`

储能 SOC 公式：

```text
SOC[t+1] = SOC[t]
           + charge_efficiency * P_charge[t] * dt
           - P_discharge[t] * dt / discharge_efficiency
```

充放电互斥：

```text
charge_state[t] ∈ {0, 1}
P_charge[t] <= charge_state[t] * max_charge_kw
P_discharge[t] <= (1 - charge_state[t]) * max_discharge_kw
```

同时也约束了同一时段不能同时上网和下网。

## 5. 三种优化方案

配置字段：

```yaml
objective:
  mode: self_consumption
```

可选值：

### 方案一：最大化新能源自发自用

```text
self_consumption
```

目标：

```text
min export_priority_weight * 上网电量 + 下网电量
```

含义：

- 优先减少上网电量，提高新能源本地消纳。
- 在上网尽可能小的前提下，减少下网电量。

### 方案二：最小化总用电成本

```text
min_energy_cost
```

目标：

```text
min 下网购电成本 - 上网售电收益 + 储能循环成本 + 上网惩罚成本
```

相关参数：

```yaml
default_grid_buy_price: 1.0
default_grid_sell_price: 0.3
storage_cycle_cost: 0.0
export_penalty_cost: 0.0
```

如果 CSV 中提供 `grid_buy_price`、`grid_sell_price`，优先使用 CSV 中的逐时价格。

### 方案三：最大化储能套利收益

```text
max_storage_profit
```

目标以最小化形式实现：

```text
min 电价 * (充电电量 - 放电电量) + 储能循环成本
```

含义：

- 低价时倾向充电。
- 高价时倾向放电。
- 该目标不一定最大化新能源消纳。

## 6. 配置文件运行

配置文件：

```text
config/sample_config.yml
```

示例：

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
  mode: self_consumption
  export_priority_weight: 1000
  default_grid_buy_price: 1.0
  default_grid_sell_price: 0.3
  storage_cycle_cost: 0.0
  export_penalty_cost: 0.0

constraints:
  enforce_terminal_soc: true
```

运行：

```powershell
.\.venv\Scripts\python.exe src\storage_dispatch_milp.py --config config\sample_config.yml
```

如果没有虚拟环境：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 7. 输入 CSV 格式

必需列：

```csv
pv_kw,wind_kw,load_kw
```

可选列：

```csv
period,grid_buy_price,grid_sell_price
```

推荐格式：

```csv
period,pv_kw,wind_kw,load_kw,grid_buy_price,grid_sell_price
0,0,20,50,0.78,0.30
1,0,25,45,0.72,0.30
```

注意：

- `dt_hours = 1` 时，每行表示 1 小时。
- `dt_hours = 0.25` 时，每行表示 15 分钟。
- 全年逐小时数据通常是 8760 行。
- 全年 15 分钟数据通常是 35040 行。

## 8. 输出 CSV 字段

典型输出字段：

- `period`
- `pv_kwh`
- `wind_kwh`
- `load_kwh`
- `battery_energy_kwh`
- `charge_energy_kwh`
- `discharge_energy_kwh`
- `soc_start_kwh`
- `soc_end_kwh`
- `grid_export_kwh`
- `grid_import_kwh`
- `is_charging`
- `objective_mode`

其中：

```text
battery_energy_kwh = discharge_energy_kwh - charge_energy_kwh
```

## 9. 前端页面

前端入口：

```text
frontend/index.html
```

启动静态服务：

```powershell
.\.venv\Scripts\python.exe -m http.server 8000
```

访问：

```text
http://localhost:8000/frontend/index.html
```

前端当前是静态页面：

- 可以导入 CSV。
- 可以选择方案。
- 可以配置储能参数。
- 可以展示曲线、表格、达标评估。
- 前端调度算法是轻量预览逻辑，不完全等同于后端 MILP。

如果需要保证结果严格来自 MILP，后续应增加一个本地 API 服务，让前端调用 Python 后端。

## 10. 配储后项目达标评估

V0.3 新增三项指标：

### 指标 1：自发自用电量 / 总可用发电量

```text
(风光总发电量 - 上网电量) / 风光总发电量
```

标准：

```text
>= 60%
```

### 指标 2：自发自用电量 / 总用电量

```text
(风光总发电量 - 上网电量) / 负荷总用电量
```

标准：

```text
>= 30%
```

### 指标 3：上网电量 / 总可用发电量

```text
上网电量 / 风光总发电量
```

标准：

```text
<= 20%
```

前端实现位置：

```text
frontend/app.js
renderCompliance()
```

## 11. 已知注意事项

1. README 在部分 Windows 终端中可能显示乱码，这是终端编码显示问题，不一定代表文件内容不可用。
2. 前端页面如果打不开，通常是本地静态服务停止了，需要重新运行：

```powershell
.\.venv\Scripts\python.exe -m http.server 8000
```

3. 如果结果 CSV 正在被 Excel 打开，Python 无法覆盖输出文件。
4. 后端 `enforce_terminal_soc: true` 会强制期末 SOC 等于初始 SOC，适合日循环/周期调度。
5. 如果做全年仿真，可以考虑按全年强制期末 SOC，或后续扩展成逐日滚动优化。

## 12. 接手 Codex 的建议下一步

优先级建议：

1. 把前端静态预览逻辑和后端 MILP 统一，避免前端结果与后端求解结果不一致。
2. 增加一个本地后端服务，例如 FastAPI。
3. 前端点击“自动报价/运行”时调用后端 MILP。
4. 支持上传全年 CSV，并显示全年汇总指标。
5. 修复或重写 README 的中文编码显示问题。
6. 增加测试：
   - 三种目标模式都能求解
   - SOC 不越界
   - 充放电互斥
   - 上网/下网互斥
   - 功率平衡残差接近 0

## 13. 常用命令

检查状态：

```powershell
git status --short --branch
```

运行后端配置：

```powershell
.\.venv\Scripts\python.exe src\storage_dispatch_milp.py --config config\sample_config.yml
```

运行示例：

```powershell
.\.venv\Scripts\python.exe examples\run_sample.py
```

前端服务：

```powershell
.\.venv\Scripts\python.exe -m http.server 8000
```

前端访问：

```text
http://localhost:8000/frontend/index.html
```

提交版本示例：

```powershell
git add .
git commit -m "Release V0.3.1 migration package"
git tag -a V0.3.1 -m "迁移包 V0.3.1"
git push origin main
git push origin V0.3.1
```

