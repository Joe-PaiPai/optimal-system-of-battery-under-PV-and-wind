const sampleRows = [
  { period: 0, pv_kw: 0, wind_kw: 20, load_kw: 50, grid_buy_price: 0.78, grid_sell_price: 0.3 },
  { period: 1, pv_kw: 0, wind_kw: 25, load_kw: 45, grid_buy_price: 0.72, grid_sell_price: 0.3 },
  { period: 2, pv_kw: 10, wind_kw: 25, load_kw: 40, grid_buy_price: 0.66, grid_sell_price: 0.3 },
  { period: 3, pv_kw: 40, wind_kw: 20, load_kw: 45, grid_buy_price: 0.58, grid_sell_price: 0.3 },
  { period: 4, pv_kw: 80, wind_kw: 15, load_kw: 50, grid_buy_price: 0.48, grid_sell_price: 0.3 },
  { period: 5, pv_kw: 100, wind_kw: 15, load_kw: 55, grid_buy_price: 0.45, grid_sell_price: 0.3 },
  { period: 6, pv_kw: 60, wind_kw: 20, load_kw: 60, grid_buy_price: 0.52, grid_sell_price: 0.3 },
  { period: 7, pv_kw: 20, wind_kw: 30, load_kw: 65, grid_buy_price: 0.82, grid_sell_price: 0.3 },
  { period: 8, pv_kw: 0, wind_kw: 35, load_kw: 70, grid_buy_price: 0.95, grid_sell_price: 0.3 },
  { period: 9, pv_kw: 0, wind_kw: 30, load_kw: 60, grid_buy_price: 0.88, grid_sell_price: 0.3 },
];

let sourceRows = [...sampleRows];
let resultRows = [];

const elements = {
  workspace: document.querySelector(".workspace"),
  settingsPanel: document.querySelector("#settingsPanel"),
  statusText: document.querySelector("#statusText"),
  objectiveSelect: document.querySelector("#objectiveSelect"),
  rangeSelect: document.querySelector("#rangeSelect"),
  csvInput: document.querySelector("#csvInput"),
  sampleButton: document.querySelector("#sampleButton"),
  runButton: document.querySelector("#runButton"),
  exportButton: document.querySelector("#exportButton"),
  toggleSettingsButton: document.querySelector("#toggleSettingsButton"),
  resetButton: document.querySelector("#resetButton"),
  resultBody: document.querySelector("#resultBody"),
  rowCount: document.querySelector("#rowCount"),
  exportTotal: document.querySelector("#exportTotal"),
  importTotal: document.querySelector("#importTotal"),
  chargeTotal: document.querySelector("#chargeTotal"),
  dischargeTotal: document.querySelector("#dischargeTotal"),
  complianceBody: document.querySelector("#complianceBody"),
  complianceStatus: document.querySelector("#complianceStatus"),
  chart: document.querySelector("#dispatchChart"),
};

const defaults = {
  capacity: 100,
  maxCharge: 50,
  maxDischarge: 50,
  initialSoc: 50,
  minSoc: 10,
  chargeEff: 0.95,
  dischargeEff: 0.95,
  dtHours: 1,
};

function getConfig() {
  return {
    objectiveMode: elements.objectiveSelect.value,
    capacity: readNumber("capacity"),
    maxCharge: readNumber("maxCharge"),
    maxDischarge: readNumber("maxDischarge"),
    initialSoc: readNumber("initialSoc"),
    minSoc: readNumber("minSoc"),
    chargeEff: readNumber("chargeEff"),
    dischargeEff: readNumber("dischargeEff"),
    dtHours: readNumber("dtHours"),
  };
}

function readNumber(id) {
  return Number(document.querySelector(`#${id}`).value);
}

function setConfig(values) {
  Object.entries(values).forEach(([key, value]) => {
    document.querySelector(`#${key}`).value = value;
  });
}

function visibleSourceRows() {
  const range = elements.rangeSelect.value;
  if (range === "all") return sourceRows;
  return sourceRows.slice(0, Number(range));
}

