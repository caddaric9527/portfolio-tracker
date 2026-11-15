/* 本文件由 DeepSeek v4.1 FLASH 模型编写 */
/* 投资组合月度收益统计 */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const SYM = { CNY: '¥', USD: '$', HKD: 'HK$' };
const state = { overview: null, trendMode: 'returnPct', expanded: new Set(), settings: null };

/* ---------------- 基础工具 ---------------- */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    location.replace('/login');
    throw new Error('登录已过期，请重新登录');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2600);
}

/* 普通确认（非破坏性操作用，不需要输入关键词） */
function confirmSimple({ title, text, okText = '确定' }) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'modal open';
    box.innerHTML = `
      <div class="modal-box" style="max-width:400px">
        <div class="modal-head"><h3>${esc(title)}</h3></div>
        <p style="margin:0 0 16px;color:var(--muted);line-height:1.65">${esc(text)}</p>
        <div class="modal-foot">
          <button class="btn" data-no>取消</button>
          <button class="btn primary" data-yes>${esc(okText)}</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    const close = (v) => {
      document.removeEventListener('keydown', onKey);
      box.remove();
      resolve(v);
    };
    function onKey(e) { if (e.key === 'Escape') close(false); }
    document.addEventListener('keydown', onKey);
    box.querySelector('[data-yes]').onclick = () => close(true);
    box.querySelector('[data-no]').onclick = () => close(false);
    box.onclick = (e) => { if (e.target === box) close(false); };
  });
}

/* 敏感操作二次确认：必须手动输入关键词（默认「确认」）才能执行 */
function confirmTyping({ title, text, keyword = '确认', okText = '确定执行', danger = true }) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'modal open';
    box.innerHTML = `
      <div class="modal-box" style="max-width:420px">
        <div class="modal-head"><h3>${esc(title)}</h3></div>
        <p style="margin:0 0 14px;color:var(--muted);line-height:1.65">${esc(text)}</p>
        <label class="confirm-typing">请输入 <b>${esc(keyword)}</b> 以继续
          <input type="text" autocomplete="off" spellcheck="false" placeholder="${esc(keyword)}" id="confirmInput">
        </label>
        <p class="confirm-hint" id="confirmHint" hidden>输入不匹配，请检查后重试</p>
        <div class="modal-foot">
          <button class="btn" data-no>取消</button>
          <button class="btn ${danger ? 'danger-fill' : 'primary'}" data-yes disabled>${esc(okText)}</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    const input = box.querySelector('#confirmInput');
    const yes = box.querySelector('[data-yes]');
    const hint = box.querySelector('#confirmHint');
    const close = (v) => { box.remove(); resolve(v); };
    input.addEventListener('input', () => {
      const v = input.value.trim();
      yes.disabled = v !== keyword;
      hint.hidden = !v || v === keyword;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !yes.disabled) close(true);
      if (e.key === 'Escape') close(false);
    });
    yes.onclick = () => { if (!yes.disabled) close(true); };
    box.querySelector('[data-no]').onclick = () => close(false);
    box.onclick = (e) => { if (e.target === box) close(false); };
    setTimeout(() => input.focus(), 60);
  });
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
const money = (v, cur = 'CNY', d = 2) => (isNum(v) ? SYM[cur] + Number(v).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const pct = (v) => (isNum(v) ? (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%' : '—');
const cls = (v) => (!isNum(v) || Math.abs(Number(v)) < 1e-9 ? 'flat' : Number(v) > 0 ? 'up' : 'down');
const signed = (v, cur = 'CNY', d = 2) => (isNum(v) ? (Number(v) > 0 ? '+' : '') + money(v, cur, d) : '—');

/* ---------------- 汇总卡片 ---------------- */
function renderSummary() {
  const s = state.overview.summary;
  const cur = s.currency;
  const cnyNote = cur === 'CNY' ? '' : ` · 汇率 1USD≈${state.overview.fx.toCny.USD}CNY`;
  const cards = [
    {
      label: `累计投入本金（${cur}）`,
      value: money(s.invested, cur),
      sub: `${s.portfolioCount} 个组合 · 已录 ${s.recordedPortfolios} 个`,
    },
    {
      label: `当前市值（${cur}）`,
      value: money(s.value, cur),
      sub: `本月投入 ${signed(s.monthInvested, cur)}`,
    },
    {
      label: '累计收益',
      value: `<span class="${cls(s.gain)}">${signed(s.gain, cur)}</span>`,
      sub: `本月盈亏 <span class="${cls(s.monthPnl)}">${signed(s.monthPnl, cur)}</span>`,
    },
    {
      label: '总收益率',
      value: `<span class="${cls(s.returnPct)}">${pct(s.returnPct)}</span>`,
      sub: `截至 ${esc(s.currentMonth)}${cnyNote}`,
    },
  ];
  $('#summaryCards').innerHTML = cards
    .map((c) => `<div class="card"><div class="label">${c.label}</div><div class="value">${c.value}</div><div class="sub">${c.sub}</div></div>`)
    .join('');
}

/* ---------------- 组合卡片 ---------------- */
function sparkline(history, cur) {
  const pts = history.map((r) => r.returnPct).filter(isNum);
  const W = 130, H = 44, P = 4;
  if (pts.length < 2) return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle" font-size="10" fill="#9aa4b2">数据不足</text></svg>`;
  const min = Math.min(...pts, 0), max = Math.max(...pts, 0);
  const span = max - min || 1;
  const xy = (v, i) => [P + (i / (pts.length - 1)) * (W - 2 * P), H - P - ((v - min) / span) * (H - 2 * P)];
  const path = pts.map((v, i) => xy(v, i).map((n) => n.toFixed(1)).join(',')).join(' ');
  const zeroY = xy(0, 0)[1];
  const last = pts[pts.length - 1];
  const [lx, ly] = xy(last, pts.length - 1);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <line x1="${P}" y1="${zeroY}" x2="${W - P}" y2="${zeroY}" stroke="#d7dde6" stroke-dasharray="3 3"/>
    <polyline points="${path}" fill="none" stroke="${last >= 0 ? '#0d9457' : '#d92f2f'}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${lx}" cy="${ly}" r="3" fill="${last >= 0 ? '#0d9457' : '#d92f2f'}"/>
  </svg>`;
}

function historyTable(pf) {
  const cur = pf.currency;
  const rows = [...pf.history].reverse().map((r) => `
    <tr>
      <td>${esc(r.month)}</td>
      <td class="num">${money(r.invested, cur)}</td>
      <td class="num">${money(r.value, cur)}</td>
      <td class="num ${cls(r.gain)}">${signed(r.gain, cur)}</td>
      <td class="num ${cls(r.returnPct)}">${pct(r.returnPct)}</td>
      <td class="num">${isNum(r.monthInvested) ? money(r.monthInvested, cur) : '—'}</td>
      <td class="num ${cls(r.monthPnl)}">${isNum(r.monthPnl) ? signed(r.monthPnl, cur) : '—'}</td>
      <td><span class="note">${esc(r.note || '')}</span></td>
      <td class="num">
        <button class="btn small" data-edit-rec="${r.id}" data-pf="${pf.id}">编辑</button>
        <button class="btn small danger" data-del-rec="${r.id}">删除</button>
      </td>
    </tr>`).join('');
  return `
    <div class="pf-history">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>月份</th><th class="num">投入本金</th><th class="num">当前市值</th>
            <th class="num">收益金额</th><th class="num">收益率</th>
            <th class="num">本月投入</th><th class="num">本月盈亏</th><th>备注</th><th class="num">操作</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="9" class="muted center">还没有录入数据</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function renderPortfolios() {
  const items = state.overview.portfolios;
  $('#pfCount').textContent = items.length ? `${items.length} 个组合` : '';
  if (!items.length) {
    $('#pfList').innerHTML = '<p class="muted center">还没有组合，点右上角「＋ 新增组合」创建第一个。</p>';
    return;
  }
  const curMonth = state.overview.summary.currentMonth;
  $('#pfList').innerHTML = items.map((pf) => {
    const cur = pf.currency;
    const l = pf.latest;
    const recordedThisMonth = pf.history.some((r) => r.month === curMonth);
    const metrics = l
      ? `
      <div class="metric"><span class="metric-label">投入本金（${esc(l.month)}）</span><span class="metric-value">${money(l.invested, cur)}</span></div>
      <div class="metric"><span class="metric-label">当前市值</span><span class="metric-value">${money(l.value, cur)}</span></div>
      <div class="metric"><span class="metric-label">收益金额</span><span class="metric-value ${cls(l.gain)}">${signed(l.gain, cur)}</span></div>
      <div class="metric"><span class="metric-label">收益率</span><span class="metric-value ${cls(l.returnPct)}">${pct(l.returnPct)}</span></div>
      <div class="metric"><span class="metric-label">本月盈亏</span><span class="metric-value ${cls(l.monthPnl)}">${isNum(l.monthPnl) ? signed(l.monthPnl, cur) : '—'}</span><span class="metric-sub">本月投入 ${isNum(l.monthInvested) ? money(l.monthInvested, cur) : '—'}</span></div>`
      : `<div class="metric" style="grid-column:1/-1"><span class="metric-label">尚无数据</span><span class="metric-value muted">—</span><span class="metric-sub">点下方「录入本月数据」开始记录</span></div>`;
    return `
    <div class="pf-card" data-pf="${pf.id}">
      <div class="pf-head">
        <div class="pf-title">
          <span class="name">${esc(pf.name)}</span>
          <span class="tag cur">${SYM[cur]}</span>
          <span class="alloc">${esc(pf.allocation || '')}</span>
        </div>
        ${recordedThisMonth ? '<span class="tag">本月已录 ✓</span>' : `<span class="missed">${esc(curMonth)} 待录入</span>`}
      </div>
      <div class="pf-plan">定投方案：${esc(pf.dcaPlan || '未设置')}</div>
      <div class="pf-body">
        <div class="pf-metrics">${metrics}</div>
        <div class="pf-spark"><span class="metric-label">收益率走势</span>${sparkline(pf.history, cur)}</div>
      </div>
      <div class="pf-foot">
        <button class="btn small primary" data-rec="${pf.id}">录入 / 更新本月</button>
        <button class="btn small" data-toggle-his="${pf.id}">${state.expanded.has(pf.id) ? '收起历史' : `历史（${pf.recordCount} 个月）`}</button>
        <button class="btn small" data-edit-pf="${pf.id}">编辑组合</button>
        <button class="btn small danger" data-del-pf="${pf.id}">删除</button>
      </div>
      ${state.expanded.has(pf.id) ? historyTable(pf) : ''}
    </div>`;
  }).join('');
}

/* ---------------- 走势图 ---------------- */
function renderTrend() {
  const trend = state.overview.trend;
  const mode = state.trendMode;
  const empty = $('#trendEmpty');
  if (trend.length < 2) {
    $('#trendChart').innerHTML = '';
    empty.hidden = trend.length !== 0;
    if (trend.length === 1) $('#trendChart').innerHTML = `<p class="muted center">已录 ${esc(trend[0].month)}：投入 ${money(trend[0].invested, state.overview.summaryCurrency)} · 市值 ${money(trend[0].value, state.overview.summaryCurrency)} · 收益 <span class="${cls(trend[0].gain)}">${signed(trend[0].gain, state.overview.summaryCurrency)}（${pct(trend[0].returnPct)}）</span></p>`;
    return;
  }
  empty.hidden = true;

  const W = 1040, H = 300, PL = 70, PR = 20, PT = 18, PB = 34;
  const iw = W - PL - PR, ih = H - PT - PB;
  const cur = state.overview.summaryCurrency;
  const series = [];
  if (mode === 'invested') {
    series.push({ key: 'value', label: '当前市值', color: '#2e6be6', dash: '' });
    series.push({ key: 'invested', label: '累计投入', color: '#98a4b5', dash: '5 4' });
  } else {
    series.push({ key: mode, label: mode === 'gain' ? '收益金额' : '收益率 %', color: '#e0a028', dash: '' });
  }

  const vals = trend.flatMap((t) => series.map((s) => t[s.key])).filter(isNum);
  let min = Math.min(...vals, mode === 'invested' ? Infinity : 0);
  let max = Math.max(...vals);
  if (!Number.isFinite(min)) min = 0;
  if (max === min) { max += 1; min -= 1; }
  const pad = (max - min) * 0.08;
  if (mode !== 'invested') { min = Math.min(min - pad, 0); max = max + pad; } else { min -= pad; max += pad; }

  const X = (i) => PL + (trend.length === 1 ? iw / 2 : (i / (trend.length - 1)) * iw);
  const Y = (v) => PT + ih - ((v - min) / (max - min)) * ih;
  const fmt = (v) => (mode === 'returnPct' ? v.toFixed(1) + '%' : Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + 'w' : Math.round(v));

  // 网格 + Y 轴
  const ticks = 5;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    const y = Y(v);
    grid += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#eef1f5"/>
             <text x="${PL - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#8a94a5">${fmt(v)}</text>`;
  }
  // X 轴标签（最多 12 个）
  const step = Math.ceil(trend.length / 12);
  let xlabels = '';
  trend.forEach((t, i) => {
    if (i % step === 0 || i === trend.length - 1) {
      xlabels += `<text x="${X(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#8a94a5">${t.month.slice(2)}</text>`;
    }
  });

  let lines = '';
  for (const s of series) {
    const path = trend.map((t, i) => (isNum(t[s.key]) ? `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(t[s.key]).toFixed(1)}` : '')).join(' ');
    const dots = trend.map((t, i) => (isNum(t[s.key]) ? `<circle cx="${X(i).toFixed(1)}" cy="${Y(t[s.key]).toFixed(1)}" r="3.2" fill="${s.color}"><title>${t.month} ${fmt(t[s.key])}</title></circle>` : '')).join('');
    lines += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.2" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round"/>${dots}`;
  }

  const legend = series.map((s) => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px"><span style="width:14px;height:3px;background:${s.color};border-radius:2px"></span>${s.label}</span>`).join('');

  $('#trendChart').innerHTML = `
    <div style="margin-bottom:6px">${legend}<span class="muted small">（${cur}${cur === 'CNY' ? '' : ' 计价'}）</span></div>
    <svg viewBox="0 0 ${W} ${H}">
      ${grid}${xlabels}
      <line x1="${PL}" y1="${PT + ih}" x2="${W - PR}" y2="${PT + ih}" stroke="#cfd6df"/>
      ${mode !== 'invested' ? `<line x1="${PL}" y1="${Y(0)}" x2="${W - PR}" y2="${Y(0)}" stroke="#d7dde6" stroke-dasharray="4 4"/>` : ''}
      ${lines}
    </svg>`;
}

/* ---------------- 月度明细表 ---------------- */
function renderDetail() {
  const items = state.overview.portfolios;
  const rows = [];
  for (const pf of items) {
    for (const r of [...pf.history].reverse()) {
      rows.push({ pf, r });
    }
  }
  rows.sort((a, b) => b.r.month.localeCompare(a.r.month) || a.pf.id - b.pf.id);
  $('#detailHint').textContent = rows.length ? `共 ${rows.length} 条记录` : '';
  $('#detailTable tbody').innerHTML = rows.length
    ? rows.map(({ pf, r }) => `
      <tr>
        <td>${esc(r.month)}</td>
        <td>${esc(pf.name)} <span class="tag cur">${SYM[pf.currency]}</span></td>
        <td class="num">${money(r.invested, pf.currency)}</td>
        <td class="num">${money(r.value, pf.currency)}</td>
        <td class="num ${cls(r.gain)}">${signed(r.gain, pf.currency)}</td>
        <td class="num ${cls(r.returnPct)}">${pct(r.returnPct)}</td>
        <td class="num">${isNum(r.monthInvested) ? money(r.monthInvested, pf.currency) : '—'}</td>
        <td class="num ${cls(r.monthPnl)}">${isNum(r.monthPnl) ? signed(r.monthPnl, pf.currency) : '—'}</td>
        <td><span class="note">${esc(r.note || '')}</span></td>
        <td class="num">
          <button class="btn small" data-edit-rec="${r.id}" data-pf="${pf.id}">编辑</button>
          <button class="btn small danger" data-del-rec="${r.id}">删除</button>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="10" class="muted center">暂无记录</td></tr>';
}

function renderAll() {
  renderSummary();
  renderPortfolios();
  renderTrend();
  renderDetail();
}

/* ---------------- 弹窗 ---------------- */
const openModal = (sel) => $(sel).classList.add('open');
const closeModal = (sel) => $(sel).classList.remove('open');

/* ---------------- 分享图（1080 宽 PNG，纯 Canvas 绘制） ---------------- */
const SHARE_FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Noto Sans SC",sans-serif';
const SHARE_W = 1080;
const SHARE_PX = 72;

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipsis(ctx, text, maxW) {
  const s = String(text ?? '');
  if (ctx.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function buildShareCanvas() {
  const o = state.overview;
  const s = o.summary;
  const cur = s.currency;
  const withData = o.portfolios.filter((p) => p.latest);
  const shown = withData.slice(0, 6);
  const CW = SHARE_W - SHARE_PX * 2;
  const LIST_TOP = 772, ROW_H = 112;
  const moreH = withData.length > shown.length ? 56 : 0;
  const H = Math.max(1280, LIST_TOP + shown.length * ROW_H + moreH + 200);

  const cvs = document.createElement('canvas');
  cvs.width = SHARE_W;
  cvs.height = H;
  const ctx = cvs.getContext('2d');
  const F = (weight, size) => `${weight} ${size}px ${SHARE_FONT}`;
  const C = { text: '#1a2233', muted: '#6b7688', sub: '#8a94a5', line: '#e6ebf2', up: '#0d9457', down: '#d92f2f', flat: '#6b7688' };
  const tone = (v) => (!isNum(v) || Math.abs(Number(v)) < 1e-9 ? C.flat : Number(v) > 0 ? C.up : C.down);

  /* 背景 */
  ctx.fillStyle = '#f4f6f9';
  ctx.fillRect(0, 0, SHARE_W, H);
  const bg = ctx.createLinearGradient(0, 0, SHARE_W * 0.7, 470);
  bg.addColorStop(0, '#e8f0ff');
  bg.addColorStop(1, '#f4f6f9');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SHARE_W, 470);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  /* 品牌行 */
  ctx.fillStyle = '#2e6be6';
  ctx.beginPath();
  ctx.arc(SHARE_PX + 8, 62, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = F(600, 26);
  ctx.fillStyle = C.text;
  ctx.fillText('投资组合收益统计', SHARE_PX + 28, 71);
  ctx.textAlign = 'right';
  ctx.font = F(400, 26);
  ctx.fillStyle = C.muted;
  ctx.fillText(`截至 ${s.currentMonth}`, SHARE_W - SHARE_PX, 71);
  ctx.textAlign = 'left';

  /* 标题 */
  ctx.font = F(700, 44);
  ctx.fillStyle = C.text;
  ctx.fillText('月度收益报告', SHARE_PX, 152);

  /* 主卡 */
  const cardY = 192, cardH = 316;
  ctx.save();
  ctx.shadowColor = 'rgba(16,24,40,.10)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#fff';
  roundRectPath(ctx, SHARE_PX, cardY, CW, cardH, 30);
  ctx.fill();
  ctx.restore();

  ctx.font = F(500, 26);
  ctx.fillStyle = C.muted;
  ctx.fillText('总收益率', SHARE_PX + 48, cardY + 64);

  ctx.font = F(700, 104);
  ctx.fillStyle = tone(s.returnPct);
  ctx.fillText(pct(s.returnPct), SHARE_PX + 44, cardY + 174);

  ctx.font = F(500, 30);
  ctx.fillStyle = C.muted;
  ctx.fillText(`累计收益 ${signed(s.gain, cur)}`, SHARE_PX + 48, cardY + 234);

  ctx.font = F(400, 23);
  ctx.fillStyle = C.sub;
  ctx.fillText(`${s.portfolioCount} 个组合 · 已录 ${s.recordedPortfolios} 个`, SHARE_PX + 48, cardY + 274);

  /* 主卡右侧：近 8 期收益率走势 */
  const hist = (o.trend || []).map((t) => t.returnPct).filter(isNum).slice(-8);
  if (hist.length >= 2) {
    const bw = 300, bh = 132;
    const bx = SHARE_PX + CW - bw - 48, by = cardY + 92;
    const min = Math.min(...hist, 0);
    const max = Math.max(...hist, 0);
    const span = max - min || 1;
    const X = (i) => bx + (i / (hist.length - 1)) * bw;
    const Y = (v) => by + bh - ((v - min) / span) * bh;
    const lineCol = tone(hist[hist.length - 1]);

    ctx.save();
    ctx.strokeStyle = '#eef1f5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, by + bh);
    ctx.lineTo(bx + bw, by + bh);
    ctx.stroke();

    const grad = ctx.createLinearGradient(0, by, 0, by + bh);
    grad.addColorStop(0, lineCol + '3d');
    grad.addColorStop(1, lineCol + '05');
    ctx.beginPath();
    hist.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.lineTo(X(hist.length - 1), by + bh);
    ctx.lineTo(bx, by + bh);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    hist.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.strokeStyle = lineCol;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(X(hist.length - 1), Y(hist[hist.length - 1]), 6, 0, Math.PI * 2);
    ctx.fillStyle = lineCol;
    ctx.fill();
    ctx.restore();

    ctx.font = F(400, 21);
    ctx.fillStyle = C.sub;
    ctx.textAlign = 'right';
    ctx.fillText(`近 ${hist.length} 期走势`, bx + bw, by - 18);
    ctx.textAlign = 'left';
  }

  /* 三项指标条 */
  const statY = cardY + cardH + 28, statH = 128;
  ctx.save();
  ctx.shadowColor = 'rgba(16,24,40,.06)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#fff';
  roundRectPath(ctx, SHARE_PX, statY, CW, statH, 26);
  ctx.fill();
  ctx.restore();

  const cols = [
    { label: '累计投入', value: money(s.invested, cur), color: C.text },
    { label: '当前市值', value: money(s.value, cur), color: C.text },
    { label: '累计收益', value: signed(s.gain, cur), color: tone(s.gain) },
  ];
  const colW = CW / 3;
  cols.forEach((c, i) => {
    const cx = SHARE_PX + colW * i + colW / 2;
    if (i) {
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(SHARE_PX + colW * i, statY + 30);
      ctx.lineTo(SHARE_PX + colW * i, statY + statH - 30);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.font = F(400, 23);
    ctx.fillStyle = C.sub;
    ctx.fillText(c.label, cx, statY + 46);
    ctx.font = F(600, 36);
    ctx.fillStyle = c.color;
    ctx.fillText(c.value, cx, statY + 96);
  });
  ctx.textAlign = 'left';

  /* 组合明细标题 */
  ctx.font = F(600, 30);
  ctx.fillStyle = C.text;
  ctx.fillText('组合明细', SHARE_PX, 720);
  ctx.textAlign = 'right';
  ctx.font = F(400, 23);
  ctx.fillStyle = C.sub;
  ctx.fillText(`${cur} 计价`, SHARE_W - SHARE_PX, 720);
  ctx.textAlign = 'left';

  /* 组合行 */
  shown.forEach((pf, i) => {
    const y = LIST_TOP + i * ROW_H;
    const rh = 96;
    const l = pf.latest;
    const lineCol = tone(l.returnPct);

    ctx.save();
    ctx.shadowColor = 'rgba(16,24,40,.05)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#fff';
    roundRectPath(ctx, SHARE_PX, y, CW, rh, 22);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = lineCol;
    roundRectPath(ctx, SHARE_PX, y + 22, 6, rh - 44, 3);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.font = F(600, 30);
    ctx.fillStyle = C.text;
    ctx.fillText(ellipsis(ctx, pf.name, 440), SHARE_PX + 34, y + 42);

    ctx.font = F(400, 22);
    ctx.fillStyle = C.sub;
    ctx.fillText(ellipsis(ctx, pf.allocation || '未填写配置', 600), SHARE_PX + 34, y + 74);

    ctx.textAlign = 'right';
    ctx.font = F(700, 34);
    ctx.fillStyle = lineCol;
    ctx.fillText(pct(l.returnPct), SHARE_PX + CW - 34, y + 44);
    ctx.font = F(400, 23);
    ctx.fillStyle = C.sub;
    ctx.fillText(signed(l.gain, pf.currency), SHARE_PX + CW - 34, y + 76);
    ctx.textAlign = 'left';
  });

  if (moreH) {
    ctx.textAlign = 'center';
    ctx.font = F(400, 23);
    ctx.fillStyle = C.sub;
    ctx.fillText(`等共 ${withData.length} 个组合`, SHARE_W / 2, LIST_TOP + shown.length * ROW_H + 8);
    ctx.textAlign = 'left';
  }

  /* 页脚 */
  const footY = H - 92;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(SHARE_PX, footY - 36);
  ctx.lineTo(SHARE_W - SHARE_PX, footY - 36);
  ctx.stroke();

  ctx.font = F(400, 22);
  ctx.fillStyle = C.sub;
  ctx.fillText('数据为手动录入的月度快照，仅供参考', SHARE_PX, footY + 4);
  ctx.textAlign = 'right';
  ctx.fillText(`生成于 ${new Date().toLocaleDateString('sv-SE')}`, SHARE_W - SHARE_PX, footY + 4);
  ctx.textAlign = 'left';

  return cvs;
}

function openShare() {
  const o = state.overview;
  if (!o || !o.portfolios.some((p) => p.latest)) {
    toast('还没有已录入数据的组合，先录一条再分享', true);
    return;
  }
  const cvs = buildShareCanvas();
  const url = cvs.toDataURL('image/png');
  $('#shareImg').src = url;
  $('#shareMeta').textContent = `尺寸 ${cvs.width} × ${cvs.height} · PNG · 长按或点「下载图片」保存`;
  $('#btnDownloadShare').onclick = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `投资组合收益-${o.summary.currentMonth}.png`;
    a.click();
  };
  openModal('#modalShare');
}

function openPortfolioModal(pf) {
  const f = $('#formPortfolio');
  f.reset();
  f.id.value = pf?.id || '';
  f.name.value = pf?.name || '';
  f.allocation.value = pf?.allocation || '';
  f.dcaPlan.value = pf?.dca_plan || pf?.dcaPlan || '';
  f.currency.value = pf?.currency || 'USD';
  $('#pfModalTitle').textContent = pf ? '编辑组合' : '新增组合';
  openModal('#modalPortfolio');
  setTimeout(() => f.name.focus(), 50);
}

function openRecordModal(pfId, record) {
  const f = $('#formRecord');
  f.reset();
  const sel = $('#recPortfolio');
  sel.innerHTML = state.overview.portfolios
    .map((p) => `<option value="${p.id}">${esc(p.name)}（${SYM[p.currency]}）</option>`)
    .join('');
  if (!sel.options.length) {
    toast('请先新增一个组合', true);
    return;
  }
  f.recordId.value = record?.id || '';
  f.portfolioId.value = pfId ?? sel.options[0].value;
  f.month.value = record?.month || state.overview.summary.currentMonth;
  if (record) {
    f.invested.value = record.invested;
    f.value.value = record.value;
    f.note.value = record.note || '';
  }
  updateRecHint();
  openModal('#modalRecord');
  setTimeout(() => f.invested.focus(), 50);
}

function updateRecHint() {
  const pf = state.overview.portfolios.find((p) => String(p.id) === $('#recPortfolio').value);
  const m = $('#recMonth').value;
  const exist = pf?.history.find((r) => r.month === m);
  $('#recHint').textContent = exist
    ? `⚠ ${pf.name} 在 ${m} 已有记录（投入 ${money(exist.invested, pf.currency)}），保存将覆盖。`
    : `投入本金填累计数；计价币种 ${pf ? SYM[pf.currency] : ''}。同一月份重复提交会覆盖旧值。`;
}

async function openSettings() {
  state.settings = await api('/settings');
  const f = $('#formSettings');
  f.fx_source.value = state.settings.fx_source;
  f.fx_usd_cny.value = state.settings.fx_usd_cny;
  f.fx_hkd_cny.value = state.settings.fx_hkd_cny;
  openModal('#modalSettings');
}

/* ---------------- 事件绑定 ---------------- */
function bind() {
  $('#btnAddPortfolio').onclick = () => openPortfolioModal();
  $('#btnAddRecord').onclick = () => openRecordModal();
  $('#btnSettings').onclick = openSettings;
  $('#btnShare').onclick = openShare;

  const logout = $('#btnLogout');
  if (logout) {
    logout.onclick = async () => {
      const ok = await confirmSimple({
        title: '退出登录',
        text: '退出后需要重新输入密码才能查看数据。在公共设备上建议退出。',
        okText: '退出登录',
      });
      if (!ok) return;
      try { await fetch('/api/logout', { method: 'POST' }); } catch { /* 忽略 */ }
      location.replace('/login');
    };
  }

  $$('.modal [data-close]').forEach((b) => (b.onclick = (e) => e.target.closest('.modal').classList.remove('open')));

  $('#formPortfolio').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const payload = { name: f.name.value, allocation: f.allocation.value, dcaPlan: f.dcaPlan.value, currency: f.currency.value };
    if (f.id.value) {
      const old = state.overview.portfolios.find((p) => String(p.id) === String(f.id.value));
      const ok = await confirmTyping({
        title: '修改组合',
        text: `将修改组合「${old?.name || ''}」的信息。已有 ${old?.recordCount ?? 0} 个月度记录会保留；如改了计价币种，历史金额不会自动换算。`,
        okText: '保存修改',
        danger: false,
      });
      if (!ok) return;
    }
    try {
      if (f.id.value) await api(`/portfolios/${f.id.value}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/portfolios', { method: 'POST', body: JSON.stringify(payload) });
      closeModal('#modalPortfolio');
      toast('已保存');
      await refresh();
    } catch (err) { toast(err.message, true); }
  };

  $('#formRecord').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const pfId = Number(f.portfolioId.value);
    const pf = state.overview.portfolios.find((p) => p.id === pfId);
    const payload = { portfolioId: pfId, month: f.month.value, invested: f.invested.value, value: f.value.value, note: f.note.value };
    const isEdit = !!f.recordId.value;
    const exist = pf?.history.find((r) => r.month === f.month.value);
    if (pf && (isEdit || exist)) {
      const text = isEdit
        ? `将「${pf.name}」${f.month.value} 的记录改为：投入 ${money(payload.invested, pf.currency)}、市值 ${money(payload.value, pf.currency)}。`
        : `「${pf.name}」在 ${f.month.value} 已有记录（投入 ${money(exist.invested, pf.currency)}、市值 ${money(exist.value, pf.currency)}），继续将覆盖为新数据。`;
      const ok = await confirmTyping({
        title: isEdit ? '修改记录' : '覆盖已有记录',
        text,
        okText: isEdit ? '保存修改' : '覆盖保存',
        danger: false,
      });
      if (!ok) return;
    }
    try {
      await api('/records', { method: 'POST', body: JSON.stringify(payload) });
      closeModal('#modalRecord');
      toast(isEdit ? '已更新' : '已录入');
      await refresh();
    } catch (err) { toast(err.message, true); }
  };

  $('#recPortfolio').onchange = updateRecHint;
  $('#recMonth').onchange = updateRecHint;

  $('#formSettings').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ fx_source: f.fx_source.value, fx_usd_cny: f.fx_usd_cny.value, fx_hkd_cny: f.fx_hkd_cny.value }),
      });
      closeModal('#modalSettings');
      toast('设置已保存');
      await refresh(true);
    } catch (err) { toast(err.message, true); }
  };

  $('#btnExport').onclick = async () => {
    const data = await api('/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `portfolio-backup-${new Date().toLocaleDateString('sv-SE')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async (file, mode) => {
    if (mode === 'replace') {
      const ok = await confirmTyping({
        title: '替换导入',
        text: '将清空当前全部组合与月度记录，再导入文件内容。此操作不可恢复，建议先导出备份。',
        okText: '清空并导入',
      });
      if (!ok) return;
    }
    const text = await file.text();
    try {
      const r = await api('/import', { method: 'POST', body: JSON.stringify({ data: text, mode }) });
      toast(`导入成功：${r.portfolios} 个组合、${r.records} 条记录`);
      await refresh();
    } catch (err) { toast(err.message, true); }
  };

  $('#fileImport').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await doImport(file, 'merge');
  };

  $('#fileImportReplace').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await doImport(file, 'replace');
  };

  $('#trendMode').onclick = (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    state.trendMode = b.dataset.mode;
    $$('#trendMode button').forEach((x) => x.classList.toggle('active', x === b));
    renderTrend();
  };

  // 组合卡片操作（事件委托）
  $('#pfList').onclick = async (e) => {
    const card = e.target.closest('.pf-card');
    const pfId = card?.dataset.pf;
    const pf = state.overview.portfolios.find((p) => String(p.id) === pfId);
    if (e.target.closest('[data-rec]')) return openRecordModal(Number(pfId));
    if (e.target.closest('[data-edit-pf]')) return openPortfolioModal(pf);
    if (e.target.closest('[data-toggle-his]')) {
      state.expanded.has(Number(pfId)) ? state.expanded.delete(Number(pfId)) : state.expanded.add(Number(pfId));
      return renderPortfolios();
    }
    if (e.target.closest('[data-del-pf]')) {
      const ok = await confirmTyping({
        title: '删除组合',
        text: `将删除「${pf.name}」及其全部 ${pf.recordCount} 个月度记录，汇总会重新计算，此操作不可恢复。`,
        okText: '永久删除',
      });
      if (!ok) return;
      try { await api(`/portfolios/${pfId}`, { method: 'DELETE' }); toast('已删除'); await refresh(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest('[data-edit-rec]')) {
      const btn = e.target.closest('[data-edit-rec]');
      const rec = pf.history.find((r) => String(r.id) === btn.dataset.editRec);
      return openRecordModal(Number(btn.dataset.pf || pfId), rec);
    }
    if (e.target.closest('[data-del-rec]')) {
      const id = e.target.closest('[data-del-rec]').dataset.delRec;
      const ok = await confirmTyping({
        title: '删除记录',
        text: `将删除该月记录，汇总与走势会重新计算，此操作不可恢复。`,
        okText: '永久删除',
      });
      if (!ok) return;
      try { await api(`/records/${id}`, { method: 'DELETE' }); toast('已删除'); await refresh(); }
      catch (err) { toast(err.message, true); }
    }
  };

  // 明细表操作
  $('#detailTable').onclick = async (e) => {
    const editBtn = e.target.closest('[data-edit-rec]');
    const delBtn = e.target.closest('[data-del-rec]');
    if (editBtn) {
      const pf = state.overview.portfolios.find((p) => String(p.id) === editBtn.dataset.pf);
      const rec = pf?.history.find((r) => String(r.id) === editBtn.dataset.editRec);
      if (rec) openRecordModal(pf.id, rec);
      return;
    }
    if (delBtn) {
      const ok = await confirmTyping({
        title: '删除记录',
        text: '将删除该月记录，汇总与走势会重新计算，此操作不可恢复。',
        okText: '永久删除',
      });
      if (!ok) return;
      try { await api(`/records/${delBtn.dataset.delRec}`, { method: 'DELETE' }); toast('已删除'); await refresh(); }
      catch (err) { toast(err.message, true); }
    }
  };
}

async function refresh(forceFx = false) {
  state.overview = await api('/overview' + (forceFx ? '?force=1' : ''));
  renderAll();
}

bind();
refresh().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<div style="padding:40px;text-align:center;color:var(--danger)">加载失败：${esc(err.message)}</div>`);
});
