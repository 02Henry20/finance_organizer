const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function prepare(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, rect.width || canvas.parentElement?.clientWidth || 640);
  const height = Math.max(220, rect.height || canvas.parentElement?.clientHeight || 280);
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return { ctx, width, height, colors: colors() };
}

function colors() {
  return {
    grid: css("--chart-grid") || "rgba(148,163,184,.16)",
    text: css("--muted") || "#94a3b8",
    fg: css("--text") || "#f8fafc",
    primary: css("--primary") || "#16a3ff",
    accent: css("--accent") || "#3ee8c5",
    green: css("--green") || "#32d583",
    red: css("--red") || "#ff5c7a",
    yellow: css("--yellow") || "#f7c948",
    violet: css("--violet") || "#9b8cff"
  };
}

function setEmpty(canvas, empty) {
  const el = document.querySelector(`[data-empty-for="${canvas.id}"]`);
  if (el) el.hidden = !empty;
  canvas.style.opacity = empty ? "0" : "1";
}

function extent(values, pad = 0.12) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return [0, 1];
  let min = Math.min(...valid);
  let max = Math.max(...valid);
  if (min === max) {
    min -= Math.abs(min || 1) * 0.1 + 1;
    max += Math.abs(max || 1) * 0.1 + 1;
  }
  const padding = Math.max((max - min) * pad, 1);
  return [min - padding, max + padding];
}

function scale(min, max, a, b) {
  const span = max - min || 1;
  return value => a + ((value - min) / span) * (b - a);
}

function drawGrid(ctx, area, yMin, yMax, yScale, c, formatter = v => Math.round(v).toLocaleString()) {
  ctx.save();
  ctx.strokeStyle = c.grid;
  ctx.fillStyle = c.text;
  ctx.font = "11px Inter, system-ui";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const value = yMax - (i / 4) * (yMax - yMin);
    const y = yScale(value);
    ctx.beginPath();
    ctx.moveTo(area.left, y);
    ctx.lineTo(area.right, y);
    ctx.stroke();
    ctx.fillText(formatter(value), 6, y);
  }
  ctx.restore();
}

function drawLabels(ctx, labels, area, xFor, c) {
  ctx.save();
  ctx.fillStyle = c.text;
  ctx.font = "11px Inter, system-ui";
  ctx.textBaseline = "top";
  const step = Math.max(1, Math.ceil(labels.length / 5));
  labels.forEach((label, i) => {
    if (i % step !== 0 && i !== labels.length - 1) return;
    const x = xFor(i);
    ctx.textAlign = i === 0 ? "left" : i === labels.length - 1 ? "right" : "center";
    const display = /^\d{4}-\d{2}/.test(label) ? label.slice(2) : label;
    ctx.fillText(display, x, area.bottom + 10);
  });
  ctx.restore();
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rr);
}

