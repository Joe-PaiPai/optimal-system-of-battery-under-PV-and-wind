# 考虑风光资源下的储能规划系统

当前版本：**CSV表头兼容 V0.4.2**

本仓库用于风电、光伏、负荷和储能系统的优化调度与储能规划分析。

## 功能概览

- 给定储能容量和功率，计算逐时储能充放电计划。
- 支持三种运行目标：
  - 方案一：最大化新能源自发自用
  - 方案二：最小化总用电成本
  - 方案三：最大化储能套利收益
- 新增方案四：按指标约束计算最小储能容量与功率。
- 前端可导入 CSV，展示指标、图表、调度结果和达标情况。

## 方案四：容量功率规划

方案四用于计算满足指标的最小储能配置。

目标函数：

```text
min Z = C_E * E_cap + C_P * P_cap
```

其中：

```text
E_cap = 储能容量，kWh
P_cap = 储能功率，kW
C_E = 容量成本权重，前端默认取 1
C_P = 功率成本权重，前端默认取 1
```

三个指标作为硬约束：

```text
1. 自发自用电量 / 总可用发电量 >= 60%
2. 自发自用电量 / 总用电量 >= 30%
3. 上网电量 / 总可用发电量 <= 20%
```

至少 2 小时储能系统：

```text
E_cap >= 2 * P_cap
```

前端中，方案四和前三个方案使用同一套输入项。方案四会把已有的储能容量、最大充电功率、最大放电功率作为规划搜索上限，在这些上限内寻找满足指标的最小配置。

## 输入 CSV

必需列：

```csv
pv_kw,wind_kw,load_kw
```

也支持 MW 表头，导入后会自动换算为 kW：

```csv
pv_mw,wind_mw,load_mw
```

可选列：

```csv
period,grid_buy_price,grid_sell_price
```

电价列也兼容：

```csv
grid_buy_p,grid_sell_price
```

示例：

```csv
period,pv_kw,wind_kw,load_kw,grid_buy_price,grid_sell_price
0,0,20,50,0.78,0.30
1,0,25,45,0.72,0.30
```

## 后端运行

安装依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

使用配置文件运行：

```powershell
.\.venv\Scripts\python.exe src\storage_dispatch_milp.py --config config\sample_config.yml
```

运行示例：

```powershell
.\.venv\Scripts\python.exe examples\run_sample.py
```

## 前端页面

启动本地服务：

```powershell
.\.venv\Scripts\python.exe -m http.server 8000
```

访问：

```text
http://localhost:8000/frontend/index.html
```

## 版本记录

- `V0.1`：风光储自发自用优化调度系统原型
- `V0.2`：多目标方案选择
- `V0.3`：配储项目达标评估
- `V0.3.1`：迁移包和交接文档
- `V0.4`：容量功率规划
- `V0.4.1`：统一方案输入
- `V0.4.2`：CSV表头兼容
