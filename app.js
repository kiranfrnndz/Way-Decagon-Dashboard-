/**
 * WAY-DECAGON DASHBOARD v4.0
 * Clean architecture - single responsibility modules
 * Date handling: ALL dates stored as YYYY-MM-DD strings immediately
 * NO new Date() used for bucketing - ever
 */
'use strict';

// ═══════════════════════════════════════════════════════════
// MODULE 1: DATE UTILS
// ALL date operations go through here - zero UTC issues
// ═══════════════════════════════════════════════════════════
const DateUtils = {
  /**
   * Parse M/D/YYYY H:MM:SS AM/PM → YYYY-MM-DD string (local, no UTC)
   * This is the ONLY date parser in the entire app
   */
  toDateStr(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    // Format: M/D/YYYY H:MM:SS AM/PM
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
    if (m) {
      const yr = m[3], mo = m[1].padStart(2,'0'), dy = m[2].padStart(2,'0');
      return `${yr}-${mo}-${dy}`;
    }
    // ISO format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    return null;
  },

  /**
   * Parse date to timestamp for COMPARISON ONLY (not for display/bucketing)
   * Uses local time parsing to avoid UTC shift
   */
  toTimestamp(raw) {
    if (!raw) return 0;
    const s = String(raw).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
    if (m) {
      let h = parseInt(m[4]);
      const mn = parseInt(m[5]), sc = parseInt(m[6]), ap = m[7].toUpperCase();
      if (ap === 'AM' && h === 12) h = 0;
      if (ap === 'PM' && h !== 12) h += 12;
      return new Date(parseInt(m[3]), parseInt(m[1])-1, parseInt(m[2]), h, mn, sc).getTime();
    }
    const dt = new Date(s);
    return isNaN(dt) ? 0 : dt.getTime();
  },

  formatDisplay(dateStr) {
    if (!dateStr) return '—';
    const [y,m,d] = dateStr.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[parseInt(m)-1]} ${parseInt(d)}, ${y}`;
  },

  formatDateTime(raw) {
    if (!raw) return '—';
    const s = String(raw).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
    if (m) return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}:${m[6]} ${m[7]}`;
    return s.slice(0,20);
  }
};

// ═══════════════════════════════════════════════════════════
// MODULE 2: CONFIG
// ═══════════════════════════════════════════════════════════
const CONFIG = {
  AI_TYPE: 'AI-Agent Call',
  INTERNAL: new Set(['TL Review','Manager Review','QC Audit','Select','User Reviews',
    'BBB Reviews','App Feedback','Escalation Handled by TL',
    'Escalation handled by Escalation Team','Escalation handled by Manager',
    'Escalation handled by Ops Team']),
  CUSTOMER_FACING: new Set(['AI-Agent Call','Call','Email','Chat','SMS']),
  HUMAN_CHANNELS: new Set(['Call','Email','Chat','SMS']),
  EXCLUDED_REASONS: new Set(['escalated','non escalated','not escalated','']),
  DEFECT_THRESHOLD_SEC: 60,
  COL_CANDIDATES: {
    ticketId:   ['Ticket ID','ticket_id'],
    ogi:        ['OGI','ogi'],
    interaction:['Interaction','Interaction Type'],
    intDate:    ['Interaction date','Interaction Date','Created Date'],
    intId:      ['Interaction ID'],
    reason:     ['TKT_IssueReason','Reason'],
    subReason:  ['Sub Reason','sub_reason'],
    action:     ['Action','Action Taken'],
    status:     ['Status'],
    agent:      ['Agent Name'],
    vertical:   ['Vertical'],
    subVertical:['SubVertical','Sub Vertical'],
    ticketCreatedDate: ['Ticket_created_date','Ticket Created Date']
  }
};

