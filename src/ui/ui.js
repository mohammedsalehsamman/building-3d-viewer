// DOM user interface (Arabic, RTL): toolbar, floor list, info card, schedule, panels.
import { TYPES, STATUS, typeOf } from '../program/types.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n, d = 1) => Number(n).toLocaleString('ar-LB', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = (n) => Number(n).toLocaleString('ar-LB', { maximumFractionDigits: 0 });

const ICON = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
  explode: '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M12 2v2M12 20v2"/>',
  xray: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16" stroke-dasharray="2 2"/>',
  section: '<path d="M4 20L20 4"/><rect x="3" y="3" width="18" height="18" rx="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="M10 22l2-7 3 3v4M8 12l3-4 4 2 3 3"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

export function initUI(app) {
  const { program } = app;
  const S = app.summary;

  /* ---------- toolbar ---------- */
  const tools = [
    { id: 'home', t: 'المبنى كاملاً', run: () => { app.selectLevel(null); app.resetView(); } },
    { id: 'explode', t: 'تفكيك الطوابق', toggle: 'exploded' },
    { id: 'xray', t: 'شفافية الواجهات', toggle: 'xray' },
    { id: 'section', t: 'مقطع', panel: '#panel-section' },
    { id: 'sun', t: 'الشمس والظلال', panel: '#panel-sun' },
    { id: 'layers', t: 'الطبقات', panel: '#panel-layers' },
    { id: 'walk', t: 'تجوّل', run: () => app.walk() },
    { id: 'table', t: 'جدول المساحات', run: () => openSchedule() },
    { id: 'camera', t: 'لقطة', run: () => app.screenshot() },
  ];
  const tb = $('#toolbar');
  tb.innerHTML = tools.map((t) => `<button class="tbtn" data-id="${t.id}" title="${t.t}">${svg(t.id)}<span class="t">${t.t}</span></button>`).join('');
  tb.addEventListener('click', (e) => {
    const b = e.target.closest('.tbtn');
    if (!b) return;
    const t = tools.find((x) => x.id === b.dataset.id);
    if (t.run) t.run();
    if (t.toggle) app.toggle(t.toggle);
    if (t.panel) {
      const p = $(t.panel);
      const show = p.classList.contains('hidden');
      document.querySelectorAll('.float-panel').forEach((x) => x.classList.add('hidden'));
      p.classList.toggle('hidden', !show);
    }
    syncToolbar();
  });
  function syncToolbar() {
    tb.querySelectorAll('.tbtn').forEach((b) => {
      const t = tools.find((x) => x.id === b.dataset.id);
      let on = false;
      if (t.toggle) on = !!app.state[t.toggle];
      if (t.panel) on = !$(t.panel).classList.contains('hidden');
      if (t.id === 'section') on = on || app.state.section.on;
      b.classList.toggle('on', on);
    });
  }

  /* ---------- floors ---------- */
  const floorSummary = (L) => {
    const units = L.spaces.filter((s) => s.kind === 'unit');
    const by = (t) => units.filter((s) => s.type === t);
    if (L.use === 'parking') return `${by('parking').length} موقف`;
    if (L.use === 'commercial') return `${by('shop').length} محلات · ${fmt(by('shop').reduce((a, s) => a + s.area, 0), 0)} م²`;
    if (L.use === 'offices') return `${by('office').length} مكاتب · ${fmt(by('office').reduce((a, s) => a + s.area, 0), 0)} م²`;
    if (L.use === 'residential') return `${by('studio').length} استوديو × ${fmt(by('studio')[0]?.area || 0)} م²`;
    return 'مقهى داخلي + تراس';
  };
  const fl = $('#floors');
  fl.innerHTML = `<h3>الطوابق</h3>
    <button class="floor floor-all" data-level=""><span class="tag">الكل</span><span><div class="nm">المبنى كاملاً</div><div class="sm">${program.levels.length} مستويات</div></span></button>
    ${program.levels.slice().reverse().map((L) => `
      <button class="floor" data-level="${L.id}">
        <span class="tag">${L.short}</span>
        <span><div class="nm">${esc(L.name)}</div><div class="sm">${floorSummary(L)}</div></span>
      </button>`).join('')}`;
  fl.addEventListener('click', (e) => {
    const b = e.target.closest('.floor');
    if (!b) return;
    app.selectLevel(b.dataset.level || null, { fly: true });
  });
  const syncFloors = () => fl.querySelectorAll('.floor').forEach((b) => b.classList.toggle('on', (b.dataset.level || null) === app.state.level));

  /* ---------- info card ---------- */
  const info = $('#info');
  function renderInfo() {
    const sp = app.state.space ? program.byId[app.state.space] : null;
    if (!sp) { info.classList.add('hidden'); return; }
    const L = program.levels.find((l) => l.id === sp.levelId);
    const T = typeOf(sp.type);
    const d = app.unitData(sp.id);
    const bal = sp.balcony?.area || 0;
    const rows = [
      ['المساحة الصافية', `${fmt(sp.area)} م²`],
      bal ? ['البلكون', `${fmt(bal)} م²`] : null,
      bal ? ['المجموع', `${fmt(sp.area + bal)} م²`] : null,
      sp.meta.orientation ? ['الاتجاه', `${sp.meta.orientation} (${sp.meta.bearing}°)`] : null,
      sp.meta.views?.length ? ['تطل على', sp.meta.views.join('، ')] : null,
      sp.meta.frontage ? ['طول الواجهة', `${fmt(sp.meta.frontage, 2)} م`] : null,
      ['الطابق', `${L.short} · منسوب ${L.elev >= 0 ? '+' : ''}${fmt(L.elev, 2)} م`],
    ].filter(Boolean);
    const isUnit = sp.kind === 'unit';
    const content = {
      studio: 'مدخل خاص، حمام بدُش، مطبخ مفتوح مع ثلاجة، منطقة نوم (سرير مزدوج + خزانة)، منطقة جلوس وطاولة طعام، بلكون.',
      shop: 'محل بواجهة زجاجية كاملة على الشارع، مظلة فوق الواجهة، ارتفاع صافٍ 4.25 م يسمح بميزانين.',
      office: 'مكتب بواجهة شريطية زجاجية، يتشارك الحمامات والمطبخ على نفس الطابق.',
      parking: 'موقف 2.5 × 5.0 م، الوصول عبر الرامب من الطريق الداخلي.',
      cafe: 'صالة داخلية بواجهات زجاجية وبار، متصلة بالتراس المفتوح.',
    }[sp.type];
    info.innerHTML = `
      <button class="close" aria-label="إغلاق">×</button>
      <h2>${esc(sp.name)}</h2>
      <div class="sub"><span class="chip" style="background:${T.color};color:#222">${T.label}</span> · ${esc(L.name)}</div>
      <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${content ? `<div class="note">${content}</div>` : ''}
      ${sp.meta.note ? `<div class="note">${esc(sp.meta.note)}</div>` : ''}
      ${sp.meta.corner ? '<div class="note"><b>وحدة زاوية</b> — واجهتان على تقاطع الطريقين.</div>' : ''}
      ${isUnit ? `
        <div class="row"><label>الحالة</label>
          <select data-k="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${d.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
        <div class="row"><label>السعر ($)</label><input data-k="price" type="number" min="0" step="1000" value="${d.price ?? ''}" placeholder="أدخل السعر" /></div>
        ${d.price ? `<div class="note">سعر المتر: <b>${fmtInt(d.price / (sp.area + bal * 0.5))} $/م²</b> (البلكون محسوب بنصف مساحته)</div>` : ''}` : ''}
      <div class="row">
        <button class="btn primary" data-act="fly">انتقل إليها</button>
        ${['studio', 'office', 'shop', 'cafe', 'lobby', 'terrace'].includes(sp.type) ? '<button class="btn" data-act="walk">تجوّل داخلها</button>' : ''}
      </div>`;
    info.classList.remove('hidden');
  }
  info.addEventListener('click', (e) => {
    if (e.target.closest('.close')) app.selectSpace(null);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fly') app.flyToSpace(app.state.space);
    if (act === 'walk') app.walk(app.state.space);
  });
  info.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    app.setUnitData(app.state.space, { [k]: k === 'price' ? (e.target.value ? Number(e.target.value) : null) : e.target.value });
    renderInfo();
  });

  /* ---------- tooltip ---------- */
  const tip = $('#tooltip');
  app.on('hover', ({ x, y, html }) => {
    if (!html) { tip.classList.add('hidden'); return; }
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(window.innerWidth - w - 8, x + 14)}px`;
    tip.style.top = `${y + 16}px`;
  });

  /* ---------- panels ---------- */
  const months = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
  const sun = $('#panel-sun');
  const renderSun = () => {
    const s = app.state.sun;
    const hh = Math.floor(s.hour), mm = Math.round((s.hour - hh) * 60);
    sun.innerHTML = `<h4>الشمس والظلال</h4>
      <div>الساعة: <span class="val">${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}</span></div>
      <input type="range" min="5" max="20" step="0.25" value="${s.hour}" data-k="hour" />
      <div class="row"><label>الشهر</label><select data-k="month">${months.map((m, i) => `<option value="${i}" ${i === s.month ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div class="note">موقع الشمس محسوب لخط عرض لبنان (~33.9° شمالاً) بحسب اتجاه الشمال المعتمد في الإعدادات.</div>`;
  };
  renderSun();
  sun.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    app.setSun({ [k]: Number(e.target.value) });
    if (k === 'hour') { const v = sun.querySelector('.val'); const h = app.state.sun.hour; v.textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`; }
  });

  const sec = $('#panel-section');
  const renderSection = () => {
    const s = app.state.section;
    sec.innerHTML = `<h4>مقطع عمودي</h4>
      <label class="chk"><input type="checkbox" data-k="on" ${s.on ? 'checked' : ''}/> تفعيل المقطع</label>
      <div class="seg"><button data-axis="u" class="${s.axis === 'u' ? 'on' : ''}">موازٍ للحد المشترك</button><button data-axis="v" class="${s.axis === 'v' ? 'on' : ''}">عمودي عليه</button></div>
      <input type="range" min="0" max="1" step="0.005" value="${s.pos}" data-k="pos" />
      <div class="note">حرّك المؤشر لقصّ المبنى ورؤية الطوابق من الداخل.</div>`;
  };
  renderSection();
  sec.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (k === 'on') app.setSection({ on: e.target.checked });
    if (k === 'pos') app.setSection({ pos: Number(e.target.value), on: true });
    if (k) { syncToolbar(); if (k === 'pos') sec.querySelector('[data-k=on]').checked = true; }
  });
  sec.addEventListener('click', (e) => {
    const ax = e.target.closest('[data-axis]')?.dataset.axis;
    if (ax) { app.setSection({ axis: ax, on: true }); renderSection(); syncToolbar(); }
  });

  const lay = $('#panel-layers');
  const layerDefs = [['labels', 'أسماء ومساحات الوحدات'], ['furniture', 'الأثاث والتجهيزات'], ['neighbours', 'المحاضر المجاورة'], ['dims', 'حدود وأبعاد المحضر'], ['colors', 'تلوين حسب الاستخدام']];
  lay.innerHTML = `<h4>الطبقات</h4>${layerDefs.map(([k, t]) => `<label class="chk"><input type="checkbox" data-k="${k}" ${app.state[k] ? 'checked' : ''}/> ${t}</label>`).join('')}
    <div class="seg" style="margin-top:10px"><button data-theme="light">فاتح</button><button data-theme="auto" class="on">تلقائي</button><button data-theme="dark">داكن</button></div>`;
  lay.addEventListener('change', (e) => { const k = e.target.dataset.k; if (k) app.setLayer(k, e.target.checked); });
  lay.addEventListener('click', (e) => {
    const t = e.target.closest('[data-theme]')?.dataset.theme;
    if (!t) return;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    lay.querySelectorAll('[data-theme]').forEach((b) => b.classList.toggle('on', b.dataset.theme === t));
    app.onThemeChange?.();
  });

  /* ---------- legend ---------- */
  const used = [...new Set(program.spaces.map((s) => s.type))];
  const order = ['studio', 'shop', 'office', 'cafe', 'terrace', 'parking', 'lobby', 'corridor', 'stair', 'lift', 'ramp', 'service', 'wc', 'kitchen', 'tech'];
  $('#legend').innerHTML = order.filter((t) => used.includes(t)).map((t) => `<span><i style="background:${TYPES[t].color}"></i>${TYPES[t].label}</span>`).join('');

  /* ---------- schedule ---------- */
  const modal = $('#schedule');
  const filt = { type: 'all', level: 'all', status: 'all', min: 0 };
  function openSchedule() { renderSchedule(); modal.classList.remove('hidden'); }
  function rowsFiltered() {
    return program.spaces.filter((s) => s.kind === 'unit')
      .filter((s) => filt.type === 'all' || s.type === filt.type)
      .filter((s) => filt.level === 'all' || s.levelId === filt.level)
      .filter((s) => filt.status === 'all' || app.unitData(s.id).status === filt.status)
      .filter((s) => s.area >= filt.min);
  }
  function renderSchedule() {
    const rows = rowsFiltered();
    const tot = rows.reduce((a, s) => a + s.area, 0), totB = rows.reduce((a, s) => a + (s.balcony?.area || 0), 0);
    const totP = rows.reduce((a, s) => a + (app.unitData(s.id).price || 0), 0);
    const studios = S.studios.length;
    const typeOpts = ['studio', 'shop', 'office', 'parking', 'cafe'].map((t) => `<option value="${t}" ${filt.type === t ? 'selected' : ''}>${TYPES[t].label}</option>`).join('');
    const levelOpts = program.levels.map((l) => `<option value="${l.id}" ${filt.level === l.id ? 'selected' : ''}>${l.short} — ${esc(l.name)}</option>`).join('');
    modal.innerHTML = `<div class="sheet">
      <header><h3>جدول المساحات والوحدات</h3>
        <button class="btn" data-act="csv">تصدير CSV</button>
        <button class="btn" data-act="close">إغلاق</button></header>
      <div class="filters">
        <select data-f="type"><option value="all">كل الأنواع</option>${typeOpts}</select>
        <select data-f="level"><option value="all">كل الطوابق</option>${levelOpts}</select>
        <select data-f="status"><option value="all">كل الحالات</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${filt.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
        <input data-f="min" type="number" min="0" step="5" value="${filt.min || ''}" placeholder="أقل مساحة (م²)" />
      </div>
      <div class="body">
        <div class="stats">
          <div class="stat"><div class="n">${studios}</div><div class="l">استوديو · ${fmt(S.studioArea, 0)} م² + ${fmt(S.balconyArea, 0)} م² بلكونات</div></div>
          <div class="stat"><div class="n">${S.shops.length}</div><div class="l">محلات تجارية · ${fmt(S.shopArea, 0)} م²</div></div>
          <div class="stat"><div class="n">${S.offices.length}</div><div class="l">مكاتب · ${fmt(S.officeArea, 0)} م²</div></div>
          <div class="stat"><div class="n">${S.parking.length}</div><div class="l">موقف سيارة (B1 + B2)</div></div>
          <div class="stat"><div class="n">${fmt(S.grossTotal, 0)}</div><div class="l">م² مساحة بناء إجمالية (${fmt(S.grossAbove, 0)} فوق الأرض)</div></div>
        </div>
        ${S.parking.length < studios ? `<div class="warnbox">عدد المواقف (${S.parking.length}) أقل من عدد الاستوديوهات (${studios}). الأرض صغيرة والرامب يأخذ مساحة كبيرة؛ يمكن مضاعفة العدد تقريباً بأنظمة ركن ميكانيكية (Stackers) في B2، أو تخصيص المواقف للبيع منفصلة.</div>` : ''}
        <table class="sched">
          <thead><tr><th>الرمز</th><th>الطابق</th><th>النوع</th><th>الصافي م²</th><th>بلكون م²</th><th>الاتجاه</th><th>الحالة</th><th>السعر $</th></tr></thead>
          <tbody>${rows.map((s) => {
            const d = app.unitData(s.id);
            const st = STATUS[d.status] || STATUS.available;
            return `<tr data-id="${s.id}">
              <td><span class="sw" style="background:${typeOf(s.type).color}"></span>${esc(s.id)}</td>
              <td>${esc(program.levels.find((l) => l.id === s.levelId).short)}</td>
              <td>${typeOf(s.type).label}</td>
              <td>${fmt(s.area)}</td>
              <td>${s.balcony ? fmt(s.balcony.area) : '—'}</td>
              <td>${esc(s.meta.orientation || '—')}</td>
              <td><span class="chip" style="background:${st.color}">${st.label}</span></td>
              <td>${d.price ? fmtInt(d.price) : '—'}</td></tr>`;
          }).join('')}</tbody>
          <tfoot><tr><td colspan="3">المجموع (${rows.length} وحدة)</td><td>${fmt(tot)}</td><td>${fmt(totB)}</td><td></td><td></td><td>${totP ? fmtInt(totP) : '—'}</td></tr></tfoot>
        </table>
      </div></div>`;
  }
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-act=close]')) { modal.classList.add('hidden'); return; }
    if (e.target.closest('[data-act=csv]')) { exportCsv(); return; }
    const tr = e.target.closest('tr[data-id]');
    if (tr) { modal.classList.add('hidden'); app.selectSpace(tr.dataset.id, { fly: true }); }
  });
  modal.addEventListener('change', (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    filt[f] = f === 'min' ? Number(e.target.value || 0) : e.target.value;
    renderSchedule();
  });
  function exportCsv() {
    const head = ['code', 'level', 'type', 'net_m2', 'balcony_m2', 'orientation', 'status', 'price_usd'];
    const lines = rowsFiltered().map((s) => {
      const d = app.unitData(s.id);
      return [s.id, s.levelId, typeOf(s.type).label, s.area.toFixed(2), (s.balcony?.area || 0).toFixed(2), s.meta.orientation || '', STATUS[d.status]?.label || '', d.price || ''].join(',');
    });
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mahdar-2310-4-schedule.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- walk hint ---------- */
  app.on('walk', (on) => {
    const h = $('#walk-hint');
    h.innerHTML = 'وضع التجوّل: انقر للبدء · <b>W A S D</b> أو الأسهم للحركة · <b>Shift</b> للإسراع · <b>Esc</b> للخروج';
    h.classList.toggle('hidden', !on);
  });

  app.on('state', () => { syncToolbar(); syncFloors(); renderInfo(); });
  syncToolbar(); syncFloors();
  app.on('compass', (deg) => { $('#compass .needle').style.transform = `rotate(${deg}deg)`; });
}