function runDispatch() {
  const config = getConfig();
  const rows = visibleSourceRows();
  const errors = validateConfig(config);
  if (errors.length > 0) {
    elements.statusText.innerHTML = `<span class="warning">${errors[0]}</span>`;
    return;
  }

  let soc = config.initialSoc;
  const terminalTarget = config.initialSoc;
  const averageBuyPrice =
    rows.reduce((sum, row) => sum + price(row.grid_buy_price, 1), 0) / Math.max(1, rows.length);
  resultRows = rows.map((row, index) => {
    const pv = row.pv_kw * config.dtHours;
    const wind = row.wind_kw * config.dtHours;
    const load = row.load_kw * config.dtHours;
    const renewable = pv + wind;
    const socStart = soc;
    let charge = 0;
    let discharge = 0;
    let gridExport = 0;
    let gridImport = 0;

    if (config.objectiveMode === "max_storage_profit") {
      const buyPrice = price(row.grid_buy_price, 1);
      if (buyPrice <= averageBuyPrice) {
        const capacityRoomByInput = (config.capacity - soc) / config.chargeEff;
        charge = Math.max(0, Math.min(config.maxCharge * config.dtHours, capacityRoomByInput));
        soc += charge * config.chargeEff;
      } else {
        const availableOutput = (soc - config.minSoc) * config.dischargeEff;
        discharge = Math.max(0, Math.min(config.maxDischarge * config.dtHours, availableOutput));
        soc -= discharge / config.dischargeEff;
      }
      const netSupply = renewable + discharge;
      const netDemand = load + charge;
      gridExport = Math.max(0, netSupply - netDemand);
      gridImport = Math.max(0, netDemand - netSupply);
    } else if (renewable > load) {
      const surplus = renewable - load;
      const capacityRoomByInput = (config.capacity - soc) / config.chargeEff;
      const sellPrice = price(row.grid_sell_price, 0.3);
      const shouldCharge =
        config.objectiveMode === "self_consumption" || sellPrice < price(row.grid_buy_price, 1);
      charge = shouldCharge
        ? Math.max(0, Math.min(surplus, config.maxCharge * config.dtHours, capacityRoomByInput))
        : 0;
      soc += charge * config.chargeEff;
      gridExport = surplus - charge;
    } else {
      const deficit = load - renewable;
      const availableOutput = (soc - config.minSoc) * config.dischargeEff;
      const shouldDischarge =
        config.objectiveMode === "self_consumption" || price(row.grid_buy_price, 1) > 0;
      discharge = shouldDischarge
        ? Math.max(0, Math.min(deficit, config.maxDischarge * config.dtHours, availableOutput))
        : 0;
      soc -= discharge / config.dischargeEff;
      gridImport = deficit - discharge;
    }

    if (index === rows.length - 1 && soc < terminalTarget && gridImport === 0) {
      gridImport = terminalTarget - soc;
      soc = terminalTarget;
    }

    return {
      period: row.period ?? index,
      pv_kwh: pv,
      wind_kwh: wind,
      load_kwh: load,
      battery_energy_kwh: discharge - charge,
      soc_start_kwh: socStart,
      soc_end_kwh: soc,
      grid_export_kwh: gridExport,
      grid_import_kwh: gridImport,
      grid_buy_price: price(row.grid_buy_price, 1),
      grid_sell_price: price(row.grid_sell_price, 0.3),
      objective_mode: config.objectiveMode,
    };
  });

  renderAll();
  elements.statusText.textContent = `${resultRows.length} 个时段`;
}

function validateConfig(config) {
  const errors = [];
  if (config.capacity <= 0) errors.push("容量需大于 0");
  if (config.maxCharge <= 0 || config.maxDischarge <= 0) errors.push("功率需大于 0");
  if (config.chargeEff <= 0 || config.chargeEff > 1) errors.push("充电效率需在 0-1");
  if (config.dischargeEff <= 0 || config.dischargeEff > 1) errors.push("放电效率需在 0-1");
  if (config.minSoc < 0 || config.initialSoc < config.minSoc || config.initialSoc > config.capacity) {
    errors.push("SOC 参数不合法");
  }
  return errors;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",").map((item) => item.trim());
  const required = ["pv_kw", "wind_kw", "load_kw"];
  const missing = required.filter((name) => !headers.includes(name));
  if (missing.length) throw new Error(`缺少列：${missing.join(", ")}`);

  return lines
    .filter(Boolean)
    .map((line, index) => {
      const values = line.split(",").map((item) => item.trim());
      const record = Object.fromEntries(headers.map((header, i) => [header, values[i]]));
      return {
        period: record.period ? Number(record.period) : index,
        pv_kw: Number(record.pv_kw),
        wind_kw: Number(record.wind_kw),
        load_kw: Number(record.load_kw),
        grid_buy_price: record.grid_buy_price ? Number(record.grid_buy_price) : undefined,
        grid_sell_price: record.grid_sell_price ? Number(record.grid_sell_price) : undefined,
      };
    })
    .filter((row) => Number.isFinite(row.pv_kw) && Number.isFinite(row.wind_kw) && Number.isFinite(row.load_kw));
}