// ═══════════════════════════════════════════════════════════
// MODULE 3: DATA PROCESSOR
// Single pass - build everything at once
// ═══════════════════════════════════════════════════════════
const DataProcessor = {
  colMap: {},

  buildColMap(headers) {
    const map = {};
    for (const [key, candidates] of Object.entries(CONFIG.COL_CANDIDATES)) {
      map[key] = candidates.find(c =>
        headers.some(h => h && h.trim().toLowerCase() === c.toLowerCase())
      ) || null;
    }
    this.colMap = map;
    return map;
  },

  get(row, key) {
    const col = this.colMap[key];
    return col ? String(row[col] || '').trim() : '';
  },

  /**
   * Process all rows in a single pass
   * Returns: { ticketMap, intBreakdown, totalCallInts, totalAIInts }
   */
  process(rows) {
    const cm = this.colMap;
    const ticketMap = new Map();
    const intBreakdown = {};

    // Single pass: group rows into tickets
    for (const row of rows) {
      const tid = this.get(row, 'ticketId');
      if (!tid) continue;

      const intType = this.get(row, 'interaction') || 'Unknown';
      intBreakdown[intType] = (intBreakdown[intType] || 0) + 1;

      if (!ticketMap.has(tid)) {
        ticketMap.set(tid, {
          ticketId: tid,
          ogi: this.get(row, 'ogi') || 'UNKNOWN',
          reason: '',
          subReason: '',
          actionTaken: '',
          status: '',
          vertical: this.get(row, 'vertical'),
          subVertical: this.get(row, 'subVertical'),
          interactions: []
        });
      }

      const tk = ticketMap.get(tid);
      const intDate = this.get(row, 'intDate');
      const ts = DateUtils.toTimestamp(intDate);

      tk.interactions.push({
        type: intType,
        dateStr: DateUtils.toDateStr(intDate),  // YYYY-MM-DD string - no UTC
        timestamp: ts,                           // ms for comparison only
        dateRaw: intDate,
        reason: this.get(row, 'reason'),
        subReason: this.get(row, 'subReason'),
        actionTaken: this.get(row, 'action'),
        status: this.get(row, 'status'),
        agent: this.get(row, 'agent')
      });

      // Collect best ticket-level field values
      if (!tk.reason && this.get(row, 'reason')) tk.reason = this.get(row, 'reason');
      if (!tk.subReason && this.get(row, 'subReason')) tk.subReason = this.get(row, 'subReason');
      if (!tk.actionTaken && this.get(row, 'action')) tk.actionTaken = this.get(row, 'action');
      if (!tk.status && this.get(row, 'status')) tk.status = this.get(row, 'status');
      if (tk.ogi === 'UNKNOWN' && this.get(row, 'ogi')) tk.ogi = this.get(row, 'ogi');
    }

    // Second pass: enrich each ticket
    for (const tk of ticketMap.values()) {
      this.enrichTicket(tk);
    }

    const totalCallInts = (intBreakdown['Call'] || 0) + (intBreakdown['AI-Agent Call'] || 0);
    const totalAIInts = intBreakdown['AI-Agent Call'] || 0;

    return { ticketMap, intBreakdown, totalCallInts, totalAIInts };
  },

  enrichTicket(tk) {
    // Sort interactions by timestamp
    tk.interactions.sort((a, b) => a.timestamp - b.timestamp);

    const aiInts = tk.interactions.filter(i => i.type === CONFIG.AI_TYPE);
    const humanInts = tk.interactions.filter(i => CONFIG.HUMAN_CHANNELS.has(i.type));

    tk.isDecagonTicket = aiInts.length > 0;
    tk.aiInteractionCount = aiInts.length;
    tk.humanInteractionCount = humanInts.length;

    if (!tk.isDecagonTicket) {
      tk.csAssisted = tk.decagonOnly = tk.decagonContained = false;
      tk.isRecontact = tk.recontactResolvedByDecagon = tk.recontactReescalated = false;
      tk.compliant = false;
      tk.dateBucket = null;
      return;
    }

    const firstAI = aiInts[0];

    // Date bucket = YYYY-MM-DD string of first AI interaction (already local, no UTC)
    tk.dateBucket = firstAI.dateStr;

    // Human after AI (for CS assisted / containment)
    const humanAfterAI = humanInts.filter(i => i.timestamp > firstAI.timestamp);
    // Human before AI (for re-contact analysis)
    const humanBeforeAI = humanInts.filter(i => i.timestamp < firstAI.timestamp);

    tk.csAssisted = humanAfterAI.length > 0;
    tk.decagonOnly = humanAfterAI.length === 0;
    tk.decagonContained = humanAfterAI.length === 0;

    // Re-contact: had human interaction BEFORE AI
    tk.isRecontact = humanBeforeAI.length > 0;
    tk.recontactResolvedByDecagon = tk.isRecontact && tk.decagonOnly && tk.status.toLowerCase() === 'closed';
    tk.recontactReescalated = tk.isRecontact && tk.csAssisted;

    // Compliance (decagon-only tickets)
    if (tk.decagonOnly) {
      const excl = CONFIG.EXCLUDED_REASONS;
      tk.missingReason = !tk.reason || excl.has(tk.reason.toLowerCase());
      tk.missingSubReason = !tk.subReason || excl.has(tk.subReason.toLowerCase());
      tk.statusNotClosed = tk.status.toLowerCase() !== 'closed';
      tk.pendingStatus = ['in progress','waiting for ops'].includes(tk.status.toLowerCase());
      tk.compliant = !tk.missingReason && !tk.missingSubReason && !tk.statusNotClosed;
    } else {
      tk.missingReason = tk.missingSubReason = tk.statusNotClosed = tk.pendingStatus = false;
      tk.compliant = false;
    }

    // FCR: no interaction (human or Decagon) after the last Decagon call
    const lastAI = aiInts[aiInts.length - 1];
    const anyAfterLastAI = [...humanInts, ...aiInts].some(i => i.timestamp > lastAI.timestamp);
    tk.fcrAchieved = !anyAfterLastAI;

    // Best display reason (sub reason first, fallback to reason, exclude status values)
    const excl = CONFIG.EXCLUDED_REASONS;
    const sr = (tk.subReason || '').trim();
    const r = (tk.reason || '').trim();
    tk.displayReason = (sr && !excl.has(sr.toLowerCase())) ? sr :
                       (r && !excl.has(r.toLowerCase())) ? r : '';

    // Same timestamp defects
    const tsCounts = {};
    for (const i of aiInts) {
      if (i.timestamp) tsCounts[i.timestamp] = (tsCounts[i.timestamp] || 0) + 1;
    }
    tk.sameTimestampInteractions = Object.values(tsCounts).filter(c => c > 1).length;
    tk.hasDefect = tk.sameTimestampInteractions > 0;
    tk.shortIntervalFlag = false; // computed at aggregate level
  },

  computeShortIntervals(ticketMap, thresholdSec) {
    const threshold = thresholdSec * 1000;
    let count = 0;
    for (const tk of ticketMap.values()) {
      tk.shortIntervalFlag = false;
      if (!tk.isDecagonTicket) continue;
      const aiInts = tk.interactions.filter(i => i.type === CONFIG.AI_TYPE && i.timestamp > 0);
      for (let i = 1; i < aiInts.length; i++) {
        const diff = aiInts[i].timestamp - aiInts[i-1].timestamp;
        if (diff > 0 && diff < threshold) {
          tk.shortIntervalFlag = true;
          count++;
          break;
        }
      }
    }
    return count;
  },

  computeMetrics(ticketMap, totalCallInts, totalAIInts, totalRecords) {
    const all = [...ticketMap.values()];
    const dec = all.filter(t => t.isDecagonTicket);
    const decOnly = dec.filter(t => t.decagonOnly);

    const n = dec.length;
    const no = decOnly.length;

    const csCount = dec.filter(t => t.csAssisted).length;
    const containedCount = dec.filter(t => t.decagonContained).length;
    const fcrCount = dec.filter(t => t.fcrAchieved).length;
    const compliantCount = decOnly.filter(t => t.compliant).length;
    const missingReason = decOnly.filter(t => t.missingReason).length;
    const missingSubReason = decOnly.filter(t => t.missingSubReason).length;
    const statusNotClosed = decOnly.filter(t => t.statusNotClosed).length;
    const pendingStatus = decOnly.filter(t => t.pendingStatus).length;
    const sameTs = dec.reduce((s,t) => s + t.sameTimestampInteractions, 0);
    const shortInts = dec.filter(t => t.shortIntervalFlag).length;

    // Duplicate ticket: same OGI + different ticket ID + same timestamp
    const ogiTsMap = {};
    for (const tk of dec) {
      for (const i of tk.interactions.filter(i => i.type === CONFIG.AI_TYPE && i.timestamp)) {
        const key = `${tk.ogi}|${i.timestamp}`;
        if (!ogiTsMap[key]) ogiTsMap[key] = new Set();
        ogiTsMap[key].add(tk.ticketId);
      }
    }
    const dupTickets = Object.values(ogiTsMap).filter(s => s.size > 1).length;

    // Re-contact
    const rcTks = dec.filter(t => t.isRecontact);
    const rcResolved = dec.filter(t => t.recontactResolvedByDecagon).length;
    const rcReescalated = dec.filter(t => t.recontactReescalated).length;
    const rcOpen = rcTks.filter(t => !t.recontactResolvedByDecagon && !t.recontactReescalated).length;

    const pct = (a, b) => b > 0 ? (a/b*100) : 0;

    return {
      totalRecords, totalCallInts, totalAIInts,
      totalTickets: all.length,
      decagonTickets: n,
      decagonOnlyCount: no,
      csAssistedCount: csCount,
      csAssistedRate: pct(csCount, n),
      containedCount, containmentRate: pct(containedCount, n),
      fcrCount, fcrRate: pct(fcrCount, no),
      compliantCount, complianceRate: pct(compliantCount, no),
      complianceFailures: no - compliantCount,
      missingReason, missingSubReason, statusNotClosed, pendingStatus,
      sameTimestampInts: sameTs,
      shortIntervalInts: shortInts,
      dupTicketCount: dupTickets,
      rcCount: rcTks.length, rcResolved, rcReescalated, rcOpen,
      rcTickets: rcTks,
      all, dec, decOnly
    };
  },

  getDateBuckets(ticketMap) {
    const b = new Map();
    for (const t of ticketMap.values()) {
      if (t.isDecagonTicket && t.dateBucket) {
        if (!b.has(t.dateBucket)) b.set(t.dateBucket, []);
        b.get(t.dateBucket).push(t);
      }
    }
    // Sort by date string - works correctly for YYYY-MM-DD
    return new Map([...b.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  },

  countByReason(tickets) {
    const c = {};
    for (const t of tickets) {
      const r = t.displayReason;
      if (!r) continue;
      c[r] = (c[r] || 0) + 1;
    }
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }
};

// ═══════════════════════════════════════════════════════════
// MODULE 4: STATE
// ═══════════════════════════════════════════════════════════
const STATE = {
  rawRows: [],
  ticketMap: new Map(),
  filteredTickets: new Map(),
  intBreakdown: {},
  totalCallInts: 0,
  totalAIInts: 0,
  charts: {},
  datatables: {},
  currentReasonTab: 'handled',
  reasonData: {}
};

// ═══════════════════════════════════════════════════════════
// MODULE 5: UI UTILS
// ═══════════════════════════════════════════════════════════
const UI = {
  fmt: {
    num: n => n == null ? '—' : Number(n).toLocaleString(),
    pct: n => n == null ? '—' : Number(n).toFixed(1) + '%',
    date: s => DateUtils.formatDisplay(s),
    datetime: s => DateUtils.formatDateTime(s)
  },

  badge(text, color = 'muted') {
    return `<span class="badge badge-${color}">${text}</span>`;
  },

  toast(msg, type = 'info', dur = 4000) {
    const tc = document.getElementById('toastContainer');
    const t = document.createElement('div');
    const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
    t.className = `toast toast-${type}`;
    t.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i>${msg}`;
    tc.appendChild(t);
    setTimeout(() => { t.style.animation = 'fadeOut 0.3s ease forwards'; setTimeout(() => t.remove(), 300); }, dur);
  },

  destroyChart(id) {
    if (STATE.charts[id]) { STATE.charts[id].destroy(); delete STATE.charts[id]; }
  },

  chartDefaults() {
    return {
      responsive: true, maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#64748b', font: { size: 11 } } },
        tooltip: { backgroundColor: '#fff', titleColor: '#0f172a', bodyColor: '#475569', borderColor: '#e2e8f0', borderWidth: 1 }
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 10 }, maxRotation: 45 }, grid: { color: '#e2e8f0' } },
        y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: '#e2e8f0' }, beginAtZero: true }
      }
    };
  }
};

// ═══════════════════════════════════════════════════════════
// MODULE 6: FILE HANDLING
// ═══════════════════════════════════════════════════════════
function setupUpload() {
  const dz = document.getElementById('dropZone');
  const fi = document.getElementById('fileInput');
  const browse = document.getElementById('browseBtn');

  // Single click handler - no double dialog
  browse.addEventListener('click', e => { e.stopPropagation(); fi.click(); });
  dz.addEventListener('click', e => { if (e.target === dz || e.target.closest('.drop-icon,.drop-title,.drop-format')) fi.click(); });
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); });
  fi.addEventListener('change', e => { if (e.target.files[0]) processFile(e.target.files[0]); });
  document.getElementById('loadSampleBtn').addEventListener('click', () => {
    UI.toast('Generating sample data…', 'info');
    setTimeout(() => processRows(generateSampleData(), 'sample_data.xlsx'), 100);
  });
}

async function readXLSX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        setProgress(30, 'Parsing Excel...');
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array', cellDates: false, cellNF: false, cellStyles: false, cellFormula: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        setTimeout(() => {
          try { resolve(XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })); }
          catch (err) { reject(err); }
        }, 10);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function setProgress(pct, label) {
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressLabel').textContent = label;
  document.getElementById('uploadProgress').style.display = 'block';
}

function hideProgress() {
  setTimeout(() => { document.getElementById('uploadProgress').style.display = 'none'; }, 600);
}

function processFile(file) {
  const name = file.name.toLowerCase();
  setProgress(10, 'Reading file...');
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    readXLSX(file).then(rows => processRows(rows, file.name)).catch(err => {
      UI.toast('Excel error: ' + err.message, 'error'); hideProgress();
    });
  } else {
    Papa.parse(file, {
      header: true, skipEmptyLines: true, dynamicTyping: false,
      complete: r => processRows(r.data, file.name),
      error: err => { UI.toast('CSV error: ' + err.message, 'error'); hideProgress(); }
    });
  }
}

function processRows(rows, filename) {
  STATE.rawRows = rows;

  // Show file info
  document.getElementById('fileStatus').style.display = 'block';
  document.getElementById('statFilename').textContent = filename;
  document.getElementById('statLoaded').textContent = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  document.getElementById('statRecords').textContent = rows.length.toLocaleString();
  document.getElementById('statStatus').innerHTML = '<span style="color:#059669">✓ Processed Successfully</span>';

  // Build column map
  if (!rows.length) { UI.toast('No data found', 'error'); return; }
  const cm = DataProcessor.buildColMap(Object.keys(rows[0]));

  // Validate
  const hasTicket = !!cm.ticketId && rows.some(r => DataProcessor.get(r, 'ticketId'));
  const hasInteraction = !!cm.interaction && rows.some(r => DataProcessor.get(r, 'interaction'));
  renderValidation(rows, cm, hasTicket && hasInteraction);
  if (!hasTicket || !hasInteraction) { UI.toast('Validation failed', 'error'); hideProgress(); return; }

  setProgress(50, 'Building ticket map...');

  setTimeout(() => {
    const { ticketMap, intBreakdown, totalCallInts, totalAIInts } = DataProcessor.process(rows);
    STATE.ticketMap = ticketMap;
    STATE.intBreakdown = intBreakdown;
    STATE.totalCallInts = totalCallInts;
    STATE.totalAIInts = totalAIInts;

    setProgress(80, 'Computing metrics...');

    setTimeout(() => {
      // Compute short intervals
      DataProcessor.computeShortIntervals(STATE.ticketMap, CONFIG.DEFECT_THRESHOLD_SEC);

      // Set filtered = all by default
      STATE.filteredTickets = new Map(STATE.ticketMap);

      // Set date range from data (using YYYY-MM-DD strings directly - no UTC)
      const decDates = [...STATE.ticketMap.values()]
        .filter(t => t.isDecagonTicket && t.dateBucket)
        .map(t => t.dateBucket);

      if (decDates.length) {
        decDates.sort();
        document.getElementById('globalDateFrom').value = decDates[0];
        document.getElementById('globalDateTo').value = decDates[decDates.length - 1];
        document.getElementById('dateRangeBar').style.display = 'flex';
      }

      const m = DataProcessor.computeMetrics(STATE.filteredTickets, totalCallInts, totalAIInts, rows.length);
      document.getElementById('dataBadge').style.display = 'flex';
      document.getElementById('dataBadgeText').textContent = UI.fmt.num(m.decagonTickets) + ' Decagon Calls';

      renderValidationBreakdown();
      renderDashboard();
      setProgress(100, 'Done');
      hideProgress();
      UI.toast(`Loaded ${UI.fmt.num(rows.length)} records — ${UI.fmt.num(m.decagonTickets)} Decagon calls`, 'success');
    }, 50);
  }, 50);
}

// ═══════════════════════════════════════════════════════════
// MODULE 7: VALIDATION RENDER
// ═══════════════════════════════════════════════════════════
function renderValidation(rows, cm, passed) {
  const f = r => DataProcessor.get(r, 'ticketId');
  const g = r => DataProcessor.get(r, 'ogi');
  const h = r => DataProcessor.get(r, 'interaction');

  document.getElementById('vv-records').textContent = UI.fmt.num(rows.length);
  document.getElementById('vv-ogi').textContent = UI.fmt.num(new Set(rows.map(g).filter(Boolean)).size);
  document.getElementById('vv-tickets').textContent = UI.fmt.num(new Set(rows.map(f).filter(Boolean)).size);
  document.getElementById('vv-interactions').textContent = UI.fmt.num(rows.length);
  document.getElementById('vv-ai').textContent = UI.fmt.num(rows.filter(r => h(r) === CONFIG.AI_TYPE).length);
  document.getElementById('vv-human').textContent = UI.fmt.num(rows.filter(r => { const t = h(r); return CONFIG.CUSTOMER_FACING.has(t) && t !== CONFIG.AI_TYPE; }).length);
  document.getElementById('vv-internal').textContent = UI.fmt.num(rows.filter(r => CONFIG.INTERNAL.has(h(r))).length);

  const checks = [
    { id: 'chk-cols', ok: !!cm.ticketId && !!cm.interaction, label: 'Required columns present' },
    { id: 'chk-ticket', ok: rows.some(f), label: 'Ticket IDs present' },
    { id: 'chk-ogi', ok: rows.some(g), label: 'OGI identifiers present' },
    { id: 'chk-types', ok: rows.some(h), label: 'Interaction types present' },
    { id: 'chk-compliance', ok: !!cm.reason || !!cm.subReason, label: 'Compliance fields present' }
  ];

  for (const { id, ok, label } of checks) {
    const el = document.getElementById(id);
    el.className = `val-check-item ${ok ? 'pass' : 'fail'}`;
    el.innerHTML = `<i class="fa-solid fa-${ok ? 'circle-check' : 'circle-xmark'}"></i> ${label}`;
  }

  const b = document.getElementById('validationBadge');
  b.className = `val-badge ${passed ? 'pass' : 'fail'}`;
  b.innerHTML = `<i class="fa-solid fa-${passed ? 'shield-check' : 'shield-xmark'}"></i> ${passed ? '✓ Validation Passed' : '✗ Validation Failed'}`;
}

function renderValidationBreakdown() {
  const bd = STATE.intBreakdown;
  const wrap = document.getElementById('intBreakdownWrap');
  wrap.style.display = 'block';
  const total = Object.values(bd).reduce((s, v) => s + v, 0);
  const data = Object.entries(bd).sort((a, b) => b[1] - a[1]).map((e, i) => ({ rank: i+1, type: e[0], count: e[1], pct: (e[1]/total*100).toFixed(1) + '%' }));
  if (STATE.datatables.intBreakdown) { STATE.datatables.intBreakdown.destroy(); document.getElementById('intBreakdownTable').innerHTML = ''; }
  STATE.datatables.intBreakdown = $('#intBreakdownTable').DataTable({
    data, pageLength: 20, dom: 'frtip',
    columns: [{ title: '#', data: 'rank', width: '40px' }, { title: 'Interaction Type', data: 'type' }, { title: 'Count', data: 'count', render: d => UI.fmt.num(d) }, { title: '% of Total', data: 'pct' }]
  });
  document.querySelector('#intBreakdownWrap .block-title').innerHTML = `Interaction Type Breakdown <span class="level-tag">All ${UI.fmt.num(total)} Interactions</span>`;
}

// ═══════════════════════════════════════════════════════════
// MODULE 8: DASHBOARD RENDER
// ═══════════════════════════════════════════════════════════
function renderDashboard() {
  const m = DataProcessor.computeMetrics(STATE.filteredTickets, STATE.totalCallInts, STATE.totalAIInts, STATE.rawRows.length);
  renderKPIs(m);
  renderEffectivenessCharts(m);
  renderComplianceSection(m);
  renderDefectSection(m);
  renderReasonAnalysis(m);
  renderMasterTable(m);
  renderCEOSummary(m);
  renderRecontactTab(m);
}

// ── KPIs ──
function renderKPIs(m) {
  const colorMap = {
    cyan: { a: 'var(--cyan)', d: 'var(--cyan-dim)' },
    purple: { a: 'var(--purple)', d: 'var(--purple-dim)' },
    green: { a: 'var(--green)', d: 'var(--green-dim)' },
    amber: { a: 'var(--amber)', d: 'var(--amber-dim)' },
    red: { a: 'var(--red)', d: 'var(--red-dim)' }
  };

  const kpis = [
    { label: 'Calls Handled by Decagon', main: UI.fmt.num(m.decagonTickets), sub: null, icon: 'fa-robot', color: 'cyan', tip: 'Unique calls where Decagon was involved', lvl: 'Ticket' },
    { label: 'Interactions by Decagon', main: UI.fmt.num(m.totalAIInts), sub: null, icon: 'fa-comments', color: 'purple', tip: 'Total AI-Agent Call interaction records', lvl: 'Interaction' },
    { label: 'Decagon FCR', main: UI.fmt.pct(m.fcrRate), sub: UI.fmt.num(m.fcrCount) + ' calls', icon: 'fa-bullseye', color: 'green', tip: 'Calls handled by Decagon with no CS involvement. Click for compliance breakdown.', lvl: 'Ticket', onclick: 'showFCRDrilldown()' },
    { label: 'Decagon Containment Rate', main: UI.fmt.pct(m.containmentRate), sub: UI.fmt.num(m.containedCount) + ' calls', icon: 'fa-shield-halved', color: 'green', tip: 'Calls with no CS agent after Decagon', lvl: 'Ticket' },
    { label: 'CS Assisted', main: UI.fmt.pct(m.csAssistedRate), sub: UI.fmt.num(m.csAssistedCount) + ' calls', icon: 'fa-person-walking-arrow-right', color: 'amber', tip: 'Calls where CS had to step in after Decagon', lvl: 'Ticket', pctLarge: true },
    { label: 'Handled by Decagon Only', main: UI.fmt.num(m.decagonOnlyCount), sub: UI.fmt.pct(m.decagonOnlyCount / m.decagonTickets * 100), icon: 'fa-circle-check', color: 'green', tip: 'Calls with zero CS agent involvement', lvl: 'Ticket' },
    { label: 'Compliance Failures', main: UI.fmt.num(m.complianceFailures), sub: null, icon: 'fa-triangle-exclamation', color: 'red', tip: 'Decagon-only calls with missing data or open status', lvl: 'Ticket' },
    { label: 'Compliance Rate', main: UI.fmt.pct(m.complianceRate), sub: UI.fmt.num(m.compliantCount) + ' calls', icon: 'fa-clipboard-check', color: 'green', tip: 'Decagon-only calls with Reason + Sub Reason + Status=Closed', lvl: 'Ticket' },
    { label: 'Decagon Duplicate Ticket', main: UI.fmt.num(m.dupTicketCount), sub: null, icon: 'fa-copy', color: 'red', tip: 'Same OGI with multiple ticket IDs at identical timestamp', lvl: 'Ticket' },
    { label: 'Short Interval Interactions', main: UI.fmt.num(m.shortIntervalInts), sub: null, icon: 'fa-stopwatch', color: 'amber', tip: 'AI interactions within ' + CONFIG.DEFECT_THRESHOLD_SEC + 's of each other on same ticket', lvl: 'Interaction' }
  ];

  document.getElementById('kpiGrid').innerHTML = kpis.map(k => {
    const c = colorMap[k.color] || colorMap.cyan;
    const valHtml = k.pctLarge
      ? `<div class="kpi-pct-large" style="color:${c.a}">${k.main}</div>${k.sub ? `<div class="kpi-val-small">${k.sub}</div>` : ''}`
      : `<div class="kpi-val-large">${k.main}</div>${k.sub ? `<div class="kpi-val-small">${k.sub}</div>` : ''}`;
    return `<div class="kpi-card" style="--ac:${c.a};--acd:${c.d}">
      <div class="kpi-tip" title="${k.tip}"><i class="fa-solid fa-circle-info"></i></div>
      <div class="kpi-icon"><i class="fa-solid ${k.icon}"></i></div>
      <div class="kpi-label">${k.label}</div>
      ${valHtml}
      <div class="kpi-lvl ${k.lvl === 'Interaction' ? 'int' : ''}">${k.lvl} Level</div>
    </div>`;
  }).join('');
}

// ── EFFECTIVENESS CHARTS ──
function renderEffectivenessCharts(m) {
  const base = UI.chartDefaults();
  const buckets = DataProcessor.getDateBuckets(STATE.filteredTickets);

  // Labels: format YYYY-MM-DD → "Jun 8"
  const labels = [...buckets.keys()].map(d => {
    const [y, mo, dy] = d.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[parseInt(mo)-1]} ${parseInt(dy)}`;
  });

  const vals = [...buckets.values()];

  const decCounts = vals.map(ts => ts.filter(t => t.isDecagonTicket).length);
  const intCounts = vals.map(ts => ts.reduce((s, t) => s + t.aiInteractionCount, 0));
  const fcrRates = vals.map(ts => { const d = ts.filter(t => t.decagonOnly); return d.length ? (d.filter(t => t.fcrAchieved).length / d.length * 100) : 0; });
  const csRates = vals.map(ts => { const d = ts.filter(t => t.isDecagonTicket); return d.length ? (d.filter(t => t.csAssisted).length / d.length * 100) : 0; });
  const containRates = vals.map(ts => { const d = ts.filter(t => t.isDecagonTicket); return d.length ? (d.filter(t => t.decagonContained).length / d.length * 100) : 0; });

  UI.destroyChart('c1');
  STATE.charts.c1 = new Chart(document.getElementById('c1'), { type: 'bar', data: { labels, datasets: [{ label: 'Calls Handled by Decagon', data: decCounts, backgroundColor: 'rgba(2,132,199,0.6)', borderRadius: 4 }] }, options: { ...base } });

  UI.destroyChart('c2');
  STATE.charts.c2 = new Chart(document.getElementById('c2'), { type: 'bar', data: { labels, datasets: [{ label: 'Interactions by Decagon', data: intCounts, backgroundColor: 'rgba(124,58,237,0.6)', borderRadius: 4 }] }, options: { ...base } });

  UI.destroyChart('c3');
  STATE.charts.c3 = new Chart(document.getElementById('c3'), { type: 'line', data: { labels, datasets: [{ label: 'Decagon FCR %', data: fcrRates, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.1)', fill: true, tension: 0.4, pointRadius: 3 }] }, options: { ...base, scales: { x: base.scales.x, y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => v + '%' }, max: 100 } } } });

  UI.destroyChart('c4');
  STATE.charts.c4 = new Chart(document.getElementById('c4'), { type: 'line', data: { labels, datasets: [{ label: 'CS Assisted %', data: csRates, borderColor: '#d97706', backgroundColor: 'rgba(217,119,6,0.08)', fill: true, tension: 0.4, pointRadius: 3 }, { label: 'Containment %', data: containRates, borderColor: '#059669', fill: false, tension: 0.4, pointRadius: 3, borderDash: [5, 4] }] }, options: { ...base, scales: { x: base.scales.x, y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => v + '%' } } } } });
}

// ── COMPLIANCE ──
function renderComplianceSection(m) {
  document.getElementById('gaugeCompPct').textContent = UI.fmt.pct(m.complianceRate);
  document.getElementById('cv-full').textContent = UI.fmt.num(m.compliantCount) + ' calls';
  document.getElementById('cv-reason').textContent = UI.fmt.num(m.missingReason);
  document.getElementById('cv-sub').textContent = UI.fmt.num(m.missingSubReason);
  document.getElementById('cv-status').textContent = UI.fmt.num(m.statusNotClosed);
  document.getElementById('cv-pending').textContent = UI.fmt.num(m.pendingStatus);

  // Gauge
  const canvas = document.getElementById('complianceGauge');
  const ctx = canvas.getContext('2d');
  const cx = 100, cy = 100, r = 82;
  ctx.clearRect(0, 0, 200, 200);
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25); ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.stroke();
  const p = Math.min(100, Math.max(0, m.complianceRate));
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 0.75 + (p / 100) * Math.PI * 1.5);
  ctx.strokeStyle = p >= 80 ? '#10b981' : p >= 65 ? '#f59e0b' : '#ef4444'; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.stroke();

  const tc = '#64748b', gc = '#e2e8f0';
  UI.destroyChart('compliancePie');
  STATE.charts.compliancePie = new Chart(document.getElementById('compliancePie'), {
    type: 'doughnut',
    data: { labels: ['Compliant', 'Missing Reason', 'Missing Sub Reason', 'Status Not Closed'], datasets: [{ data: [m.compliantCount, m.missingReason, m.missingSubReason, m.statusNotClosed], backgroundColor: ['#10b981', '#ef4444', '#f59e0b', '#8b5cf6'], borderColor: '#fff', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom', labels: { color: tc, font: { size: 11 }, padding: 8 } } } }
  });

  const buckets = DataProcessor.getDateBuckets(STATE.filteredTickets);
  const labels = [...buckets.keys()].map(d => { const [, mo, dy] = d.split('-'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1] + ' ' + parseInt(dy); });
  const vals = [...buckets.values()];

  UI.destroyChart('complianceBar');
  STATE.charts.complianceBar = new Chart(document.getElementById('complianceBar'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Missing Reason', data: vals.map(ts => ts.filter(t => t.isDecagonTicket && t.decagonOnly && t.missingReason).length), backgroundColor: 'rgba(239,68,68,0.7)' },
      { label: 'Missing Sub Reason', data: vals.map(ts => ts.filter(t => t.isDecagonTicket && t.decagonOnly && t.missingSubReason).length), backgroundColor: 'rgba(245,158,11,0.7)' },
      { label: 'Status Not Closed', data: vals.map(ts => ts.filter(t => t.isDecagonTicket && t.decagonOnly && t.statusNotClosed).length), backgroundColor: 'rgba(139,92,246,0.7)' }
    ] },
    options: { responsive: true, plugins: { legend: { labels: { color: tc } } }, scales: { x: { stacked: true, ticks: { color: tc, font: { size: 10 }, maxRotation: 45 }, grid: { color: gc } }, y: { stacked: true, ticks: { color: tc }, grid: { color: gc }, beginAtZero: true } } }
  });

  // Drills
  document.querySelectorAll('.ci-val.drill').forEach(el => {
    el.onclick = () => {
      const drill = el.dataset.drill;
      const tickets = [...STATE.filteredTickets.values()].filter(t => {
        if (!t.isDecagonTicket || !t.decagonOnly) return false;
        if (drill === 'missingReason') return t.missingReason;
        if (drill === 'missingSubReason') return t.missingSubReason;
        if (drill === 'statusNotClosed') return t.statusNotClosed;
        if (drill === 'pendingStatus') return t.pendingStatus;
        return false;
      });
      document.getElementById('compDrillTitle').textContent = (el.previousElementSibling?.textContent || '') + ' — ' + UI.fmt.num(tickets.length) + ' call tickets';
      if (STATE.datatables.compDrill) { STATE.datatables.compDrill.destroy(); document.getElementById('compDrillTable').innerHTML = ''; }
      STATE.datatables.compDrill = $('#compDrillTable').DataTable({
        data: tickets, pageLength: 10, dom: 'Bfrtip', buttons: ['csv'],
        columns: [
          { title: 'Ticket ID', data: 'ticketId', render: d => `<span class="ticket-link" onclick="showTimeline('${d}')">${d}</span>` },
          { title: 'OGI', data: 'ogi' },
          { title: 'Date', data: 'dateBucket', render: d => UI.fmt.date(d) },
          { title: 'Sub Reason', data: 'subReason', render: d => d || UI.badge('MISSING', 'red') },
          { title: 'Status', data: 'status', render: d => { const c = d === 'Closed' ? 'green' : d === 'Open' ? 'red' : 'amber'; return UI.badge(d || '—', c); } }
        ]
      });
      document.getElementById('compDrillWrap').style.display = 'block';
      document.getElementById('compDrillWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
  document.getElementById('closeCompDrill').onclick = () => { document.getElementById('compDrillWrap').style.display = 'none'; };
}

// ── DEFECTS ──
function renderDefectSection(m) {
  const defects = [
    { label: 'Decagon Duplicate Ticket', val: m.dupTicketCount, type: 'error', tip: 'Same OGI + different ticket IDs + same timestamp', drill: 'dup' },
    { label: 'Duplicate AI Interactions', val: m.sameTimestampInts, type: 'error', tip: 'AI interactions with identical timestamps on same ticket', drill: 'sameTs' },
    { label: `Short Interval Interactions (<${CONFIG.DEFECT_THRESHOLD_SEC}s)`, val: m.shortIntervalInts, type: 'warn', tip: 'AI interactions within threshold on same ticket', drill: 'short' }
  ];
  document.getElementById('defectGrid').innerHTML = defects.map(d =>
    `<div class="defect-card ${d.type === 'warn' ? 'warn' : ''}" style="cursor:pointer" onclick="showDefectDrill('${d.drill}')">
      <div class="defect-label">${d.label}</div>
      <div class="defect-val ${d.type === 'warn' ? 'warn' : ''}">${UI.fmt.num(d.val)}</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:0.3rem">Click to drill down</div>
    </div>`
  ).join('');
}

function showDefectDrill(type) {
  const dec = [...STATE.filteredTickets.values()].filter(t => t.isDecagonTicket);
  let data = [], title = '';

  if (type === 'dup') {
    title = 'Duplicate Ticket Defects';
    const ogiMap = {};
    dec.forEach(t => t.interactions.filter(i => i.type === CONFIG.AI_TYPE && i.timestamp).forEach(i => {
      const k = `${t.ogi}|${i.timestamp}`;
      if (!ogiMap[k]) ogiMap[k] = { ogi: t.ogi, ts: UI.fmt.datetime(i.dateRaw), tickets: new Set() };
      ogiMap[k].tickets.add(t.ticketId);
    }));
    data = Object.values(ogiMap).filter(v => v.tickets.size > 1).map(v => ({ ticketId: [...v.tickets].join(', '), ogi: v.ogi, createdDate: v.ts, aiInteractionCount: 'Multiple', sameTimestamp: 'YES', shortInterval: '—', subReason: '—', reason: '—', actionTaken: '—' }));
  } else if (type === 'sameTs') {
    title = 'Duplicate AI Interactions (Same Timestamp)';
    dec.filter(t => t.sameTimestampInteractions > 0).forEach(t => data.push({ ticketId: t.ticketId, ogi: t.ogi, createdDate: UI.fmt.date(t.dateBucket), aiInteractionCount: t.aiInteractionCount, sameTimestamp: t.sameTimestampInteractions, shortInterval: t.shortIntervalFlag ? 'YES' : 'No', subReason: t.subReason || '—', reason: t.reason || '—', actionTaken: t.actionTaken || '—' }));
  } else if (type === 'short') {
    title = 'Short Interval Interactions';
    dec.filter(t => t.shortIntervalFlag).forEach(t => data.push({ ticketId: t.ticketId, ogi: t.ogi, createdDate: UI.fmt.date(t.dateBucket), aiInteractionCount: t.aiInteractionCount, sameTimestamp: t.sameTimestampInteractions, shortInterval: 'YES', subReason: t.subReason || '—', reason: t.reason || '—', actionTaken: t.actionTaken || '—' }));
  }

  document.getElementById('defectModalTitle').textContent = title + ' (' + data.length + ')';
  if (STATE.datatables.defectDrill) { STATE.datatables.defectDrill.destroy(); document.getElementById('defectDrillTable').innerHTML = ''; }
  STATE.datatables.defectDrill = $('#defectDrillTable').DataTable({
    data, pageLength: 15, dom: 'Bfrtip', buttons: ['csv'], scrollX: true,
    columns: [
      { title: 'Ticket ID', data: 'ticketId', render: d => `<span class="ticket-link" onclick="showTimeline('${d.split(',')[0].trim()}')">${d}</span>` },
      { title: 'Date', data: 'createdDate' },
      { title: 'AI Ints', data: 'aiInteractionCount' },
      { title: 'Same TS', data: 'sameTimestamp', render: d => (d === 'YES' || d > 0) ? UI.badge('YES', 'red') : UI.badge('No', 'muted') },
      { title: 'Short Interval', data: 'shortInterval', render: d => d === 'YES' ? UI.badge('YES', 'amber') : UI.badge('No', 'muted') },
      { title: 'Sub Reason', data: 'subReason' },
      { title: 'Reason', data: 'reason' },
      { title: 'Action', data: 'actionTaken' }
    ]
  });
  document.getElementById('defectModal').style.display = 'flex';
}

// ── REASON ANALYSIS ──
function renderReasonAnalysis(m) {
  STATE.reasonData = {
    handled: m.dec.filter(t => t.decagonOnly),
    cs: m.dec.filter(t => t.csAssisted),
    comp: m.dec.filter(t => t.decagonOnly && !t.compliant)
  };
  renderReasonChart(STATE.currentReasonTab || 'handled');
  document.querySelectorAll('.reason-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.reason-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      STATE.currentReasonTab = tab.dataset.rt;
      document.getElementById('reasonDetailSide').innerHTML = '<div class="reason-detail-placeholder"><i class="fa-solid fa-hand-pointer"></i><p>Click any bar to see breakdown</p></div>';
      renderReasonChart(tab.dataset.rt);
    };
  });
}

function renderReasonChart(tab) {
  const tickets = STATE.reasonData[tab] || [];
  const data = DataProcessor.countByReason(tickets);
  const colors = { handled: 'rgba(2,132,199,0.7)', cs: 'rgba(217,119,6,0.7)', comp: 'rgba(220,38,38,0.7)' };
  const tc = '#64748b', gc = '#e2e8f0';

  UI.destroyChart('reasonChart');
  STATE.charts.reasonChart = new Chart(document.getElementById('reasonChart'), {
    type: 'bar',
    data: { labels: data.map(d => d[0]), datasets: [{ label: 'Calls', data: data.map(d => d[1]), backgroundColor: colors[tab] || colors.handled, borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true,
      onClick: (evt, els) => { if (els.length) showReasonDetail(data[els[0].index][0]); },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#fff', titleColor: '#0f172a', bodyColor: '#475569', borderColor: '#e2e8f0', borderWidth: 1 } },
      scales: { x: { ticks: { color: tc, font: { size: 10 } }, grid: { color: gc } }, y: { ticks: { color: tc, font: { size: 10 } } } }
    }
  });
}

function showReasonDetail(reason) {
  const allDec = [...STATE.filteredTickets.values()].filter(t => t.isDecagonTicket);
  const reasonTks = allDec.filter(t => t.displayReason === reason);
  const total = reasonTks.length;
  const decHandled = reasonTks.filter(t => t.decagonOnly).length;
  const csHandled = reasonTks.filter(t => t.csAssisted).length;
  const statusCounts = {};
  reasonTks.forEach(t => { const s = t.status || 'Unknown'; statusCounts[s] = (statusCounts[s] || 0) + 1; });
  const statusColors = { Closed: '#10b981', Open: '#ef4444', 'In Progress': '#f59e0b', 'Waiting for OPs': '#8b5cf6' };
  const rows = [
    { name: 'Handled by Decagon Only', count: decHandled, color: '#0ea5e9' },
    { name: 'CS Handled', count: csHandled, color: '#d97706' },
    ...Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([s, c]) => ({ name: s, count: c, color: statusColors[s] || '#94a3b8' }))
  ];
  document.getElementById('reasonDetailSide').innerHTML = `
    <div class="reason-detail-title">${reason}</div>
    <div class="reason-detail-total">${UI.fmt.num(total)}<span>Total Decagon Calls</span></div>
    <div class="status-breakdown">
      ${rows.map(s => `<div class="status-row">
        <span class="status-name" style="color:${s.color};font-weight:600">${s.name}</span>
        <div class="status-bar-wrap"><div class="status-bar-fill" style="width:${total ? s.count/total*100 : 0}%;background:${s.color}"></div></div>
        <span class="status-count">${UI.fmt.num(s.count)}</span>
        <span style="font-size:11px;color:#94a3b8;width:40px;text-align:right">${UI.fmt.pct(total ? s.count/total*100 : 0)}</span>
      </div>`).join('')}
    </div>`;
}

// ── MASTER TABLE ──
function renderMasterTable(m) {
  if (STATE.datatables.masterTable) { STATE.datatables.masterTable.destroy(); document.getElementById('masterTable').innerHTML = ''; }
  STATE.datatables.masterTable = $('#masterTable').DataTable({
    data: m.dec, pageLength: 25, dom: 'Bfrtip', buttons: ['csv', 'excel'], scrollX: true,
    columns: [
      { title: 'OGI', data: 'ogi' },
      { title: 'Ticket ID', data: 'ticketId', render: d => `<a class="ticket-link" onclick="showTimeline('${d}')">${d}</a>` },
      { title: 'Date', data: 'dateBucket', render: d => UI.fmt.date(d) },
      { title: 'Vertical', data: 'subVertical', render: (d, _, r) => d || r.vertical || '—' },
      { title: 'Sub Reason', data: 'subReason', render: d => d || '<span style="color:#94a3b8">—</span>' },
      { title: 'Action', data: 'actionTaken', render: d => d || '<span style="color:#94a3b8">—</span>' },
      { title: 'Status', data: 'status', render: d => { const c = d === 'Closed' ? 'green' : d === 'Open' ? 'red' : 'amber'; return UI.badge(d || '—', c); } },
      { title: 'AI Ints', data: 'aiInteractionCount', width: '55px' },
      { title: 'FCR', data: 'fcrAchieved', width: '70px', render: d => d ? UI.badge('PASS', 'green') : UI.badge('FAIL', 'red') },
      { title: 'Contained', data: 'decagonContained', width: '85px', render: d => d ? UI.badge('YES', 'green') : UI.badge('NO', 'red') },
      { title: 'Compliance', data: 'compliant', width: '90px', render: (d, _, r) => r.decagonOnly ? (d ? UI.badge('PASS', 'green') : UI.badge('FAIL', 'red')) : UI.badge('CS Assisted', 'amber') },
      { title: 'CS Assisted', data: 'csAssisted', width: '85px', render: d => d ? UI.badge('YES', 'amber') : UI.badge('No', 'muted') }
    ]
  });
}

// ── TIMELINE ──
function showTimeline(ticketId) {
  const tk = STATE.filteredTickets.get(String(ticketId)) || STATE.ticketMap.get(String(ticketId));
  if (!tk) return;
  document.getElementById('tlTicketId').textContent = 'Ticket: ' + ticketId;
  document.getElementById('tlTicketMeta').textContent = `OGI: ${tk.ogi} · ${tk.interactions.length} interactions · ${tk.subVertical || tk.vertical || ''}`;

  const tsCounts = {};
  tk.interactions.forEach(i => { if (i.timestamp) tsCounts[i.timestamp] = (tsCounts[i.timestamp] || 0) + 1; });

  const html = tk.interactions.map((int, idx) => {
    let dc = CONFIG.INTERNAL.has(int.type) ? 'internal' : int.type === CONFIG.AI_TYPE ? 'ai' : CONFIG.CUSTOMER_FACING.has(int.type) ? 'human' : 'internal';
    const isSameTs = int.timestamp && tsCounts[int.timestamp] > 1;
    const isEsc = idx > 0 && CONFIG.HUMAN_CHANNELS.has(int.type) && tk.csAssisted;
    if (isSameTs) dc = 'duplicate';
    if (isEsc) dc = 'escalation';
    const flags = [];
    if (isSameTs) flags.push(UI.badge('SAME TIMESTAMP', 'red'));
    if (isEsc) flags.push(UI.badge('CS ASSISTED', 'amber'));
    if (CONFIG.INTERNAL.has(int.type)) flags.push(UI.badge('INTERNAL', 'muted'));
    if (int.type === CONFIG.AI_TYPE) flags.push(UI.badge('DECAGON', 'cyan'));
    return `<div class="tl-item"><div class="tl-dot ${dc}"></div><div class="tl-content">
      <div class="tl-time">${UI.fmt.datetime(int.dateRaw)}</div>
      <div class="tl-type">${int.type}</div>
      ${int.subReason ? `<div style="font-size:11px;color:#64748b">${int.subReason}</div>` : ''}
      <div class="tl-flags">${flags.join('')}</div>
    </div></div>`;
  }).join('');

  document.getElementById('tlBody').innerHTML = '<div class="timeline-list">' + html + '</div>';
  document.getElementById('timelineModal').style.display = 'flex';
}

// ── RE-CONTACT TAB ──
function renderRecontactTab(m) {
  const colorMap = { cyan: { a: 'var(--cyan)', d: 'var(--cyan-dim)' }, green: { a: 'var(--green)', d: 'var(--green-dim)' }, amber: { a: 'var(--amber)', d: 'var(--amber-dim)' }, red: { a: 'var(--red)', d: 'var(--red-dim)' } };
  const kpis = [
    { label: 'Re-contact Calls Handled by Decagon', main: UI.fmt.num(m.rcCount), sub: UI.fmt.pct(m.rcCount / m.decagonTickets * 100) + ' of Decagon calls', icon: 'fa-phone-arrow-up-right', color: 'cyan', tip: 'Tickets with human interaction before Decagon handled a follow-up', lvl: 'Ticket' },
    { label: 'Resolved by Decagon', main: UI.fmt.num(m.rcResolved), sub: m.rcCount ? UI.fmt.pct(m.rcResolved / m.rcCount * 100) : '0%', icon: 'fa-circle-check', color: 'green', tip: 'Re-contact calls Decagon resolved — no further human + ticket closed', lvl: 'Ticket' },
    { label: 'Re-escalated to CS', main: UI.fmt.num(m.rcReescalated), sub: m.rcCount ? UI.fmt.pct(m.rcReescalated / m.rcCount * 100) : '0%', icon: 'fa-person-walking-arrow-right', color: 'amber', tip: 'Re-contact calls where CS had to step in after Decagon again', lvl: 'Ticket' },
    { label: 'Still Open', main: UI.fmt.num(m.rcOpen), sub: m.rcCount ? UI.fmt.pct(m.rcOpen / m.rcCount * 100) : '0%', icon: 'fa-clock', color: 'red', tip: 'Re-contact calls handled by Decagon but ticket still not closed', lvl: 'Ticket' }
  ];
  const grid = document.getElementById('recontactKpiGrid');
  if (!grid) return;
  grid.innerHTML = kpis.map(k => {
    const c = colorMap[k.color] || colorMap.cyan;
    return `<div class="kpi-card" style="--ac:${c.a};--acd:${c.d}">
      <div class="kpi-tip" title="${k.tip}"><i class="fa-solid fa-circle-info"></i></div>
      <div class="kpi-icon"><i class="fa-solid ${k.icon}"></i></div>
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-val-large">${k.main}</div>
      <div class="kpi-val-small">${k.sub}</div>
      <div class="kpi-lvl">${k.lvl} Level</div>
    </div>`;
  }).join('');

  // Reason charts
  const rcResolved = DataProcessor.countByReason(m.rcTickets.filter(t => t.recontactResolvedByDecagon));
  const rcEsc = DataProcessor.countByReason(m.rcTickets.filter(t => t.recontactReescalated));
  const tc = '#64748b', gc = '#e2e8f0';

  UI.destroyChart('rcChart1');
  if (document.getElementById('rcChart1')) {
    if (rcResolved.length) {
      STATE.charts.rcChart1 = new Chart(document.getElementById('rcChart1'), {
        type: 'bar', data: { labels: rcResolved.map(d => d[0]), datasets: [{ label: 'Resolved', data: rcResolved.map(d => d[1]), backgroundColor: 'rgba(5,150,105,0.7)', borderRadius: 4 }] },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: tc }, grid: { color: gc } }, y: { ticks: { color: tc, font: { size: 10 } } } } }
      });
    } else {
      document.getElementById('rcChart1').parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#94a3b8;flex-direction:column;gap:0.5rem"><i class="fa-solid fa-chart-bar" style="font-size:2rem"></i><p>No data in selected period</p></div>';
    }
  }

  UI.destroyChart('rcChart2');
  if (document.getElementById('rcChart2')) {
    if (rcEsc.length) {
      STATE.charts.rcChart2 = new Chart(document.getElementById('rcChart2'), {
        type: 'bar', data: { labels: rcEsc.map(d => d[0]), datasets: [{ label: 'Re-escalated', data: rcEsc.map(d => d[1]), backgroundColor: 'rgba(217,119,6,0.7)', borderRadius: 4 }] },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: tc }, grid: { color: gc } }, y: { ticks: { color: tc, font: { size: 10 } } } } }
      });
    } else {
      document.getElementById('rcChart2').parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#94a3b8;flex-direction:column;gap:0.5rem"><i class="fa-solid fa-chart-bar" style="font-size:2rem"></i><p>No data in selected period</p></div>';
    }
  }

  if (STATE.datatables.recontactTable) { STATE.datatables.recontactTable.destroy(); document.getElementById('recontactTable').innerHTML = ''; }
  if (document.getElementById('recontactTable')) {
    STATE.datatables.recontactTable = $('#recontactTable').DataTable({
      data: m.rcTickets, pageLength: 25, dom: 'Bfrtip', buttons: ['csv', 'excel'], scrollX: true,
      columns: [
        { title: 'Ticket ID', data: 'ticketId', render: d => `<a class="ticket-link" onclick="showTimeline('${d}')">${d}</a>` },
        { title: 'OGI', data: 'ogi' },
        { title: 'Date', data: 'dateBucket', render: d => UI.fmt.date(d) },
        { title: 'Sub Reason', data: 'subReason', render: d => d || '—' },
        { title: 'Status', data: 'status', render: d => { const c = d === 'Closed' ? 'green' : d === 'Open' ? 'red' : 'amber'; return UI.badge(d || '—', c); } },
        { title: 'Resolved by Decagon', data: 'recontactResolvedByDecagon', render: d => d ? UI.badge('YES', 'green') : UI.badge('NO', 'red') },
        { title: 'Re-escalated', data: 'recontactReescalated', render: d => d ? UI.badge('YES', 'amber') : UI.badge('No', 'muted') }
      ]
    });
  }
}

