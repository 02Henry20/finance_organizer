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

export function drawDonut(canvas, rows, currency = "EUR") {
  const source = (rows || []).filter(row => row.value > 0).sort((a, b) => b.value - a.value);
  const data = source.length > 9
    ? [...source.slice(0, 8), { name: "Rest", value: source.slice(8).reduce((sum, row) => sum + row.value, 0), color: css("--muted") || "#94a3b8" }]
    : source.slice(0, 9);
  setEmpty(canvas, !data.length);
  if (!data.length) return;
  const { ctx, width, height, colors: c } = prepare(canvas);
  const mobile = width < 430;
  const cx = mobile ? width * 0.24 : width * 0.34;
  const cy = height * 0.5;
  const radius = Math.min(height * 0.34, width * (mobile ? 0.18 : 0.23));
  const total = data.reduce((sum, row) => sum + row.value, 0);
  const palette = [c.primary, c.accent, c.yellow, c.violet, c.green, c.red, "#69d2ff", "#d19dff", c.text];
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
  const totalLabel = new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(total);
  const centerFont = mobile ? (totalLabel.length > 6 ? 12 : 14) : (totalLabel.length > 7 ? 16 : 20);
  ctx.font = `800 ${centerFont}px Inter, system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(totalLabel, cx, cy - 5);
  ctx.fillStyle = c.text;
  ctx.font = `${mobile ? 10 : 12}px Inter, system-ui`;
  ctx.fillText("spent", cx, cy + (mobile ? 12 : 15));
  ctx.restore();
  const legendX = mobile ? width * 0.45 : width * 0.58;
  ctx.font = `${mobile ? 11 : 12}px Inter, system-ui`;
  const valueFormatter = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
  const valueLabels = data.map(row => valueFormatter.format(row.value));
  const valueWidth = Math.max(...valueLabels.map(label => ctx.measureText(label).width), mobile ? 36 : 44);
  const valueX = width - 12;
  const labelX = legendX + 18;
  const labelMax = Math.max(42, valueX - valueWidth - 14 - labelX);
  let legendY = Math.max(24, cy - data.length * (mobile ? 12 : 13));
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
    legendY += mobile ? 23 : 26;
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

export function drawAccountBars(canvas, rows, currency = "EUR", options = {}) {
  const previousMap = new Map((options.previousRows || []).map(row => [row.id, row]));
  const data = (rows || [])
    .filter(row => !row.hidden)
    .sort((a, b) => {
      const av = Number(a.balance?.converted || 0);
      const bv = Number(b.balance?.converted || 0);
      const aNeg = av < 0;
      const bNeg = bv < 0;
      if (aNeg !== bNeg) return aNeg ? 1 : -1;
      return bv - av || String(a.name || "").localeCompare(String(b.name || ""));
    });
  setEmpty(canvas, !data.length);
  if (!data.length) return;
  const { ctx, width, height, colors: c } = prepare(canvas);
  const mobile = width < 520;
  const labelSpace = mobile ? Math.min(158, Math.max(132, width * 0.39)) : Math.min(132, Math.max(104, width * 0.17));
  const valueSpace = mobile ? Math.min(70, Math.max(52, width * 0.14)) : Math.min(92, Math.max(64, width * 0.11));
  const area = { left: labelSpace, right: width - valueSpace, top: 18, bottom: height - 18 };
  const values = data.flatMap(row => {
    const current = Number(row.balance?.converted || 0);
    const previous = Number(previousMap.get(row.id)?.balance?.converted ?? current);
    return [current, previous];
  });
  const maxAbs = Math.max(...values.map(value => Math.abs(value)), 1);
  const zero = area.left + (area.right - area.left) * (mobile ? 0.50 : 0.46);
  const negScale = (zero - area.left - 8) / maxAbs;
  const posScale = (area.right - zero - 8) / maxAbs;
  const rowH = (area.bottom - area.top) / data.length;
  const labelMax = Math.max(48, area.left - 18);
  ctx.font = `${mobile ? 11 : 12}px Inter, system-ui`;

  const drawSegment = (fromValue, toValue, y, color, heightPx = 18) => {
    if (Math.abs(toValue - fromValue) < 0.005) return;
    const xFor = value => value >= 0 ? zero + value * posScale : zero + value * negScale;
    const drawOne = (a, b) => {
      const x1 = xFor(a);
      const x2 = xFor(b);
      const x = Math.min(x1, x2);
      const w = Math.max(3, Math.abs(x2 - x1));
      ctx.fillStyle = color;
      roundedRect(ctx, x, y - heightPx / 2, w, heightPx, 7);
      ctx.fill();
    };
    if ((fromValue < 0 && toValue > 0) || (fromValue > 0 && toValue < 0)) {
      drawOne(fromValue, 0);
      drawOne(0, toValue);
    } else {
      drawOne(fromValue, toValue);
    }
  };

  data.forEach((row, i) => {
    const y = area.top + i * rowH + rowH * 0.5;
    const current = Number(row.balance?.converted || 0);
    const previous = Number(previousMap.get(row.id)?.balance?.converted ?? current);
    const delta = current - previous;

    ctx.fillStyle = c.text;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(fitText(ctx, row.name, labelMax), area.left - 12, y);

    if (options.showDelta && Math.abs(delta) > 0.005) {
      drawSegment(0, previous, y, "rgba(148,163,184,.34)", 18);
      drawSegment(previous, current, y, delta >= 0 ? c.accent : c.red, 18);
    } else {
      drawSegment(0, current, y, current >= 0 ? c.accent : c.red, 18);
    }

    const valueLabel = new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact" }).format(current);
    const endX = current >= 0 ? zero + current * posScale : zero + current * negScale;
    ctx.fillStyle = c.fg;
    ctx.textAlign = current >= 0 ? "left" : "right";
    let valueX = current >= 0 ? endX + 8 : endX - 8;
    if (current >= 0 && valueX > width - 12) { valueX = width - 12; ctx.textAlign = "right"; }
    if (current < 0 && valueX < area.left + 8) { valueX = area.left + 8; ctx.textAlign = "left"; }
    ctx.fillText(valueLabel, valueX, y);
  });
  ctx.strokeStyle = c.grid;
  ctx.beginPath();
  ctx.moveTo(zero, area.top - 5);
  ctx.lineTo(zero, area.bottom + 5);
  ctx.stroke();
}