function renderAll() {
  renderMetrics();
  renderCompliance();
  renderTable();
  renderChart();
}

function renderMetrics() {
  const total = (field) => resultRows.reduce((sum, row) => sum + row[field], 0);
  elements.exportTotal.textContent = format(total("grid_export_kwh"));
  elements.importTotal.textContent = format(total("grid_import_kwh"));
  elements.chargeTotal.textContent = format(
    resultRows.reduce((sum, row) => sum + Math.max(0, -row.battery_energy_kwh), 0),
  );
  elements.dischargeTotal.textContent = format(
    resultRows.reduce((sum, row) => sum + Math.max(0, row.battery_energy_kwh), 0),
  );
}

function renderCompliance() {
  const total = (field) => resultRows.reduce((sum, row) => sum + row[field], 0);
  const renewableTotal = resultRows.reduce((sum, row) => sum + row.pv_kwh + row.wind_kwh, 0);
  const loadTotal = total("load_kwh");
  const exportTotal = total("grid_export_kwh");
  const selfUseEnergy = Math.max(0, renewableTotal - exportTotal);
  const items = [
    {
      category: "自发自用电量",
      requirement: "/总可用发电量",
      standard: ">= 60%",
      value: safeRatio(selfUseEnergy, renewableTotal),
      passed: safeRatio(selfUseEnergy, renewableTotal) >= 0.6,
    },
    {
      category: "自发自用电量",
      requirement: "/总用电量",
      standard: ">= 30%",
      value: safeRatio(selfUseEnergy, loadTotal),
      passed: safeRatio(selfUseEnergy, loadTotal) >= 0.3,
    },
    {
      category: "上网电量",
      requirement: "/总可用发电量",
      standard: "<= 20%",
      value: safeRatio(exportTotal, renewableTotal),
      passed: safeRatio(exportTotal, renewableTotal) <= 0.2,
    },
  ];

  const passedCount = items.filter((item) => item.passed).length;
  elements.complianceStatus.textContent = `${passedCount} / ${items.length} 达标`;
  elements.complianceBody.innerHTML = items
    .map(
      (item) => `
        <tr>
          <td>${item.category}</td>
          <td>${item.requirement}</td>
          <td>${item.standard}</td>
          <td class="ratio-value">${formatPercent(item.value)}</td>
          <td><span class="${item.passed ? "pass-badge" : "fail-badge"}">${item.passed ? "达标" : "未达标"}</span></td>
        </tr>
      `,
    )
    .join("");
}