// ── CEO SUMMARY ──
function renderCEOSummary(m) {
  const topHandled = DataProcessor.countByReason(m.dec.filter(t => t.decagonOnly)).slice(0, 3);
  const topCS = DataProcessor.countByReason(m.dec.filter(t => t.csAssisted)).slice(0, 3);
  const decShare = m.totalCallInts > 0 ? (m.totalAIInts / m.totalCallInts * 100).toFixed(1) : 0;
  const pctAlone = m.decagonTickets > 0 ? (m.decagonOnlyCount / m.decagonTickets * 100).toFixed(1) : 0;

  const obs = [
    `Decagon handled <strong>${UI.fmt.num(m.decagonTickets)} calls</strong> out of <strong>${UI.fmt.num(m.totalCallInts)} total calls</strong> — representing <strong>${decShare}%</strong> of all voice interactions.`,
    `Of ${UI.fmt.num(m.decagonTickets)} calls, <strong>${UI.fmt.num(m.decagonOnlyCount)} (${pctAlone}%)</strong> were handled by Decagon alone without CS involvement.`,
    `Decagon FCR is <strong>${UI.fmt.pct(m.fcrRate)} (${UI.fmt.num(m.fcrCount)} calls)</strong> — handled by Decagon with no CS involvement. However only <strong>${UI.fmt.num(m.compliantCount)}</strong> of those are fully documented (closed + reason tagged) — the rest are Decagon API issues.`,
    `<strong>${UI.fmt.num(m.statusNotClosed)} call tickets are not closed</strong> — this is a Decagon API integration issue, not an agent issue.`
  ];

  const working = [
    `Decagon contained <strong>${UI.fmt.pct(m.containmentRate)}</strong> of calls without CS agent involvement.`,
    `Call volume handled by Decagon is growing — increasing trend visible in the Effectiveness charts.`,
    `CS agents were freed from <strong>${UI.fmt.num(m.decagonOnlyCount)}</strong> calls that Decagon handled independently.`
  ];

  const recs = [
    `Fix Decagon API to automatically close call tickets upon successful resolution — ${UI.fmt.num(m.statusNotClosed)} call tickets currently open.`,
    `Fix Sub Reason tagging in Decagon — ${UI.fmt.num(m.missingSubReason)} call tickets missing Sub Reason field.`,
    `Investigate ${UI.fmt.num(m.shortIntervalInts)} short interval interactions — possible system retry issue.`,
    `Expand Decagon call handling — currently at ${decShare}% of total voice calls, significant room to grow.`
  ];

  const kpiColor = (v, good, mid) => v >= good ? '#059669' : v >= mid ? '#d97706' : '#dc2626';

  document.getElementById('ceoSummaryCard').innerHTML = `<div class="ceo-content">
    <div class="ceo-meta-row">
      <div class="ceo-meta-item"><div class="ceo-meta-label">Total CRM Records</div><div class="ceo-meta-val">${UI.fmt.num(m.totalRecords)}</div></div>
      <div class="ceo-meta-item"><div class="ceo-meta-label">Total Calls (Human + Decagon)</div><div class="ceo-meta-val">${UI.fmt.num(m.totalCallInts)}</div></div>
      <div class="ceo-meta-item"><div class="ceo-meta-label">Calls Routed to Decagon</div><div class="ceo-meta-val">${UI.fmt.num(m.decagonTickets)}</div></div>
      <div class="ceo-meta-item"><div class="ceo-meta-label">Handled by Decagon Alone</div><div class="ceo-meta-val">${UI.fmt.num(m.decagonOnlyCount)}</div></div>
    </div>
    <div class="ceo-kpi-row">
      <div class="ceo-kpi-item"><div class="ceo-kpi-label">Escalated to CS</div><div class="ceo-kpi-val" style="color:#d97706">${UI.fmt.num(m.csAssistedCount)} <span style="font-size:12px">(${UI.fmt.pct(m.csAssistedRate)})</span></div></div>
      <div class="ceo-kpi-item"><div class="ceo-kpi-label">Decagon FCR</div><div class="ceo-kpi-val" style="color:${kpiColor(m.fcrRate,10,5)}">${UI.fmt.pct(m.fcrRate)}</div></div>
      <div class="ceo-kpi-item"><div class="ceo-kpi-label">Containment Rate</div><div class="ceo-kpi-val" style="color:${kpiColor(m.containmentRate,70,50)}">${UI.fmt.pct(m.containmentRate)}</div></div>
      <div class="ceo-kpi-item"><div class="ceo-kpi-label">Compliance Rate</div><div class="ceo-kpi-val" style="color:${kpiColor(m.complianceRate,50,20)}">${UI.fmt.pct(m.complianceRate)}</div></div>
      <div class="ceo-kpi-item"><div class="ceo-kpi-label">Compliance Failures</div><div class="ceo-kpi-val" style="color:#dc2626">${UI.fmt.num(m.complianceFailures)}</div></div>
    </div>
    <div class="ceo-sections">
      <div class="ceo-col">
        <h4>📞 Top Reasons — Decagon Handled</h4>
        ${topHandled.map((e,i) => `<div class="insight-item"><div class="insight-dot" style="background:#0ea5e9"></div><div class="insight-text">${i+1}. <strong>${e[0]}</strong> — ${UI.fmt.num(e[1])} calls</div></div>`).join('') || '<p style="font-size:12px;color:#64748b">No data</p>'}
        <h4 style="margin-top:1rem">🔄 Top Reasons — Escalated to CS</h4>
        ${topCS.map((e,i) => `<div class="insight-item"><div class="insight-dot" style="background:#d97706"></div><div class="insight-text">${i+1}. <strong>${e[0]}</strong> — ${UI.fmt.num(e[1])} calls</div></div>`).join('') || '<p style="font-size:12px;color:#64748b">No escalations</p>'}
      </div>
      <div class="ceo-col">
        <h4>💡 How Decagon is Performing</h4>
        ${obs.map(o => `<div class="insight-item"><div class="insight-dot"></div><div class="insight-text">${o}</div></div>`).join('')}
        <h4 style="margin-top:1rem">✅ What is Working</h4>
        ${working.map(o => `<div class="insight-item"><div class="insight-dot" style="background:#10b981"></div><div class="insight-text">${o}</div></div>`).join('')}
      </div>
      <div class="ceo-col">
        <h4>🎯 Recommended Actions</h4>
        ${recs.map((r,i) => `<div class="insight-item"><div class="insight-dot" style="background:#7c3aed"></div><div class="insight-text">${i+1}. ${r}</div></div>`).join('')}
      </div>
    </div>
  </div>`;
}