function fitText(ctx, text, maxWidth) {
  const value = String(text || "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  let output = value;
  while (output.length > 1 && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output.trim()}...`;
}

export function drawIncomeExpense(canvas, rows, currency = "EUR") {
  const available = rows?.some(row => row.income || row.expense);
  setEmpty(canvas, !available);
  if (!available) return;
  const { ctx, width, height, colors: c } = prepare(canvas);
  const area = { left: 58, right: width - 18, top: 20, bottom: height - 36 };
  const max = Math.max(...rows.map(row => Math.max(row.income, row.expense)), 1) * 1.18;
  const y = scale(0, max, area.bottom, area.top);
  const xStep = (area.right - area.left) / rows.length;
  const barWidth = Math.max(5, Math.min(18, xStep * 0.28));
  drawGrid(ctx, area, 0, max, y, c, v => new Intl.NumberFormat(undefined, { notation: "compact" }).format(v));
  rows.forEach((row, i) => {
    const x = area.left + i * xStep + xStep / 2;
    const incomeH = area.bottom - y(row.income);
    const expenseH = area.bottom - y(row.expense);
    ctx.fillStyle = c.green;
    roundedRect(ctx, x - barWidth - 2, y(row.income), barWidth, incomeH, 5);
    ctx.fill();
    ctx.fillStyle = c.red;
    roundedRect(ctx, x + 2, y(row.expense), barWidth, expenseH, 5);
    ctx.fill();
  });
  drawLabels(ctx, rows.map(row => row.month), area, i => area.left + i * xStep + xStep / 2, c);
}

export function drawNetSeries(canvas, rows) {
  const available = rows?.length > 1;
  setEmpty(canvas, !available);
  if (!available) return;
  const { ctx, width, height, colors: c } = prepare(canvas);
  const area = { left: 58, right: width - 18, top: 20, bottom: height - 36 };
  const [min, max] = extent(rows.map(row => row.net), 0.2);
  const y = scale(min, max, area.bottom, area.top);
  const x = i => area.left + (rows.length === 1 ? 0 : i / (rows.length - 1)) * (area.right - area.left);
  drawGrid(ctx, area, min, max, y, c, v => new Intl.NumberFormat(undefined, { notation: "compact" }).format(v));
  ctx.save();
  const gradient = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, "rgba(62,232,197,.22)");
  gradient.addColorStop(1, "rgba(62,232,197,0)");
  ctx.beginPath();
  rows.forEach((row, i) => i ? ctx.lineTo(x(i), y(row.net)) : ctx.moveTo(x(i), y(row.net)));
  ctx.lineTo(x(rows.length - 1), area.bottom);
  ctx.lineTo(x(0), area.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.beginPath();
  rows.forEach((row, i) => i ? ctx.lineTo(x(i), y(row.net)) : ctx.moveTo(x(i), y(row.net)));
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  rows.forEach((row, i) => {
    ctx.beginPath();
    ctx.fillStyle = row.net >= 0 ? c.green : c.red;
    ctx.arc(x(i), y(row.net), 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
  drawLabels(ctx, rows.map(row => row.month), area, x, c);
}

function compactDonutRows(rows) {
  const sorted = (rows || []).filter(row => Number(row.value) > 0).sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
  if (sorted.length <= 8) return sorted;
  const shown = sorted.slice(0, 8);
  const restValue = sorted.slice(8).reduce((sum, row) => sum + Number(row.value || 0), 0);
  if (restValue > 0) shown.push({ categoryId: "rest", name: "Rest", group: "Rest", color: css("--muted") || "#64748B", value: restValue });
  return shown;
}

export function drawDonut(canvas, rows, currency = "EUR") {
  const data = compactDonutRows(rows);
  setEmpty(canvas, !data.length);
  if (!data.length) return;
  const { ctx, width, height, colors: c } = prepare(canvas);
  const compact = width < 430;
  const cx = compact ? width * 0.245 : width * 0.34;
  const cy = height * 0.5;
  const radius = compact ? Math.min(height * 0.27, width * 0.18) : Math.min(height * 0.34, width * 0.23);
  const total = data.reduce((sum, row) => sum + row.value, 0);
  const palette = [c.primary, c.accent, c.yellow, c.violet, c.green, c.red, "#69d2ff", "#d19dff", css("--muted") || "#64748B"];
  let angle = -Math.PI / 2;
  data.forEach((row, i) => {
    const slice = row.value / total * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, angle, angle + slice);
    ctx.arc(cx, cy, radius * 0.62, angle + slice, angle, true);
    ctx.closePath();
    ctx.fillStyle = row.color || palette[i % palette.length];
    ctx.fill();
    angle += slice;
  });
  ctx.save();
  ctx.fillStyle = c.fg;
  ctx.font = compact ? "700 15px Inter, system-ui" : "700 20px Inter, system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact" }).format(total), cx, cy - (compact ? 4 : 6));
  ctx.fillStyle = c.text;
  ctx.font = compact ? "10px Inter, system-ui" : "12px Inter, system-ui";
  ctx.fillText("spent", cx, cy + (compact ? 13 : 15));
  ctx.restore();
  const legendX = compact ? width * 0.47 : width * 0.58;
  ctx.font = compact ? "11px Inter, system-ui" : "12px Inter, system-ui";
  const valueFormatter = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
  const valueLabels = data.map(row => valueFormatter.format(row.value));
  const valueWidth = Math.max(...valueLabels.map(label => ctx.measureText(label).width), compact ? 38 : 44);
  const valueX = width - 12;
  const labelX = legendX + 18;
  const labelMax = Math.max(compact ? 38 : 48, valueX - valueWidth - 14 - labelX);
  const rowGap = compact ? 22 : 26;
  let legendY = Math.max(compact ? 18 : 24, cy - data.length * rowGap * 0.5 + 5);
  data.forEach((row, i) => {
    ctx.fillStyle = row.color || palette[i % palette.length];
    roundedRect(ctx, legendX, legendY - 8, 10, 10, 3);
    ctx.fill();
    ctx.fillStyle = c.fg;
    ctx.textAlign = "left";
    ctx.fillText(fitText(ctx, row.name, labelMax), labelX, legendY);
    ctx.fillStyle = c.text;
    ctx.textAlign = "right";
    ctx.fillText(valueLabels[i], valueX, legendY);
    ctx.textAlign = "left";
    legendY += rowGap;
  });
}

export function drawYearComparison(canvas, rows, currency = "EUR", options = {}) {
  const available = rows?.some(row => Number(row.current || 0) || Number(row.previous || 0));
  setEmpty(canvas, !available);
  if (!available) return;
  const { ctx, width, height, colors: c } = prepare(canvas);
  const area = { left: 58, right: width - 18, top: 34, bottom: height - 42 };
  const max = Math.max(...rows.map(row => Math.max(Number(row.current || 0), Number(row.previous || 0))), 1) * 1.18;
  const y = scale(0, max, area.bottom, area.top);
  const xStep = (area.right - area.left) / rows.length;
  const barWidth = Math.max(4, Math.min(13, xStep * 0.25));
  drawGrid(ctx, area, 0, max, y, c, v => new Intl.NumberFormat(undefined, { notation: "compact" }).format(v));
  rows.forEach((row, i) => {
    const x = area.left + i * xStep + xStep / 2;
    const previousH = area.bottom - y(Number(row.previous || 0));
    const currentH = area.bottom - y(Number(row.current || 0));
    ctx.fillStyle = c.violet;
    roundedRect(ctx, x - barWidth - 2, y(Number(row.previous || 0)), barWidth, previousH, 5);
    ctx.fill();
    ctx.fillStyle = c.accent;
    roundedRect(ctx, x + 2, y(Number(row.current || 0)), barWidth, currentH, 5);
    ctx.fill();
  });
  drawLabels(ctx, rows.map(row => row.label || ""), area, i => area.left + i * xStep + xStep / 2, c);
  ctx.save();
  ctx.font = "12px Inter, system-ui";
  ctx.textBaseline = "middle";
  const currentLabel = String(options.currentLabel || "Current");
  const previousLabel = String(options.previousLabel || "Previous");
  const legendY = 16;
  ctx.fillStyle = c.accent;
  roundedRect(ctx, area.left, legendY - 5, 10, 10, 3);
  ctx.fill();
  ctx.fillStyle = c.fg;
  ctx.textAlign = "left";
  ctx.fillText(currentLabel, area.left + 16, legendY);
  const prevX = area.left + 92;
  ctx.fillStyle = c.violet;
  roundedRect(ctx, prevX, legendY - 5, 10, 10, 3);
  ctx.fill();
  ctx.fillStyle = c.fg;
  ctx.fillText(previousLabel, prevX + 16, legendY);
  ctx.restore();
}

export function drawAccountBars(canvas, rows, currency = "EUR") {
  const data = (rows || []).filter(row => !row.hidden).slice(0, 9);
  setEmpty(canvas, !data.length);
  if (!data.length) return;
  const { ctx, width, height, colors: c } = prepare(canvas);
  const labelSpace = Math.min(118, Math.max(86, width * 0.24));
  const valueSpace = Math.min(104, Math.max(72, width * 0.18));
  const area = { left: labelSpace, right: width - valueSpace, top: 18, bottom: height - 18 };
  const max = Math.max(...data.map(row => Math.abs(row.balance.converted)), 1);
  const zero = area.left + (area.right - area.left) * 0.28;
  const barArea = Math.max(36, area.right - zero);
  const rowH = (area.bottom - area.top) / data.length;
  ctx.font = "12px Inter, system-ui";
  data.forEach((row, i) => {
    const y = area.top + i * rowH + rowH * 0.5;
    const value = row.balance.converted;
    ctx.fillStyle = c.text;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(row.name.slice(0, 18), zero - 12, y);
    const w = Math.max(4, Math.abs(value) / max * barArea);
    ctx.fillStyle = value >= 0 ? c.accent : c.red;
    roundedRect(ctx, zero, y - 9, w, 18, 8);
    ctx.fill();
    ctx.fillStyle = c.fg;
    const valueLabel = new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact" }).format(value);
    const valueX = zero + w + 9;
    ctx.textAlign = valueX > width - valueSpace + 18 ? "right" : "left";
    ctx.fillText(valueLabel, ctx.textAlign === "right" ? width - 12 : valueX, y);
  });
  ctx.strokeStyle = c.grid;
  ctx.beginPath();
  ctx.moveTo(zero, area.top - 5);
  ctx.lineTo(zero, area.bottom + 5);
  ctx.stroke();
}

export function clearChart(canvas) {
  if (!canvas) return;
  const { ctx, width, height } = prepare(canvas);
  ctx.clearRect(0, 0, width, height);
}