function price(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function safeRatio(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(0)}%`;
}

function renderTable() {
  elements.rowCount.textContent = `${resultRows.length} 行`;
  elements.resultBody.innerHTML = resultRows
    .map((row) => {
      const batteryClass = row.battery_energy_kwh < 0 ? "charge" : row.battery_energy_kwh > 0 ? "discharge" : "";
      return `
        <tr>
          <td>${row.period}</td>
          <td>${format(row.pv_kwh)}</td>
          <td>${format(row.wind_kwh)}</td>
          <td>${format(row.load_kwh)}</td>
          <td class="${batteryClass}">${format(row.battery_energy_kwh)}</td>
          <td>${format(row.soc_start_kwh)}</td>
          <td>${format(row.soc_end_kwh)}</td>
          <td>${format(row.grid_export_kwh)}</td>
          <td>${format(row.grid_import_kwh)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderChart() {
  const canvas = elements.chart;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * scale);
  canvas.height = Math.floor(rect.height * scale);
  ctx.scale(scale, scale);

  const width = rect.width;
  const height = rect.height;
  const pad = { left: 48, right: 18, top: 18, bottom: 34 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  ctx.clearRect(0, 0, width, height);

  if (!resultRows.length) return;

  const maxValue = Math.max(
    1,
    ...resultRows.flatMap((row) => [
      row.pv_kwh + row.wind_kwh,
      row.load_kwh,
      Math.abs(row.battery_energy_kwh),
      row.soc_end_kwh,
    ]),
  );

  drawGrid(ctx, pad, plotWidth, plotHeight, maxValue);
  drawLine(ctx, resultRows.map((row) => row.pv_kwh + row.wind_kwh), "#2563eb", pad, plotWidth, plotHeight, maxValue);
  drawLine(ctx, resultRows.map((row) => row.load_kwh), "#111827", pad, plotWidth, plotHeight, maxValue);
  drawLine(ctx, resultRows.map((row) => row.soc_end_kwh), "#059669", pad, plotWidth, plotHeight, maxValue);
  drawBars(ctx, resultRows.map((row) => row.battery_energy_kwh), pad, plotWidth, plotHeight, maxValue);
  drawLegend(ctx, width);
}

function drawGrid(ctx, pad, plotWidth, plotHeight, maxValue) {
  ctx.strokeStyle = "#dbe4f0";
  ctx.fillStyle = "#647086";
  ctx.lineWidth = 1;
  ctx.font = "12px Microsoft YaHei, sans-serif";

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotHeight / 4) * i;
    const value = maxValue - (maxValue / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotWidth, y);
    ctx.stroke();
    ctx.fillText(format(value), 8, y + 4);
  }
}

function drawLine(ctx, values, color, pad, plotWidth, plotHeight, maxValue) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = pad.left + (plotWidth * index) / Math.max(1, values.length - 1);
    const y = pad.top + plotHeight - (value / maxValue) * plotHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawBars(ctx, values, pad, plotWidth, plotHeight, maxValue) {
  const zeroY = pad.top + plotHeight;
  const barWidth = Math.max(2, plotWidth / values.length / 2);
  values.forEach((value, index) => {
    const x = pad.left + (plotWidth * index) / Math.max(1, values.length - 1) - barWidth / 2;
    const barHeight = (Math.abs(value) / maxValue) * plotHeight;
    ctx.fillStyle = value < 0 ? "rgba(37, 99, 235, 0.3)" : "rgba(5, 150, 105, 0.34)";
    ctx.fillRect(x, zeroY - barHeight, barWidth, barHeight);
  });
}

function drawLegend(ctx, width) {
  const items = [
    ["风光", "#2563eb"],
    ["负荷", "#111827"],
    ["SOC", "#059669"],
    ["储能", "#93c5fd"],
  ];
  ctx.font = "12px Microsoft YaHei, sans-serif";
  let x = Math.max(52, width - 230);
  items.forEach(([label, color]) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, 16, 10, 10);
    ctx.fillStyle = "#647086";
    ctx.fillText(label, x + 15, 25);
    x += 52;
  });
}

function format(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

function exportCsv() {
  if (!resultRows.length) return;
  const headers = Object.keys(resultRows[0]);
  const lines = [
    headers.join(","),
    ...resultRows.map((row) => headers.map((header) => row[header]).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dispatch_result.csv";
  link.click();
  URL.revokeObjectURL(url);
}

elements.csvInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    sourceRows = parseCsv(await file.text());
    elements.statusText.textContent = file.name;
    runDispatch();
  } catch (error) {
    elements.statusText.innerHTML = `<span class="warning">${error.message}</span>`;
  }
});

elements.sampleButton.addEventListener("click", () => {
  sourceRows = [...sampleRows];
  elements.statusText.textContent = "示例数据";
  runDispatch();
});

elements.runButton.addEventListener("click", runDispatch);
elements.exportButton.addEventListener("click", exportCsv);
elements.rangeSelect.addEventListener("change", runDispatch);
elements.objectiveSelect.addEventListener("change", runDispatch);
elements.resetButton.addEventListener("click", () => {
  setConfig(defaults);
  runDispatch();
});

elements.toggleSettingsButton.addEventListener("click", () => {
  elements.workspace.classList.toggle("settings-hidden");
  const hidden = elements.workspace.classList.contains("settings-hidden");
  elements.toggleSettingsButton.textContent = hidden ? "显示参数" : "隐藏参数";
  window.setTimeout(renderChart, 80);
});

window.addEventListener("resize", renderChart);
setConfig(defaults);
runDispatch();