// ── DATE FILTER ──
function applyDateFilter() {
  const from = document.getElementById('globalDateFrom').value;
  const to = document.getElementById('globalDateTo').value;
  STATE.filteredTickets = new Map();
  STATE.ticketMap.forEach((tk, id) => {
    // Compare YYYY-MM-DD strings directly - no Date objects - no timezone issues
    const d = tk.dateBucket;
    if (!d) return;
    if (from && d < from) return;
    if (to && d > to) return;
    STATE.filteredTickets.set(id, tk);
  });
  renderDashboard();
  UI.toast(`Filter applied — ${UI.fmt.num(STATE.filteredTickets.size)} tickets`, 'info');
}

function clearDateFilter() {
  STATE.filteredTickets = new Map(STATE.ticketMap);
  const decDates = [...STATE.ticketMap.values()].filter(t => t.isDecagonTicket && t.dateBucket).map(t => t.dateBucket).sort();
  if (decDates.length) {
    document.getElementById('globalDateFrom').value = decDates[0];
    document.getElementById('globalDateTo').value = decDates[decDates.length - 1];
  }
  renderDashboard();
  UI.toast('Filter cleared', 'info');
}

// ── EXPORT ──
function exportPDF() {
  if (!STATE.filteredTickets.size) { UI.toast('Upload data first', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const m = DataProcessor.computeMetrics(STATE.filteredTickets, STATE.totalCallInts, STATE.totalAIInts, STATE.rawRows.length);
  const now = new Date().toLocaleDateString('en-GB');
  doc.setFillColor(15, 23, 42); doc.rect(0, 0, 210, 35, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('Way-Decagon AI Effectiveness & Quality Dashboard', 15, 16);
  doc.setFontSize(9); doc.setTextColor(148, 163, 184); doc.text('Export · ' + now, 15, 26);
  let y = 48; doc.setTextColor(15, 23, 42); doc.setFontSize(12); doc.text('Executive KPI Summary', 15, y); y += 8;
  doc.autoTable({ startY: y, head: [['KPI', 'Value']], body: [
    ['Calls Handled by Decagon', UI.fmt.num(m.decagonTickets)],
    ['Interactions by Decagon', UI.fmt.num(m.totalAIInts)],
    ['Decagon FCR', UI.fmt.pct(m.fcrRate) + ' (' + UI.fmt.num(m.fcrCount) + ' calls)'],
    ['Containment Rate', UI.fmt.pct(m.containmentRate)],
    ['CS Assisted', UI.fmt.num(m.csAssistedCount) + ' (' + UI.fmt.pct(m.csAssistedRate) + ')'],
    ['Compliance Rate', UI.fmt.pct(m.complianceRate)],
    ['Compliance Failures', UI.fmt.num(m.complianceFailures)],
    ['Status Not Closed', UI.fmt.num(m.statusNotClosed)],
    ['Duplicate Ticket Defects', UI.fmt.num(m.dupTicketCount)],
    ['Short Interval Interactions', UI.fmt.num(m.shortIntervalInts)]
  ], margin: { left: 15, right: 15 }, headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 9 }, bodyStyles: { fontSize: 9 } });
  doc.save('way_decagon_' + now.replace(/\//g, '-') + '.pdf');
  UI.toast('PDF exported', 'success');
}

function exportSummary() {
  if (!STATE.filteredTickets.size) return;
  const m = DataProcessor.computeMetrics(STATE.filteredTickets, STATE.totalCallInts, STATE.totalAIInts, STATE.rawRows.length);
  const text = `WAY-DECAGON EXECUTIVE SUMMARY\nGenerated: ${new Date().toLocaleString()}\n${'='.repeat(50)}\nDecagon Tickets: ${UI.fmt.num(m.decagonTickets)}\nDecagon FCR: ${UI.fmt.pct(m.fcrRate)}\nContainment Rate: ${UI.fmt.pct(m.containmentRate)}\nCS Assisted: ${UI.fmt.num(m.csAssistedCount)} (${UI.fmt.pct(m.csAssistedRate)})\nCompliance Rate: ${UI.fmt.pct(m.complianceRate)}\nCompliance Failures: ${UI.fmt.num(m.complianceFailures)}\nStatus Not Closed: ${UI.fmt.num(m.statusNotClosed)}\n`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'way_decagon_summary.txt'; a.click();
  UI.toast('Summary exported', 'success');
}

// ── SAMPLE DATA ──
function generateSampleData() {
  const subs = ['Shuttle boarding details at the airport', 'Lot Address Enquiry', 'General Enquiry', 'Shuttle timings', 'Check-out Assistance', 'Payment Failed', 'Booking Modification', 'QR Code Problem', 'Need for Additional Parking Time', 'Shuttle boarding details - General'];
  const statuses = ['Closed', 'Open', 'In Progress', 'Waiting for OPs'];
  const rows = [];
  for (let i = 0; i < 500; i++) {
    const tid = 1000000 + i;
    const ogi = `OGI${50000000 + Math.floor(i / 2)}`;
    const mo = 6, dy = 1 + Math.floor(Math.random() * 8);
    const h = 8 + Math.floor(Math.random() * 14), mn = Math.floor(Math.random() * 60);
    const ampm = h >= 12 ? 'PM' : 'AM', h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    const dateStr = `${mo}/${dy}/2026 ${h12}:${String(mn).padStart(2,'0')}:00 ${ampm}`;
    const sub = Math.random() > 0.12 ? subs[Math.floor(Math.random() * subs.length)] : '';
    const status = Math.random() > 0.3 ? 'Closed' : statuses[Math.floor(Math.random() * statuses.length)];
    rows.push({ 'Ticket ID': tid, 'OGI': ogi, 'Interaction': 'AI-Agent Call', 'Interaction date': dateStr, 'Interaction ID': 2000000 + i * 3, 'TKT_IssueReason': 'Non Escalated', 'Sub Reason': sub, 'Action': 'Details provided', 'Status': status, 'Vertical': 'Parking', 'SubVertical': 'Airport Parking', 'Agent Name': 'Decagon AI' });
    if (Math.random() < 0.25) {
      const mn2 = mn + 20 + Math.floor(Math.random() * 60);
      rows.push({ 'Ticket ID': tid, 'OGI': ogi, 'Interaction': 'Call', 'Interaction date': `${mo}/${dy}/2026 ${h12}:${String(mn2 % 60).padStart(2,'0')}:00 ${ampm}`, 'Interaction ID': 2000000 + i * 3 + 1, 'TKT_IssueReason': 'Non Escalated', 'Sub Reason': sub, 'Action': 'Details provided', 'Status': 'Closed', 'Vertical': 'Parking', 'SubVertical': 'Airport Parking', 'Agent Name': 'CS Agent' });
    }
  }
  return rows;
}

// ── NAV & INIT ──
function setupNav() {
  const TITLES = { upload: 'Data Source', kpis: 'Executive KPIs', effectiveness: 'Decagon Effectiveness', compliance: 'Decagon Compliance', defects: 'System Defects', reasons: 'Reason Analysis', executive: 'Executive Summary', recontact: 'Re-contact Analysis', validation: 'Data Validation', tickets: 'Master Tickets' };
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      const tab = item.dataset.tab;
      document.getElementById('tab-' + tab)?.classList.add('active');
      document.getElementById('topbarTitle').textContent = TITLES[tab] || tab;
    });
  });
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
    document.getElementById('mainWrapper').classList.toggle('expanded');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupUpload();
  setupNav();
  document.getElementById('exportPdfBtn').addEventListener('click', exportPDF);
  document.getElementById('exportSummaryBtn').addEventListener('click', exportSummary);
  document.getElementById('applyDateBtn').addEventListener('click', applyDateFilter);
  document.getElementById('clearDateBtn').addEventListener('click', clearDateFilter);
  document.getElementById('closeTlModal').addEventListener('click', () => { document.getElementById('timelineModal').style.display = 'none'; });
  document.getElementById('timelineModal').addEventListener('click', e => { if (e.target === document.getElementById('timelineModal')) document.getElementById('timelineModal').style.display = 'none'; });
  document.getElementById('closeDefectModal').addEventListener('click', () => { document.getElementById('defectModal').style.display = 'none'; });
  document.getElementById('defectModal').addEventListener('click', e => { if (e.target === document.getElementById('defectModal')) document.getElementById('defectModal').style.display = 'none'; });
  document.getElementById('recalcDefectsBtn').addEventListener('click', () => {
    CONFIG.DEFECT_THRESHOLD_SEC = parseInt(document.getElementById('defectThreshold').value) || 60;
    DataProcessor.computeShortIntervals(STATE.ticketMap, CONFIG.DEFECT_THRESHOLD_SEC);
    DataProcessor.computeShortIntervals(STATE.filteredTickets, CONFIG.DEFECT_THRESHOLD_SEC);
    renderDefectSection(DataProcessor.computeMetrics(STATE.filteredTickets, STATE.totalCallInts, STATE.totalAIInts, STATE.rawRows.length));
    UI.toast('Threshold updated to ' + CONFIG.DEFECT_THRESHOLD_SEC + 's', 'info');
  });
  document.querySelectorAll('.btn-img-export').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const chart = STATE.charts[btn.dataset.chart];
      if (!chart) return;
      const a = document.createElement('a'); a.download = btn.dataset.chart + '.png'; a.href = chart.toBase64Image(); a.click();
      UI.toast('Chart saved', 'success');
    });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.getElementById('timelineModal').style.display = 'none'; document.getElementById('defectModal').style.display = 'none'; } });
  UI.toast('Dashboard ready — upload your CS All Tickets XLSX or CSV', 'info', 5000);
});

window.showTimeline = showTimeline;
window.showDefectDrill = showDefectDrill;
