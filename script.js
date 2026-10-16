(function(){'use strict';
/* ---------- helpers ---------- */
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function uid(p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function today() { return ymd(new Date()); }
function nowTime() { var d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function parseYMD(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  var d = parseYMD(s); return ymd(d) === s;
}
function isTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s || ''); }
function addDays(s, n) { var d = parseYMD(s); d.setDate(d.getDate() + n); return ymd(d); }
function addMonthsKey(key, n) { // key 'YYYY-MM'
  var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  return y + '-' + pad2(m + 1);
}
function monthKey(s) { return String(s).slice(0, 7); }
function monthStart(key) { return key + '-01'; }
function monthEnd(key) { var y = +key.slice(0, 4), m = +key.slice(5, 7); return ymd(new Date(y, m, 0)); }
function daysBetween(a, b) { return Math.round((parseYMD(b) - parseYMD(a)) / 86400000); }
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function monthLabel(key, short) { var m = MONTHS[+key.slice(5, 7) - 1]; return (short ? m.slice(0, 3) : m) + ' ' + key.slice(0, 4); }
function weekStartOf(s, ws) { // ws 0=Sun 1=Mon
  var d = parseYMD(s), dow = d.getDay(); var diff = (dow - ws + 7) % 7; return addDays(s, -diff);
}
function download(name, text, mime) {
  var blob = new Blob([text], { type: mime || 'text/plain' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }
/* ================= CORE: data model, money, balances ================= */
var KEY = 'finance-tracker:v1', THEME_KEY = 'finance-tracker:theme', BACKUP_KEY = 'finance-tracker:v1:prerestore', CORRUPT_KEY = 'finance-tracker:v1:corrupt';
var MAX_CENTS = 1e12; // 10,000,000,000.00
var CURRENCIES = [
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso', sub: 'centavo' }, { code: 'USD', symbol: '$', name: 'US Dollar', sub: 'cent' },
  { code: 'EUR', symbol: '€', name: 'Euro', sub: 'cent' }, { code: 'GBP', symbol: '£', name: 'British Pound', sub: 'penny' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', sub: 'cent' }, { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', sub: 'cent' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', sub: 'cent' }, { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', sub: 'cent' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', sub: 'fen' }, { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', sub: 'fils' },
  { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal', sub: 'halala' }
];
var TYPES = ['Cash', 'Checking', 'Savings', 'E-Wallet', 'Credit Card', 'Investment', 'Receivable', 'Payable', 'Loan', 'Other'];
var METHODS = ['Cash', 'Debit Card', 'Credit Card', 'GCash', 'Maya', 'Bank Transfer', 'Online Payment', 'Other'];
var DEFAULT_GROUPS = [
  { id: 'g_cash', name: 'Cash', kind: 'asset' }, { id: 'g_bank', name: 'Bank Accounts', kind: 'asset' },
  { id: 'g_ewallet', name: 'E-Wallets', kind: 'asset' }, { id: 'g_savings', name: 'Savings', kind: 'asset' },
  { id: 'g_card', name: 'Credit Cards', kind: 'liability' }, { id: 'g_invest', name: 'Investments', kind: 'asset' },
  { id: 'g_recv', name: 'Receivables', kind: 'asset' }, { id: 'g_pay', name: 'Payables', kind: 'liability' },
  { id: 'g_other', name: 'Other Accounts', kind: 'asset' }
];
var DEFAULT_CATS = {
  expense: ['Food', 'Transportation', 'Electricity', 'Water', 'Internet', 'Rent', 'Shopping', 'Health', 'Education', 'Entertainment', 'Bills', 'Transfer Fee', 'Other'],
  income: ['Salary', 'Business Income', 'Allowance', 'Gift', 'Interest', 'Other']
};
function defaultSettings() {
  return {
    currency: { code: 'PHP', symbol: '₱', name: 'Philippine Peso', sub: 'centavo', decimals: 2, thousands: ',', decimal: '.', symbolPos: 'before' },
    rates: {}, // PHP per 1 unit of foreign currency (manual or fetched)
    dateFormat: 'MMM D, YYYY', timeFormat: '12', weekStart: 0, sort: 'date-desc',
    showTime: true, showNotes: true, compact: false, defaultTab: 'daily',
    defaultAccount: '', defaultMethod: 'Cash',
    feeCategory: 'Transfer Fee', askFee: true, cardBadge: true, cardSplit: true
  };
}
function newDB() {
  return { v: 1, settings: defaultSettings(), groups: DEFAULT_GROUPS.map(function (g) { return Object.assign({}, g); }), accounts: [], categories: { expense: DEFAULT_CATS.expense.slice(), income: DEFAULT_CATS.income.slice() }, methods: METHODS.slice(), catMeta: {}, txns: [], savedAt: null };
}
var DEFAULT_ICONS = { Food: '🍔', Transportation: '🚌', Electricity: '💡', Water: '🚰', Internet: '🌐', Rent: '🏠', Shopping: '🛍️', Health: '💊', Education: '🎓', Entertainment: '🎬', Bills: '🧾', 'Transfer Fee': '🏦', Other: '📦', Salary: '💼', 'Business Income': '🏪', Allowance: '🎒', Gift: '🎁', Interest: '📈', Transfer: '🔁' };
var ICON_CHOICES = ['🍔', '🍕', '☕', '🍺', '🛒', '🚌', '🚗', '⛽', '✈️', '🏠', '💡', '🚰', '📱', '🌐', '💊', '🏥', '🎓', '📚', '🎬', '🎮', '🎵', '🎁', '👕', '🛍️', '💄', '✂️', '🐶', '🧒', '🏋️', '🌴', '💍', '🔧', '🧹', '🧾', '🏦', '💼', '🏪', '💰', '📈', '🎒', '⛪', '❤️', '📦', '🏷️', '⭐', '🔥', '🍎', '🚲'];
var DB = newDB();
var storageOK = true, lastSaveError = '', onSaved = null;

/* ---------- money (integer centavos) ---------- */
function parseMoney(input, allowZero, allowNeg) {
  var s = String(input == null ? '' : input).trim().replace(/[₱$€£¥\s]/g, '');
  if (!s) return { err: 'Enter an amount.' };
  var neg = false;
  if (s[0] === '-') { if (!allowNeg) return { err: 'Amount cannot be negative.' }; neg = true; s = s.slice(1); }
  if (/[^\d.,]/.test(s)) return { err: 'Use digits only, for example 1,250.50.' };
  var hasDot = s.indexOf('.') >= 0, hasCom = s.indexOf(',') >= 0, dec = '', whole = s;
  if (hasDot && hasCom) {
    var ld = s.lastIndexOf('.'), lc = s.lastIndexOf(',');
    var decCh = ld > lc ? '.' : ',', thCh = decCh === '.' ? ',' : '.';
    var parts = s.split(decCh);
    if (parts.length !== 2) return { err: 'That amount looks invalid.' };
    whole = parts[0].split(thCh).join(''); dec = parts[1];
  } else if (hasCom) {
    if (/^\d{1,3}(,\d{3})+$/.test(s)) whole = s.split(',').join('');
    else if (/^\d+,\d{1,2}$/.test(s)) { var q = s.split(','); whole = q[0]; dec = q[1]; }
    else return { err: 'That amount looks invalid.' };
  } else if (hasDot) {
    var q2 = s.split('.');
    if (q2.length !== 2) return { err: 'That amount looks invalid.' };
    whole = q2[0]; dec = q2[1];
  }
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(dec)) return { err: 'That amount looks invalid.' };
  if (dec.length > 2) return { err: 'Use at most 2 decimal places.' };
  if (whole === '' && dec === '') return { err: 'Enter an amount.' };
  var cents = (parseInt(whole || '0', 10)) * 100 + parseInt((dec + '00').slice(0, 2), 10);
  if (cents > MAX_CENTS) return { err: 'Amount is too large.' };
  if (!allowZero && cents === 0) return { err: 'Amount must be greater than zero.' };
  return { cents: neg ? -cents : cents };
}
function groupInt(n, sep) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep); }
function fmtNum(c, forceSign) {
  var cur = DB.settings.currency, neg = c < 0; c = Math.abs(c);
  var int, frac;
  if (cur.decimals === 0) { int = Math.round(c / 100); frac = ''; }
  else { int = Math.floor(c / 100); frac = pad2(c % 100); if (cur.decimals === 1) frac = frac.slice(0, 1); }
  var out = groupInt(int, cur.thousands) + (frac !== '' ? cur.decimal + frac : '');
  return (neg ? '-' : (forceSign && c > 0 ? '+' : '')) + out;
}
function symOf(code) {
  if (!code || code === DB.settings.currency.code) return DB.settings.currency.symbol;
  var c = CURRENCIES.filter(function (x) { return x.code === code; })[0]; return c ? c.symbol : code + ' ';
}
function fmtMoney(c, code, forceSign) {
  var n = fmtNum(Math.abs(c)), s = symOf(code), cur = DB.settings.currency;
  var body = cur.symbolPos === 'after' ? n + ' ' + s.trim() : s + n;
  return (c < 0 ? '-' : (forceSign && c > 0 ? '+' : '')) + body;
}
function centsToInput(c) { var neg = c < 0; c = Math.abs(c); return (neg ? '-' : '') + Math.floor(c / 100) + '.' + pad2(c % 100); }
function rateOf(code) {
  if (!code || code === DB.settings.currency.code) return 1;
  var r = DB.settings.rates[code]; return r > 0 ? r : null;
}
function toMain(cents, code) { var r = rateOf(code); return r == null ? cents : Math.round(cents * r); }

/* ---------- category icons & colours ---------- */
function catKey(type, name) { return (type === 'income' ? 'income' : 'expense') + ':' + name; }
function catIcon(type, name) {
  if (type === 'transfer') return DEFAULT_ICONS.Transfer;
  var m = DB.catMeta[catKey(type, name)];
  if (m && m.icon) return m.icon;
  if (type === 'income' && name === 'Other') return '💵';
  return DEFAULT_ICONS[name] || (type === 'income' ? '💵' : '🏷️');
}
function catCi(type, name) {
  var m = DB.catMeta[catKey(type, name)]; if (m && typeof m.ci === 'number' && m.ci >= 0 && m.ci < 8) return m.ci;
  var i = DB.categories[type === 'income' ? 'income' : 'expense'].indexOf(name); return i < 0 ? 7 : i % 8;
}

/* ---------- lookups ---------- */
function acctById(id) { for (var i = 0; i < DB.accounts.length; i++) if (DB.accounts[i].id === id) return DB.accounts[i]; return null; }
function groupById(id) { for (var i = 0; i < DB.groups.length; i++) if (DB.groups[i].id === id) return DB.groups[i]; return null; }
function kindOf(a) { var g = a && groupById(a.groupId); return g ? g.kind : 'asset'; }
function isCard(a) { return !!a && a.type === 'Credit Card'; }
function acctName(id) { var a = acctById(id); return a ? a.name : '(removed account)'; }
function liveAcct(a) { return !!a && a.status !== 'deleted'; }
function counted(a) { return liveAcct(a) && a.include !== false; }
function activeAccounts() { return DB.accounts.filter(function (a) { return a.status === 'active'; }); }
function missingRates() {
  var out = {}; DB.accounts.forEach(function (a) { if (counted(a) && rateOf(a.currency) == null) out[a.currency] = 1; });
  return Object.keys(out);
}

/* ---------- balances & totals ---------- */
function delta(t, id) {
  if (t.type === 'income') return t.account === id ? t.amount : 0;
  if (t.type === 'expense') return t.account === id ? -t.amount : 0;
  var d = 0; if (t.account === id) d -= t.amount; if (t.toAccount === id) d += t.amount; return d;
}
function computeBalances(asOf) {
  var b = {}; DB.accounts.forEach(function (a) { b[a.id] = a.opening; });
  DB.txns.forEach(function (t) {
    if (asOf && t.date > asOf) return;
    if (t.account in b) b[t.account] += delta(t, t.account);
    if (t.type === 'transfer' && t.toAccount in b) b[t.toAccount] += delta(t, t.toAccount);
  });
  return b;
}
function netWorthFigures(asOf, onlyAcct) {
  var bal = computeBalances(asOf), assets = 0, liab = 0;
  DB.accounts.forEach(function (a) {
    if (!counted(a)) return; if (onlyAcct && a.id !== onlyAcct) return;
    var v = toMain(bal[a.id], a.currency);
    if (kindOf(a) === 'liability') liab += -v; else assets += v;
  });
  return { assets: assets, liabilities: liab, netWorth: assets - liab };
}
function txnAccounts(t) { return [acctById(t.account), t.type === 'transfer' ? acctById(t.toAccount) : null].filter(Boolean); }
function reportable(t) { // income/expense that feeds cash-flow reports
  if (t.type === 'transfer') return false;
  return counted(acctById(t.account));
}
function transferVisible(t) { return t.type === 'transfer' && txnAccounts(t).some(counted); }
function visible(t) { return t.type === 'transfer' ? txnAccounts(t).some(liveAcct) : liveAcct(acctById(t.account)); }
function amtMain(t) { var a = acctById(t.account); return toMain(t.amount, a ? a.currency : null); }
function summarize(list) {
  var r = { income: 0, expense: 0, transfers: 0, count: 0, cardExpense: 0 };
  list.forEach(function (t) {
    if (t.type === 'transfer') { if (transferVisible(t)) { r.transfers += amtMain(t); r.count++; } return; }
    if (!reportable(t)) return; r.count++;
    var v = amtMain(t);
    if (t.type === 'income') r.income += v; else { r.expense += v; if (isCard(acctById(t.account))) r.cardExpense += v; }
  });
  r.net = r.income - r.expense; return r;
}
function isSettlement(t) { // transfer into a liability account (e.g. credit-card payment)
  if (t.type !== 'transfer') return false; var a = acctById(t.toAccount); return !!a && kindOf(a) === 'liability';
}

/* ---------- filter / sort ---------- */
function filterTxns(f) {
  f = f || {}; var q = (f.q || '').trim().toLowerCase();
  return DB.txns.filter(function (t) {
    if (!visible(t)) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.acct && t.account !== f.acct && t.toAccount !== f.acct) return false;
    if (f.cat && t.category !== f.cat) return false;
    if (q) {
      var hay = (t.desc + ' ' + t.category + ' ' + t.notes + ' ' + t.method + ' ' + acctName(t.account) + ' ' + (t.toAccount ? acctName(t.toAccount) : '') + ' ' + centsToInput(t.amount)).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}
function sortTxns(list, how) {
  how = how || DB.settings.sort;
  var cmp = {
    'date-desc': function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time) || (b.id > a.id ? 1 : -1); },
    'date-asc': function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time) || (a.id > b.id ? 1 : -1); },
    'amount-desc': function (a, b) { return amtMain(b) - amtMain(a); },
    'amount-asc': function (a, b) { return amtMain(a) - amtMain(b); }
  }[how] || null;
  return list.slice().sort(cmp);
}

/* ---------- validation & mutations ---------- */
function validateTxnInput(inp, editingId) {
  var e = {}, out = { type: inp.type };
  if (['income', 'expense', 'transfer'].indexOf(inp.type) < 0) e.type = 'Choose a type.';
  if (!isDate(inp.date)) e.date = 'Enter a valid date.';
  if (!isTime(inp.time)) e.time = 'Enter a valid time.';
  var m = parseMoney(inp.amount); if (m.err) e.amount = m.err; else out.amount = m.cents;
  var a = acctById(inp.account);
  var editing = editingId ? DB.txns.filter(function (t) { return t.id === editingId; })[0] : null;
  if (!a) e.account = 'Choose an account.';
  else if (a.status !== 'active' && !(editing && editing.account === a.id && a.status !== 'deleted')) e.account = 'That account is not active.';
  var desc = String(inp.desc || '').trim();
  if (desc.length > 120) e.desc = 'Keep the description under 120 characters.';
  if (inp.type === 'transfer') {
    var b = acctById(inp.toAccount);
    if (!b) e.toAccount = 'Choose the destination account.';
    else if (inp.toAccount === inp.account) e.toAccount = 'Source and destination must differ.';
    else if (b.status !== 'active' && !(editing && editing.toAccount === b.id && b.status !== 'deleted')) e.toAccount = 'That account is not active.';
    else if (a && a.currency !== b.currency) e.toAccount = 'Transfers only work between accounts in the same currency (' + a.currency + ' vs ' + b.currency + ').';
    out.toAccount = inp.toAccount; out.category = 'Transfer';
    if (String(inp.fee || '').trim() !== '') {
      var f = parseMoney(inp.fee, true); if (f.err) e.fee = f.err; else out.fee = f.cents;
    } else out.fee = 0;
    if (!desc && a && b) desc = 'Transfer: ' + a.name + ' → ' + b.name;
  } else {
    out.category = String(inp.category || '').trim();
    if (!out.category) e.category = 'Choose a category.';
    if (!desc) desc = out.category;
  }
  if (!desc && !e.desc) e.desc = 'Enter a description.';
  out.desc = desc; out.date = inp.date; out.time = inp.time; out.account = inp.account;
  out.method = String(inp.method || '').trim(); out.notes = String(inp.notes || '').trim().slice(0, 500);
  return Object.keys(e).length ? { errors: e } : { value: out };
}
function syncFee(parent, fee) {
  var kids = DB.txns.filter(function (t) { return t.parentId === parent.id; });
  if (!fee || parent.type !== 'transfer') { DB.txns = DB.txns.filter(function (t) { return t.parentId !== parent.id; }); return; }
  var k = kids[0], from = acctById(parent.account), to = acctById(parent.toAccount);
  var data = { type: 'expense', date: parent.date, time: parent.time, desc: 'Transfer fee: ' + acctName(parent.account) + ' → ' + acctName(parent.toAccount), category: DB.settings.feeCategory || 'Transfer Fee', amount: fee, account: parent.account, toAccount: '', method: parent.method, notes: '', parentId: parent.id };
  if (k) Object.assign(k, data); else { data.id = uid('t'); DB.txns.push(data); }
}
function saveTxn(inp, editingId) {
  var v = validateTxnInput(inp, editingId); if (v.errors) return { ok: false, errors: v.errors };
  var val = v.value, t;
  if (editingId) {
    t = DB.txns.filter(function (x) { return x.id === editingId; })[0]; if (!t) return { ok: false, errors: { _: 'Transaction not found.' } };
    if (t.parentId) { return { ok: false, errors: { _: 'This is a transfer fee. Edit the transfer it belongs to.' } }; }
  } else { t = { id: uid('t') }; DB.txns.push(t); }
  var fee = val.fee || 0; delete val.fee;
  Object.assign(t, { toAccount: '' }, val);
  syncFee(t, fee);
  return { ok: true, txn: t };
}
function deleteTxn(id) {
  var t = DB.txns.filter(function (x) { return x.id === id; })[0]; if (!t) return false;
  var rid = t.parentId || t.id; // deleting a fee deletes its transfer too? no: only the fee
  if (t.parentId) { DB.txns = DB.txns.filter(function (x) { return x.id !== id; }); return true; }
  DB.txns = DB.txns.filter(function (x) { return x.id !== rid && x.parentId !== rid; }); return true;
}
function txnDeltaFor(accId) { var s = 0; DB.txns.forEach(function (t) { s += delta(t, accId); }); return s; }
function saveAccount(inp, editingId) {
  var e = {}, name = String(inp.name || '').trim();
  if (!name) e.name = 'Enter a name.'; else if (name.length > 60) e.name = 'Keep the name under 60 characters.';
  else if (DB.accounts.some(function (a) { return a.id !== editingId && a.status !== 'deleted' && a.name.toLowerCase() === name.toLowerCase(); })) e.name = 'You already have an account with this name.';
  var g = groupById(inp.groupId); if (!g) e.groupId = 'Choose a group.';
  var o = parseMoney(inp.opening, true, true); if (o.err) e.opening = o.err;
  if (!CURRENCIES.some(function (c) { return c.code === inp.currency; })) e.currency = 'Choose a currency.';
  if (Object.keys(e).length) return { ok: false, errors: e };
  var stored = g.kind === 'liability' ? -o.cents : o.cents;
  var a = editingId ? acctById(editingId) : { id: uid('a'), status: 'active', createdAt: today() };
  if (!a) return { ok: false, errors: { _: 'Account not found.' } };
  if (editingId && a.currency !== inp.currency && DB.txns.some(function (t) { return t.account === a.id || t.toAccount === a.id; })) return { ok: false, errors: { currency: 'Currency can’t change once an account has transactions.' } };
  if (editingId && kindOf(a) !== g.kind && DB.txns.some(function (t) { return t.account === a.id || t.toAccount === a.id; })) {
    /* allowed: opening is re-read in the new meaning */
  }
  Object.assign(a, { name: name, type: inp.type || 'Other', groupId: g.id, opening: stored, currency: inp.currency, notes: String(inp.notes || '').trim().slice(0, 300), include: inp.include !== false });
  if (!editingId) DB.accounts.push(a);
  return { ok: true, account: a };
}
function setAccountStatus(id, status) { var a = acctById(id); if (a) { a.status = status; if (status === 'deleted') a.deletedAt = today(); else delete a.deletedAt; } }
function purgeAccount(id) {
  var P = acctById(id); if (!P) return;
  DB.txns.slice().forEach(function (t) {
    if (t.type === 'transfer' && (t.account === id || t.toAccount === id)) {
      var otherId = t.account === id ? t.toAccount : t.account, O = acctById(otherId);
      if (O) O.opening += delta(t, otherId); // keep the other account's balance identical
      DB.txns.forEach(function (k) { if (k.parentId === t.id) { if (k.account === id) k.__rm = 1; else delete k.parentId; } });
      t.__rm = 1;
    } else if (t.type !== 'transfer' && t.account === id) t.__rm = 1;
  });
  DB.txns = DB.txns.filter(function (t) { return !t.__rm; });
  DB.accounts = DB.accounts.filter(function (a) { return a.id !== id; });
  if (DB.settings.defaultAccount === id) DB.settings.defaultAccount = '';
}

/* ---------- persistence & backup validation ---------- */
function validateDB(o) {
  var errs = [];
  function bad(m) { if (errs.length < 8) errs.push(m); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, errors: ['This file is not a finance tracker backup.'] };
  if (o.v !== 1) bad('Unknown backup version.');
  if (!Array.isArray(o.accounts) || !Array.isArray(o.txns) || !Array.isArray(o.groups)) bad('Accounts, groups or transactions are missing.');
  if (!o.settings || typeof o.settings !== 'object' || !o.settings.currency) bad('Settings are missing.');
  if (!o.categories || !Array.isArray(o.categories.income) || !Array.isArray(o.categories.expense)) bad('Categories are missing.');
  if (errs.length) return { ok: false, errors: errs };
  var gids = {}, aids = {}, tids = {};
  o.groups.forEach(function (g, i) { if (!g || !g.id || !g.name || ['asset', 'liability'].indexOf(g.kind) < 0) bad('Group #' + (i + 1) + ' is invalid.'); else gids[g.id] = 1; });
  o.accounts.forEach(function (a, i) {
    if (!a || !a.id || !a.name || !gids[a.groupId] || !Number.isInteger(a.opening) || Math.abs(a.opening) > MAX_CENTS || ['active', 'archived', 'deleted'].indexOf(a.status) < 0 || !a.currency) bad('Account #' + (i + 1) + ' is invalid.'); else aids[a.id] = 1;
  });
  o.txns.forEach(function (t, i) {
    var n = 'Transaction #' + (i + 1);
    if (!t || !t.id || tids[t.id]) return bad(n + ' has a missing or duplicate ID.'); tids[t.id] = 1;
    if (['income', 'expense', 'transfer'].indexOf(t.type) < 0) return bad(n + ' has an unknown type.');
    if (!isDate(t.date) || !isTime(t.time)) return bad(n + ' has an invalid date or time.');
    if (!Number.isInteger(t.amount) || t.amount <= 0 || t.amount > MAX_CENTS) return bad(n + ' has an invalid amount.');
    if (!aids[t.account]) return bad(n + ' points to an unknown account.');
    if (t.type === 'transfer' && (!aids[t.toAccount] || t.toAccount === t.account)) return bad(n + ' has an invalid destination account.');
  });
  if (errs.length) return { ok: false, errors: errs };
  var base = newDB(), db = Object.assign(base, o);
  db.settings = Object.assign(defaultSettings(), o.settings); db.settings.currency = Object.assign(defaultSettings().currency, o.settings.currency);
  db.settings.rates = o.settings.rates && typeof o.settings.rates === 'object' ? o.settings.rates : {};
  db.catMeta = o.catMeta && typeof o.catMeta === 'object' && !Array.isArray(o.catMeta) ? o.catMeta : {};
  db.methods = Array.isArray(o.methods) && o.methods.length ? o.methods : METHODS.slice();
  db.txns.forEach(function (t) { t.desc = String(t.desc || ''); t.category = String(t.category || ''); t.notes = String(t.notes || ''); t.method = String(t.method || ''); t.toAccount = t.toAccount || ''; });
  return { ok: true, db: db };
}
function store() { try { return window.localStorage; } catch (e) { return null; } }
function save() {
  DB.savedAt = Date.now();
  var s = store(), ok = false;
  if (!s) storageOK = false;
  else { try { s.setItem(KEY, JSON.stringify(DB)); storageOK = true; lastSaveError = ''; ok = true; } catch (e) { storageOK = false; lastSaveError = String(e && e.message || e); } }
  if (onSaved) onSaved();
  return ok;
}
function load() {
  var s = store(); if (!s) { storageOK = false; return { status: 'nostorage' }; }
  var raw; try { raw = s.getItem(KEY); } catch (e) { storageOK = false; return { status: 'nostorage' }; }
  if (!raw) return { status: 'fresh' };
  try {
    var v = validateDB(JSON.parse(raw));
    if (v.ok) { DB = v.db; return { status: 'ok' }; }
    try { s.setItem(CORRUPT_KEY, raw); } catch (e2) { /* ignore */ }
    return { status: 'corrupt', errors: v.errors };
  } catch (e) {
    try { s.setItem(CORRUPT_KEY, raw); } catch (e3) { /* ignore */ }
    return { status: 'corrupt', errors: ['Saved data could not be read.'] };
  }
}
/* ---------- aggregation ---------- */
function catIndex(type, name) { return catCi(type, name); }
function byCategory(list, type) {
  var m = {};
  list.forEach(function (t) { if (t.type !== type || !reportable(t)) return; m[t.category] = (m[t.category] || 0) + amtMain(t); });
  return Object.keys(m).map(function (k) { return { name: k, value: m[k], ci: catIndex(type, k), icon: catIcon(type, k) }; }).sort(function (a, b) { return b.value - a.value; });
}
function bucketKey(t, gran) { return gran === 'hour' ? t.time.slice(0, 2) : gran === 'day' ? t.date : gran === 'month' ? t.date.slice(0, 7) : t.date.slice(0, 4); }
function bucketList(from, to, gran) {
  var keys = [], i;
  if (gran === 'hour') { for (i = 0; i < 24; i++) keys.push(pad2(i)); }
  else if (gran === 'day') { for (var d = from; d <= to; d = addDays(d, 1)) keys.push(d); }
  else if (gran === 'month') { for (var m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonthsKey(m, 1)) keys.push(m); }
  else { for (var y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) keys.push(String(y)); }
  return keys;
}
function bucketize(list, from, to, gran) {
  var keys = bucketList(from, to, gran), idx = {}, rows = keys.map(function (k, i) { idx[k] = i; return { key: k, income: 0, expense: 0, net: 0, count: 0 }; });
  list.forEach(function (t) {
    if (t.type === 'transfer' || !reportable(t)) return;
    var r = rows[idx[bucketKey(t, gran)]]; if (!r) return;
    if (t.type === 'income') r.income += amtMain(t); else r.expense += amtMain(t); r.count++;
  });
  rows.forEach(function (r) { r.net = r.income - r.expense; });
  return rows;
}

/* ---------- CSV ---------- */
var CSV_HEAD = ['ID', 'Linked To', 'Date', 'Time', 'Type', 'Description', 'Category', 'Amount', 'Account', 'To Account', 'Payment Method', 'Notes'];
function csvCell(v, textual) {
  v = String(v == null ? '' : v);
  if (textual && /^[=+\-@\t\r]/.test(v)) v = "'" + v; // spreadsheet formula-injection guard
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function txnsToCSV(list) {
  var rows = [CSV_HEAD.join(',')];
  sortTxns(list, 'date-asc').forEach(function (t) {
    rows.push([csvCell(t.id), csvCell(t.parentId || ''), t.date, t.time, t.type, csvCell(t.desc, 1), csvCell(t.category, 1), centsToInput(t.amount),
      csvCell(acctName(t.account), 1), csvCell(t.toAccount ? acctName(t.toAccount) : '', 1), csvCell(t.method, 1), csvCell(t.notes, 1)].join(','));
  });
  return '\ufeff' + rows.join('\r\n') + '\r\n';
}
function parseCSV(text) {
  text = String(text).replace(/^\ufeff/, ''); var rows = [], row = [], f = '', q = false, i = 0, c;
  for (; i < text.length; i++) {
    c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}
function normDate(s) {
  s = String(s || '').trim(); var m;
  if (isDate(s)) return s;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) { // MM/DD/YYYY (US) – flagged by caller if ambiguous
    var mm = +m[1], dd = +m[2]; if (mm > 12 && dd <= 12) { var t = mm; mm = dd; dd = t; }
    var r = m[3] + '-' + pad2(mm) + '-' + pad2(dd); return isDate(r) ? r : null;
  }
  return null;
}
function prepareImport(text) {
  var rows = parseCSV(text), res = { items: [], errors: [], dupes: 0, newAccounts: [] };
  if (rows.length < 2) { res.errors.push('The file has no data rows.'); return res; }
  var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  function col() { for (var i = 0; i < arguments.length; i++) { var k = head.indexOf(arguments[i]); if (k >= 0) return k; } return -1; }
  var C = { id: col('id', 'transaction id'), link: col('linked to'), date: col('date'), time: col('time'), type: col('type'), desc: col('description'), cat: col('category'), amt: col('amount'), acct: col('account', 'source account'), to: col('to account', 'destination account'), meth: col('payment method', 'method'), notes: col('notes') };
  ['date', 'type', 'amt', 'acct'].forEach(function (k) { if (C[k] < 0) res.errors.push('Missing required column: ' + { date: 'Date', type: 'Type', amt: 'Amount', acct: 'Account' }[k]); });
  if (res.errors.length) return res;
  var have = {}; DB.txns.forEach(function (t) { have[dupeKey(t.date, t.time, t.type, t.desc, t.amount, acctName(t.account).toLowerCase(), t.toAccount ? acctName(t.toAccount).toLowerCase() : '')] = 1; });
  var names = {}; DB.accounts.forEach(function (a) { if (a.status !== 'deleted') names[a.name.toLowerCase()] = a; });
  var seen = {}, idMap = {};
  for (var r = 1; r < rows.length; r++) {
    var R = rows[r], line = 'Row ' + (r + 1) + ': ';
    function g(k) { return C[k] >= 0 && R[C[k]] != null ? R[C[k]].replace(/^'(?=[=+\-@])/, '').trim() : ''; }
    var type = g('type').toLowerCase(); if (['income', 'expense', 'transfer'].indexOf(type) < 0) { res.errors.push(line + 'unknown type “' + g('type') + '”.'); continue; }
    var date = normDate(g('date')); if (!date) { res.errors.push(line + 'invalid date “' + g('date') + '”.'); continue; }
    var time = g('time') || '12:00'; if (/^\d:\d\d$/.test(time)) time = '0' + time; if (!isTime(time)) { res.errors.push(line + 'invalid time “' + g('time') + '”.'); continue; }
    var m = parseMoney(g('amt')); if (m.err) { res.errors.push(line + m.err); continue; }
    var an = g('acct'); if (!an) { res.errors.push(line + 'account is empty.'); continue; }
    var tn = g('to'); if (type === 'transfer' && !tn) { res.errors.push(line + 'transfer has no destination account.'); continue; }
    if (type === 'transfer' && tn.toLowerCase() === an.toLowerCase()) { res.errors.push(line + 'transfer source and destination are the same.'); continue; }
    var cat = type === 'transfer' ? 'Transfer' : (g('cat') || 'Other'), desc = g('desc') || cat;
    [an, type === 'transfer' ? tn : ''].forEach(function (n) { if (n && !names[n.toLowerCase()] && res.newAccounts.indexOf(n) < 0) res.newAccounts.push(n); });
    var dk = dupeKey(date, time, type, desc, m.cents, an.toLowerCase(), tn.toLowerCase());
    var isDupe = !!have[dk] || !!seen[dk]; seen[dk] = 1;
    if (isDupe) res.dupes++;
    res.items.push({ oldId: g('id'), link: g('link'), date: date, time: time, type: type, desc: desc.slice(0, 120), category: cat, amount: m.cents, acctName: an, toName: type === 'transfer' ? tn : '', method: g('meth'), notes: g('notes').slice(0, 500), dupe: isDupe });
  }
  return res;
}
function dupeKey() { return Array.prototype.join.call(arguments, '|'); }
function commitImport(prep, opts) { // opts {skipDupes, createAccounts}
  var made = 0, skipped = 0, byName = {}, created = 0;
  DB.accounts.forEach(function (a) { if (a.status !== 'deleted') byName[a.name.toLowerCase()] = a; });
  function ensure(n) {
    var k = n.toLowerCase(); if (byName[k]) return byName[k];
    var a = { id: uid('a'), name: n, type: 'Other', groupId: 'g_other', opening: 0, currency: DB.settings.currency.code, notes: 'Created by import', include: true, status: 'active', createdAt: today() };
    DB.accounts.push(a); byName[k] = a; created++; return a;
  }
  var idMap = {}, pending = [];
  prep.items.forEach(function (it) {
    if (it.dupe && opts.skipDupes) { skipped++; return; }
    var a = byName[it.acctName.toLowerCase()] || (opts.createAccounts ? ensure(it.acctName) : null);
    var b = it.toName ? (byName[it.toName.toLowerCase()] || (opts.createAccounts ? ensure(it.toName) : null)) : null;
    if (!a || (it.type === 'transfer' && !b)) { skipped++; return; }
    if (it.type === 'transfer' && a.currency !== b.currency) { skipped++; return; }
    var cats = DB.categories[it.type === 'income' ? 'income' : 'expense'];
    if (it.type !== 'transfer' && cats.indexOf(it.category) < 0) cats.push(it.category);
    var t = { id: uid('t'), date: it.date, time: it.time, type: it.type, desc: it.desc, category: it.category, amount: it.amount, account: a.id, toAccount: b ? b.id : '', method: it.method, notes: it.notes };
    if (it.oldId) idMap[it.oldId] = t.id; DB.txns.push(t); made++; if (it.link) pending.push([t, it.link]);
  });
  pending.forEach(function (p) { if (idMap[p[1]]) p[0].parentId = idMap[p[1]]; });
  return { made: made, skipped: skipped, created: created };
}

/* ---------- report export ---------- */
function reportCSV(from, to) {
  var list = filterTxns({ from: from, to: to }), s = summarize(list), L = [];
  function row() { L.push(Array.prototype.map.call(arguments, function (v) { return csvCell(v, 1); }).join(',')); }
  row('Personal Finance Report'); row('Period', from + ' to ' + to); row('Currency', DB.settings.currency.code); row('');
  row('Total income', centsToInput(s.income)); row('Total expenses', centsToInput(s.expense)); row('Net cash flow', centsToInput(s.net)); row('Transfers (not income/expense)', centsToInput(s.transfers));
  var nw = netWorthFigures(to); row('Total assets at ' + to, centsToInput(nw.assets)); row('Total liabilities at ' + to, centsToInput(nw.liabilities)); row('Net worth at ' + to, centsToInput(nw.netWorth)); row('');
  row('Expenses by category'); byCategory(list, 'expense').forEach(function (c) { row(c.name, centsToInput(c.value)); }); row('');
  row('Income by source'); byCategory(list, 'income').forEach(function (c) { row(c.name, centsToInput(c.value)); }); row('');
  row('Month', 'Income', 'Expenses', 'Net'); bucketize(list, from, to, 'month').forEach(function (b) { row(b.key, centsToInput(b.income), centsToInput(b.expense), centsToInput(b.net)); });
  return '\ufeff' + L.join('\r\n') + '\r\n';
}
function reportHTML(from, to) {
  var list = filterTxns({ from: from, to: to }), s = summarize(list), nw = netWorthFigures(to);
  function tbl(rows) { return '<table>' + rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td style="text-align:right">' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>'; }
  return '<!doctype html><meta charset="utf-8"><title>Finance report</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:30px auto;padding:0 16px;color:#222}td{padding:5px 8px;border-bottom:1px solid #ddd}table{width:100%;border-collapse:collapse}h1{font-size:22px}h2{font-size:16px;margin-top:26px}</style>' +
    '<h1>Personal finance report</h1><p>' + esc(from) + ' to ' + esc(to) + ' · ' + esc(DB.settings.currency.code) + '</p><h2>Cash flow</h2>' +
    tbl([['Total income', fmtMoney(s.income)], ['Total expenses', fmtMoney(s.expense)], ['Net cash flow', fmtMoney(s.net)], ['Transfers (not income or expense)', fmtMoney(s.transfers)]]) +
    '<h2>Position at ' + esc(to) + '</h2>' + tbl([['Total assets', fmtMoney(nw.assets)], ['Total liabilities', fmtMoney(nw.liabilities)], ['Net worth', fmtMoney(nw.netWorth)]]) +
    '<h2>Expenses by category</h2>' + tbl(byCategory(list, 'expense').map(function (c) { return [c.name, fmtMoney(c.value)]; })) +
    '<h2>Income by source</h2>' + tbl(byCategory(list, 'income').map(function (c) { return [c.name, fmtMoney(c.value)]; })) +
    '<p style="color:#777;font-size:12px;margin-top:30px">Generated ' + esc(new Date().toLocaleString()) + '. Use your browser’s Print command to save as PDF.</p>';
}

/* ---------- safe calculator (no eval) ---------- */
function calcEval(expr, deg) {
  var s = String(expr).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, '(pi)').replace(/\s+/g, ''), i = 0;
  var F = {
    sin: function (x) { return Math.sin(deg ? x * Math.PI / 180 : x); }, cos: function (x) { return Math.cos(deg ? x * Math.PI / 180 : x); }, tan: function (x) { return Math.tan(deg ? x * Math.PI / 180 : x); },
    asin: function (x) { var r = Math.asin(x); return deg ? r * 180 / Math.PI : r; }, acos: function (x) { var r = Math.acos(x); return deg ? r * 180 / Math.PI : r; }, atan: function (x) { var r = Math.atan(x); return deg ? r * 180 / Math.PI : r; },
    log: Math.log10, ln: Math.log, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, fact: function (x) { if (x < 0 || x !== Math.floor(x) || x > 170) throw 0; var r = 1; for (var k = 2; k <= x; k++) r *= k; return r; }
  };
  function peek() { return s[i]; }
  function num() {
    var m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]);
  }
  function prim() {
    var v;
    if (peek() === '(') { i++; v = expr0(); if (peek() !== ')') throw 0; i++; }
    else if (/[a-z]/i.test(peek() || '')) {
      var m = /^[a-z]+/i.exec(s.slice(i))[0].toLowerCase(); i += m.length;
      if (m === 'pi') v = Math.PI; else if (m === 'e') v = Math.E;
      else if (F[m]) { if (peek() !== '(') throw 0; i++; var a = expr0(); if (peek() !== ')') throw 0; i++; v = F[m](a); } else throw 0;
    } else v = num();
    while (peek() === '!') { i++; v = F.fact(v); }
    if (peek() === '%') { i++; v = v / 100; }
    return v;
  }
  function unary() { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return pow(); }
  function pow() { var b = prim(); if (peek() === '^') { i++; var e = unary(); return Math.pow(b, e); } return b; }
  function term() {
    var v = unary();
    for (;;) { var c = peek(); if (c === '*') { i++; v *= unary(); } else if (c === '/') { i++; v /= unary(); } else if (c === '(' || /[a-z]/i.test(c || '')) { v *= pow(); } else return v; }
  }
  function expr0() { var v = term(); for (;;) { var c = peek(); if (c === '+') { i++; v += term(); } else if (c === '-') { i++; v -= term(); } else return v; } }
  try { if (!s) return { err: '' }; var r = expr0(); if (i !== s.length) throw 0; if (!isFinite(r)) return { err: 'Math error' }; return { val: r }; } catch (e) { return { err: 'Invalid expression' }; }
}
function fmtCalc(v) { if (Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-9 && v !== 0)) return v.toExponential(8).replace(/\.?0+e/, 'e'); return String(parseFloat(v.toPrecision(12))); }
var UNITS = {
  Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 },
  Weight: { kg: 1, g: 0.001, mg: 0.000001, lb: 0.45359237, oz: 0.028349523125 },
  Volume: { L: 1, mL: 0.001, gal: 3.785411784, qt: 0.946352946, cup: 0.2365882365, tbsp: 0.01478676478 },
  Area: { 'm²': 1, 'km²': 1e6, 'ha': 10000, 'ft²': 0.09290304, 'acre': 4046.8564224 }
};
function convertUnit(cat, v, from, to) {
  if (cat === 'Temperature') {
    var c = from === 'C' ? v : from === 'F' ? (v - 32) * 5 / 9 : v - 273.15;
    return to === 'C' ? c : to === 'F' ? c * 9 / 5 + 32 : c + 273.15;
  }
  return v * UNITS[cat][from] / UNITS[cat][to];
}
/* ================= UI infrastructure ================= */
var S = {
  page: 'records', tab: 'daily', date: today(), cal: today().slice(0, 7), month: today().slice(0, 7),
  f: { summary: { from: today().slice(0, 7) + '-01', to: today(), acct: '', cat: '', type: '' }, desc: { q: '', sort: 'total-desc', type: '', acct: '', cat: '' }, acct: { q: '', type: '' } },
  open: {}, stats: { mode: 'month', ref: today(), from: today().slice(0, 7) + '-01', to: today() },
  acct: '', acctTab: 'list', settings: 'calculator', calc: { tab: 'standard', expr: '', hist: [], deg: true, unit: { cat: 'Length', from: 'm', to: 'ft', val: '1' }, cur: { amt: '1000', from: 'USD', to: '' }, pct: { mode: 'of', a: '10', b: '200' } },
  imp: null, rest: null, rateMsg: ''
};
var PAGES = [['records', 'Records', 'M4 5h16M4 12h16M4 19h10'], ['stats', 'Statistics', 'M5 20V10M12 20V4M19 20v-7'], ['accounts', 'Accounts', 'M3 7h18v12H3zM3 7l3-3h12l3 3M16 13h2'], ['settings', 'Settings & Tools', 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4-2-1z']];
var RTABS = [['daily', 'Daily'], ['calendar', 'Calendar'], ['monthly', 'Monthly'], ['summary', 'Summary'], ['description', 'Description']];
function ico(d) { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>'; }

/* ---------- formatting ---------- */
function fmtDate(s, withDow) {
  if (!isDate(s)) return s; var d = parseYMD(s), f = DB.settings.dateFormat, out;
  if (f === 'YYYY-MM-DD') out = s;
  else if (f === 'DD/MM/YYYY') out = pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
  else if (f === 'MM/DD/YYYY') out = pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + '/' + d.getFullYear();
  else out = MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate() + ', ' + d.getFullYear();
  return (withDow ? DOW[d.getDay()] + ', ' : '') + out;
}
function fmtTime(s) {
  if (DB.settings.timeFormat === '24') return s; var h = +s.slice(0, 2); return ((h % 12) || 12) + ':' + s.slice(3) + ' ' + (h < 12 ? 'AM' : 'PM');
}
function cls(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }
function opt(val, label, sel) { return '<option value="' + esc(val) + '"' + (String(sel) === String(val) ? ' selected' : '') + '>' + esc(label) + '</option>'; }
function acctOptions(sel, o) {
  o = o || {}; var out = o.blank ? opt('', o.blank, sel) : '';
  DB.accounts.filter(function (a) { return o.all ? a.status !== 'deleted' : (a.status === 'active' || a.id === sel); }).forEach(function (a) { out += opt(a.id, a.name + (a.status === 'archived' ? ' (archived)' : ''), sel); });
  return out;
}
function allCats() { var s = {}, o = []; DB.categories.expense.concat(DB.categories.income).forEach(function (c) { if (!s[c]) { s[c] = 1; o.push(c); } }); DB.txns.forEach(function (t) { if (t.type !== 'transfer' && !s[t.category]) { s[t.category] = 1; o.push(t.category); } }); return o.sort(); }
function anyIcon(c) { return DB.categories.expense.indexOf(c) >= 0 || DB.catMeta['expense:' + c] ? catIcon('expense', c) : catIcon('income', c); }
function catOptions(sel, blank) { return (blank ? opt('', blank, sel) : '') + allCats().map(function (c) { return opt(c, anyIcon(c) + '  ' + c, sel); }).join(''); }
function stat(label, val, c, sub) { return '<div class="stat"><div class="sl">' + esc(label) + '</div><div class="sv ' + (c || '') + '">' + val + '</div>' + (sub ? '<div class="ss">' + sub + '</div>' : '') + '</div>'; }
function empty(title, text, btn) { return '<div class="empty"><div class="eico">' + ico('M3 7h18v12H3zM3 7l3-3h12l3 3') + '</div><h3>' + esc(title) + '</h3><p>' + text + '</p>' + (btn || '') + '</div>'; }
function toggle(name, checked, label, hint) { return '<label class="tgl"><input type="checkbox" data-s="' + name + '"' + (checked ? ' checked' : '') + '><span class="sw"></span><span class="tl">' + esc(label) + (hint ? '<small>' + hint + '</small>' : '') + '</span></label>'; }

/* ---------- transaction rows ---------- */
function txnRow(t, o) {
  o = o || {}; var A = acctById(t.account), B = t.toAccount ? acctById(t.toAccount) : null, S0 = DB.settings, sign, c, badge = '';
  if (t.type === 'income') { sign = 1; c = 'pos'; } else if (t.type === 'expense') { sign = -1; c = 'neg'; } else { sign = 0; c = 'xfer'; }
  var accTxt = t.type === 'transfer' ? esc(acctName(t.account)) + ' → ' + esc(acctName(t.toAccount)) : esc(acctName(t.account));
  if (t.type === 'transfer') badge = isSettlement(t) ? '<span class="bdg set">Liability payment</span>' : '<span class="bdg xf">Transfer</span>';
  if (t.parentId) badge = '<span class="bdg fee">Fee</span>';
  if (S0.cardBadge && t.type === 'expense' && isCard(A)) badge += '<span class="bdg card">Card</span>';
  var meta = [t.type === 'transfer' ? '' : esc(t.category), accTxt];
  if (o.showDate !== false) meta.unshift('<b class="tdate">' + esc(fmtDate(t.date)) + '</b>');
  if (S0.showTime) meta.push(esc(fmtTime(t.time)));
  if (t.method && t.type !== 'transfer') meta.push(esc(t.method));
  var cur = A && A.currency !== S0.currency.code ? A.currency : null;
  var amt = (sign < 0 ? '−' : sign > 0 ? '+' : '') + fmtMoney(t.amount, A ? A.currency : null);
  var bv = o.balance != null ? o.balance : (o.rb && o.rb[t.id] != null ? o.rb[t.id] : null), bal = bv != null ? '<div class="rb">Bal ' + fmtMoney(bv, A ? A.currency : null) + '</div>' : '';
  return '<div class="trow' + (S0.compact ? ' compact' : '') + '" data-act="editTxn" data-id="' + esc(t.id) + '" tabindex="0" role="button">' +
    '<span class="cico" style="--cc:var(--c' + (t.type === 'transfer' ? 0 : catIndex(t.type, t.category) + 1) + ')" aria-hidden="true">' + (t.type === 'transfer' ? (isSettlement(t) ? '💳' : '🔁') : catIcon(t.type, t.category)) + '</span>' +
    '<div class="tmain"><div class="tdesc">' + esc(t.desc) + badge + '</div><div class="tmeta">' + meta.filter(Boolean).join(' · ') + '</div>' +
    (S0.showNotes && t.notes ? '<div class="tnote">' + esc(t.notes) + '</div>' : '') + '</div>' +
    '<div class="tamt ' + c + '">' + amt + bal + '</div></div>';
}
function txnList(list, o) {
  o = o || {};
  if (!list.length) return o.emptyHtml ? o.emptyHtml : '<div class="muted pad">No transactions.</div>';
  var byDate = /^date/.test(DB.settings.sort) && o.group !== false, out = '', cur = null;
  var totals = {}; if (byDate) list.forEach(function (t) { (totals[t.date] = totals[t.date] || []).push(t); });
  list.forEach(function (t) {
    if (byDate && t.date !== cur) {
      cur = t.date; var s = summarize(totals[cur]);
      out += '<div class="dhead"><span class="dh1">' + esc(fmtDate(cur, true)) + '</span><span class="dh2">' + (s.income ? '<span class="pos">+' + fmtMoney(s.income) + '</span>' : '') + (s.expense ? '<span class="neg">−' + fmtMoney(s.expense) + '</span>' : '') + '</span></div>';
    }
    out += txnRow(t, o);
  });
  return '<div class="tlist">' + out + '</div>';
}

/* ---------- modal / confirm / toast ---------- */
var modalStack = [];
function openModal(title, body, o) {
  o = o || {}; closeModal(true);
  var el = document.createElement('div'); el.className = 'modal-wrap'; el.innerHTML = '<div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="mhead"><h2>' + esc(title) + '</h2><button class="x" data-act="closeModal" aria-label="Close">×</button></div><div class="mbody">' + body + '</div></div>';
  el.addEventListener('mousedown', function (e) { if (e.target === el && !o.sticky) closeModal(); });
  document.body.appendChild(el); document.body.classList.add('noscroll'); el._o = o;
  var f = $('input:not([type=hidden]),select,textarea', el); if (f && !o.noFocus && window.innerWidth > 700) f.focus();
  modalStack.push(el); return el;
}
function closeModal(quiet) {
  var el = modalStack.pop(); if (el) { el.remove(); if (!modalStack.length) document.body.classList.remove('noscroll'); }
  if (!quiet && el && el._o && el._o.onClose) el._o.onClose();
}
function confirmBox(title, msg, okLabel, onOk, o) {
  o = o || {}; var el = document.createElement('div'); el.className = 'modal-wrap top';
  el.innerHTML = '<div class="modal small" role="alertdialog" aria-modal="true"><div class="mhead"><h2>' + esc(title) + '</h2></div><div class="mbody"><p>' + msg + '</p>' +
    (o.typed ? '<label class="fld"><span>Type <b>' + esc(o.typed) + '</b> to confirm</span><input id="cfType" autocomplete="off"></label>' : '') +
    '<div class="btns"><button class="btn" data-cf="no">Cancel</button><button class="btn ' + (o.safe ? 'primary' : 'danger') + '" data-cf="yes"' + (o.typed ? ' disabled' : '') + '>' + esc(okLabel) + '</button></div></div></div>';
  document.body.appendChild(el); document.body.classList.add('noscroll');
  function done() { el.remove(); if (!modalStack.length) document.body.classList.remove('noscroll'); }
  el.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cf]'); if (!b) return; var yes = b.getAttribute('data-cf') === 'yes'; done(); if (yes) onOk();
  });
  if (o.typed) $('#cfType', el).addEventListener('input', function (e) { $('[data-cf=yes]', el).disabled = e.target.value.trim() !== o.typed; });
  var nb = $('[data-cf=no]', el); if (nb) nb.focus();
}
function toast(msg, kind) {
  var box = $('#toasts'); if (!box) return; var t = document.createElement('div'); t.className = 'toast ' + (kind || 'ok'); t.setAttribute('role', 'status'); t.textContent = msg; box.appendChild(t);
  setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, kind === 'err' ? 6000 : 3200);
}
function commit(msg) { // persist + refresh
  var ok = save(); if (!ok) toast('Could not save to this browser (' + (lastSaveError || 'storage unavailable') + '). Download a backup now.', 'err'); else if (msg) toast(msg);
  render();
}
function showErrors(form, errs) {
  $$('.err', form).forEach(function (e) { e.textContent = ''; });
  $$('.bad', form).forEach(function (e) { e.classList.remove('bad'); });
  var first = null;
  Object.keys(errs).forEach(function (k) {
    var box = $('.err[data-for="' + k + '"]', form) || $('.err[data-for="_"]', form); if (box) box.textContent = errs[k];
    var inp = $('[name="' + k + '"]', form); if (inp) { inp.classList.add('bad'); if (!first) first = inp; }
  });
  if (first) first.focus();
}
function fld(label, name, inner, hint) { return '<label class="fld"><span>' + esc(label) + '</span>' + inner + (hint ? '<small>' + hint + '</small>' : '') + '<div class="err" data-for="' + name + '"></div></label>'; }
function fv(form, name) { var e = form.elements[name]; return e ? e.value : ''; }

/* ---------- shell ---------- */
function render() {
  var act = document.activeElement, keep = act && act.getAttribute && act.getAttribute('data-f'), pos = act && act.selectionStart;
  var main = $('#view'); if (!main) return;
  var scroll = window.scrollY;
  main.innerHTML = ({ records: pageRecords, stats: pageStats, accounts: pageAccounts, settings: pageSettings })[S.page]();
  $$('.nav a').forEach(function (a) { var on = a.getAttribute('data-page') === S.page; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  var banner = $('#banner'); var sp = typeof SYNC !== 'undefined' && SYNC.on && ['offline', 'error', 'unavailable', 'auth', 'conflict'].indexOf(SYNC.state) >= 0 ? '<div class="warn">⚠ ' + esc(SYNC.msg || 'Sync problem') + ' <a href="#/settings/sync">Sync settings</a></div>' : '';
  banner.innerHTML = sp + (!storageOK ? '<div class="warn">⚠ This browser is not saving your data (' + esc(lastSaveError || 'storage unavailable or blocked') + '). Your records will be lost when you close the tab. Use Settings → Backup & Restore → Download backup.</div>' : '');
  if (S.page === 'stats') drawCharts();
  if (S.page === 'settings') afterSettingsRender();
  if (keep) { var el = $('[data-f="' + keep + '"]'); if (el) { el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } } }
  window.scrollTo(0, scroll);
  document.title = 'Finance Tracker'; if (typeof syncUi === 'function') syncUi();
}
function shell() {
  var nav = PAGES.map(function (p) { return '<a href="#/' + p[0] + '" data-page="' + p[0] + '">' + ico(p[2]) + '<span>' + p[1] + '</span></a>'; }).join('');
  return '<div class="app"><aside class="rail"><div class="brand"><span class="logo">₱</span><b>Finance Tracker</b></div><nav class="nav" aria-label="Main">' + nav + '</nav>' +
    '<div class="railfoot"><button class="syncstat off" id="syncStat" data-act="goSync">○ Sync off</button><button class="btn primary block" data-act="addTxn">+ Add transaction</button></div></aside>' +
    '<main class="content"><div id="banner"></div><div id="view"></div></main>' +
    '<nav class="nav bottom" aria-label="Main">' + nav + '</nav><button class="fab" data-act="addTxn" aria-label="Add transaction">+</button></div><div id="toasts" aria-live="polite"></div><div id="tip" class="tip" hidden></div>';
}

/* ---------- routing ---------- */
function readHash() {
  var p = location.hash.replace(/^#\/?/, '').split('/');
  if (['records', 'stats', 'accounts', 'settings'].indexOf(p[0]) >= 0) S.page = p[0];
  if (S.page === 'records' && RTABS.some(function (t) { return t[0] === p[1]; })) S.tab = p[1];
  if (S.page === 'settings' && p[1]) S.settings = p[1];
  if (S.page === 'accounts' && p[1]) { if (p[1] === 'settings') { S.acctTab = 'settings'; S.acct = ''; } else if (p[1] === 'list') { S.acctTab = 'list'; S.acct = ''; } else { S.acct = p[1]; S.acctTab = 'list'; } }
}
function go(h) { if (location.hash === '#/' + h) { readHash(); render(); } else location.hash = '#/' + h; }

/* ---------- events ---------- */
var ACT = {};
function setPath(path, v) { var root = S.f; if (path[0] === '$') { root = S; path = path.slice(1); } var p = path.split('.'), o = root; for (var i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = v; }
function wireEvents() {
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    if (el.tagName === 'A') e.preventDefault();
    var fn = ACT[el.getAttribute('data-act')]; if (fn) fn(el, e);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if ($('.modal-wrap.top')) { $('.modal-wrap.top [data-cf=no]').click(); } else if (modalStack.length) closeModal(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('trow')) { e.preventDefault(); e.target.click(); }
  });
  function onField(e) {
    var t = e.target, p = t.getAttribute && t.getAttribute('data-f');
    if (p) { if (p === '$date' && !isDate(t.value)) return; if (e.type === 'input' && t.tagName !== 'INPUT') return; if (e.type === 'input' && t.type !== 'text' && t.type !== 'search') return; setPath(p, t.value); render(); return; }
    if (t.hasAttribute && t.hasAttribute('data-mn') && e.type === 'change') { var w = t.closest('.mnav'); S[w.getAttribute('data-k')] = $('.sy', w).value + '-' + $('.sm', w).value; render(); return; }
    var s = t.getAttribute && t.getAttribute('data-s');
    if (s && e.type === 'change') { ACT.setting && ACT.setting(t); }
  }
  document.addEventListener('input', onField); document.addEventListener('change', onField);
  window.addEventListener('hashchange', function () { readHash(); render(); window.scrollTo(0, 0); });
}
/* ================= Charts (inline SVG, no libraries) ================= */
var CH = {};
function shortMoney(c) {
  var v = Math.abs(c) / 100, s = DB.settings.currency.symbol, sg = c < 0 ? '-' : '';
  if (v >= 1e9) return sg + s + (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (v >= 1e6) return sg + s + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e4) return sg + s + Math.round(v / 1e3) + 'k';
  if (v >= 1e3) return sg + s + (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return sg + s + Math.round(v);
}
function niceTicks(min, max, n) {
  if (max === min) { max = min + 100; }
  var raw = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
  var step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag; if (step < 100) step = 100; // never finer than 1 unit
  var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, t = [];
  for (var v = lo; v <= hi + step / 2; v += step) t.push(v);
  return t;
}
function chartCard(id, title, spec, note) {
  CH[id] = spec;
  return '<section class="card chartcard"><h3>' + esc(title) + '</h3>' + (note ? '<p class="muted sm">' + note + '</p>' : '') +
    '<div class="chart" data-chart="' + id + '"></div><details class="dt"><summary>View exact values</summary><div class="dtwrap" data-table="' + id + '"></div></details></section>';
}
function seriesTable(spec) {
  if (spec.kind === 'donut') {
    var tot = spec.items.reduce(function (s, i) { return s + i.value; }, 0);
    return '<table class="tbl"><thead><tr><th>Item</th><th class="r">Amount</th><th class="r">Share</th></tr></thead><tbody>' + spec.items.map(function (i) { return '<tr><td>' + esc(i.name) + '</td><td class="r">' + fmtMoney(i.value) + '</td><td class="r">' + (tot ? (i.value / tot * 100).toFixed(1) : 0) + '%</td></tr>'; }).join('') + '</tbody></table>';
  }
  return '<table class="tbl"><thead><tr><th></th>' + spec.series.map(function (s) { return '<th class="r">' + esc(s.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
    spec.labels.map(function (l, i) { return '<tr><td>' + esc(spec.full ? spec.full[i] : l) + '</td>' + spec.series.map(function (s) { return '<td class="r ' + (spec.signed ? cls(s.values[i]) : '') + '">' + fmtMoney(s.values[i]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
}
function plotFrame(W, H, labels, ticks, M) {
  var pw = W - M.l - M.r, ph = H - M.t - M.b, lo = ticks[0], hi = ticks[ticks.length - 1];
  function y(v) { return M.t + ph - (v - lo) / (hi - lo) * ph; }
  var g = '';
  ticks.forEach(function (t) { g += '<line class="grid' + (t === 0 ? ' zero' : '') + '" x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text class="ax" x="' + (M.l - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + shortMoney(t) + '</text>'; });
  var n = labels.length, gw = pw / n, every = Math.max(1, Math.ceil(46 / gw));
  labels.forEach(function (l, i) { if (i % every === 0) g += '<text class="ax" x="' + (M.l + gw * i + gw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(l) + '</text>'; });
  return { svg: g, y: y, gw: gw, pw: pw, ph: ph };
}
function drawBars(spec, W) {
  var H = 240, M = { l: 48, r: 8, t: 10, b: 28 }, all = [0];
  spec.series.forEach(function (s) { all = all.concat(s.values); });
  var ticks = niceTicks(Math.min.apply(null, all), Math.max.apply(null, all), 4), F = plotFrame(W, H, spec.labels, ticks, M), out = F.svg, ns = spec.series.length;
  var bw = Math.max(2, Math.min(30, (F.gw * 0.78) / ns)), y0 = F.y(0);
  spec.labels.forEach(function (l, i) {
    var x0 = M.l + F.gw * i + (F.gw - bw * ns) / 2, tip = (spec.full ? spec.full[i] : l);
    spec.series.forEach(function (s, k) {
      var v = s.values[i], yy = F.y(v), top = Math.min(yy, y0), h = Math.max(Math.abs(yy - y0), v ? 1 : 0);
      var c = spec.signed ? (v >= 0 ? 'pos' : 'neg') : s.cls;
      out += '<rect class="bar ' + c + '" x="' + (x0 + k * bw) + '" y="' + top + '" width="' + (bw - (ns > 1 && bw > 6 ? 1 : 0)) + '" height="' + h + '" rx="2"/>';
      tip += '\n' + s.name + ': ' + (spec.signed ? fmtMoney(v, null, true) : fmtMoney(v));
    });
    out += '<rect class="hit" tabindex="0" x="' + (M.l + F.gw * i) + '" y="' + M.t + '" width="' + F.gw + '" height="' + F.ph + '" data-tip="' + esc(tip) + '"/>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(spec.aria || 'Chart') + '">' + out + '</svg>' + legend(spec);
}
function drawLines(spec, W) {
  var H = 240, M = { l: 48, r: 12, t: 10, b: 28 }, all = [0];
  spec.series.forEach(function (s) { all = all.concat(s.values); });
  var ticks = niceTicks(Math.min.apply(null, all), Math.max.apply(null, all), 4), F = plotFrame(W, H, spec.labels, ticks, M), out = F.svg, n = spec.labels.length;
  function px(i) { return M.l + F.gw * i + F.gw / 2; }
  spec.series.forEach(function (s) {
    out += '<polyline class="line ' + s.cls + '" fill="none" points="' + s.values.map(function (v, i) { return px(i).toFixed(1) + ',' + F.y(v).toFixed(1); }).join(' ') + '"/>';
    if (n <= 40) s.values.forEach(function (v, i) { out += '<circle class="pt ' + s.cls + '" cx="' + px(i).toFixed(1) + '" cy="' + F.y(v).toFixed(1) + '" r="3"/>'; });
  });
  spec.labels.forEach(function (l, i) {
    var tip = spec.full ? spec.full[i] : l; spec.series.forEach(function (s) { tip += '\n' + s.name + ': ' + fmtMoney(s.values[i]); });
    out += '<rect class="hit" tabindex="0" x="' + (M.l + F.gw * i) + '" y="' + M.t + '" width="' + F.gw + '" height="' + F.ph + '" data-tip="' + esc(tip) + '"/>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(spec.aria || 'Chart') + '">' + out + '</svg>' + legend(spec);
}
function legend(spec) {
  if (spec.signed) return '<div class="legend"><span><i class="sq pos"></i>Positive cash flow</span><span><i class="sq neg"></i>Negative cash flow</span></div>';
  if (spec.series.length < 2) return '';
  return '<div class="legend">' + spec.series.map(function (s) { return '<span><i class="sq ' + s.cls + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>';
}
function drawDonut(spec, W) {
  var items = spec.items, tot = items.reduce(function (s, i) { return s + i.value; }, 0);
  if (!tot) return '<div class="muted pad center">Nothing to show for this period.</div>';
  var D = Math.min(190, W - 10), r = D / 2 - 4, ri = r * 0.6, cx = D / 2, cy = D / 2, a0 = -Math.PI / 2, out = '';
  items.forEach(function (it, i) {
    var frac = it.value / tot, a1 = a0 + frac * Math.PI * 2, tip = it.name + '\n' + fmtMoney(it.value) + ' (' + (frac * 100).toFixed(1) + '%)', c = 'c' + ((it.ci != null ? it.ci : i) % 8 + 1);
    if (frac > 0.9999) out += '<path class="slice ' + c + '" tabindex="0" data-tip="' + esc(tip) + '" fill-rule="evenodd" d="M' + (cx - r) + ',' + cy + 'a' + r + ',' + r + ' 0 1,0 ' + 2 * r + ',0a' + r + ',' + r + ' 0 1,0 ' + (-2 * r) + ',0M' + (cx - ri) + ',' + cy + 'a' + ri + ',' + ri + ' 0 1,1 ' + 2 * ri + ',0a' + ri + ',' + ri + ' 0 1,1 ' + (-2 * ri) + ',0z"/>';
    else {
      var lg = frac > 0.5 ? 1 : 0, x1 = cx + r * Math.cos(a0), y1 = cy + r * Math.sin(a0), x2 = cx + r * Math.cos(a1), y2 = cy + r * Math.sin(a1), x3 = cx + ri * Math.cos(a1), y3 = cy + ri * Math.sin(a1), x4 = cx + ri * Math.cos(a0), y4 = cy + ri * Math.sin(a0);
      out += '<path class="slice ' + c + '" tabindex="0" data-tip="' + esc(tip) + '" d="M' + x1 + ',' + y1 + 'A' + r + ',' + r + ' 0 ' + lg + ' 1 ' + x2 + ',' + y2 + 'L' + x3 + ',' + y3 + 'A' + ri + ',' + ri + ' 0 ' + lg + ' 0 ' + x4 + ',' + y4 + 'Z"/>';
    }
    a0 = a1;
  });
  out += '<text class="dc1" x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle">' + esc(spec.centerLabel || 'Total') + '</text><text class="dc2" x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle">' + esc(shortMoney(tot)) + '</text>';
  var leg = items.slice(0, 12).map(function (it, i) { return '<li><i class="sq c' + ((it.ci != null ? it.ci : i) % 8 + 1) + '"></i><span class="ln">' + esc(it.name) + '</span><span class="lv">' + fmtMoney(it.value) + '</span><span class="lp">' + (it.value / tot * 100).toFixed(1) + '%</span></li>'; }).join('');
  return '<div class="donut"><svg viewBox="0 0 ' + D + ' ' + D + '" width="' + D + '" height="' + D + '" role="img" aria-label="' + esc(spec.aria || 'Chart') + '">' + out + '</svg><ul class="dleg">' + leg + (items.length > 12 ? '<li class="muted">+ ' + (items.length - 12) + ' more (see exact values)</li>' : '') + '</ul></div>';
}
function drawCharts() {
  $$('.chart[data-chart]').forEach(function (el) {
    var spec = CH[el.getAttribute('data-chart')]; if (!spec) return;
    var W = Math.max(260, Math.floor(el.clientWidth || 300));
    if (!spec.items && !spec.series[0].values.length) { el.innerHTML = '<div class="muted pad center">No data.</div>'; return; }
    el.innerHTML = spec.kind === 'bar' ? drawBars(spec, W) : spec.kind === 'line' ? drawLines(spec, W) : drawDonut(spec, W);
    var tb = $('[data-table="' + el.getAttribute('data-chart') + '"]'); if (tb) tb.innerHTML = seriesTable(spec);
  });
}
function wireChartTips() {
  var tip = $('#tip'), cur = null;
  function show(el, x, y) {
    var s = el.getAttribute('data-tip'); if (!s) return; var lines = s.split('\n');
    tip.innerHTML = '<b>' + esc(lines[0]) + '</b>' + lines.slice(1).map(function (l) { return '<div>' + esc(l) + '</div>'; }).join(''); tip.hidden = false; cur = el;
    var w = tip.offsetWidth, h = tip.offsetHeight, nx = Math.min(Math.max(8, x + 12), window.innerWidth - w - 8), ny = y - h - 12; if (ny < 8) ny = y + 18;
    tip.style.left = nx + 'px'; tip.style.top = ny + 'px';
  }
  function hide() { tip.hidden = true; cur = null; }
  document.addEventListener('mouseover', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) { $$('.hit.on').forEach(function (h) { h.classList.remove('on'); }); t.classList.add('on'); show(t, e.clientX, e.clientY); } });
  document.addEventListener('mousemove', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) show(t, e.clientX, e.clientY); else if (cur) hide(); });
  document.addEventListener('mouseout', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) { t.classList.remove('on'); hide(); } });
  document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) { $$('.hit.on').forEach(function (h) { h.classList.remove('on'); }); t.classList.add('on'); show(t, e.clientX, e.clientY); } else hide(); });
  document.addEventListener('focusin', function (e) { var t = e.target; if (t.getAttribute && t.getAttribute('data-tip')) { var b = t.getBoundingClientRect(); show(t, b.left + b.width / 2, b.top + 20); } });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', debounce(function () { if (S.page === 'stats') drawCharts(); }, 150));
}
/* ================= Transaction form ================= */
function descSuggestions() {
  var seen = {}, out = []; sortTxns(DB.txns, 'date-desc').slice(0, 400).forEach(function (t) { if (t.parentId || seen[t.desc.toLowerCase()]) return; seen[t.desc.toLowerCase()] = 1; out.push(t.desc); });
  return out.slice(0, 60).map(function (d) { return '<option value="' + esc(d) + '">'; }).join('');
}
function defaultAccountId() {
  var d = DB.settings.defaultAccount, a = acctById(d); if (a && a.status === 'active') return d;
  var f = activeAccounts()[0]; return f ? f.id : '';
}
function catSelectFor(type, sel) {
  var ty = type === 'income' ? 'income' : 'expense', list = DB.categories[ty].slice(); if (sel && list.indexOf(sel) < 0) list.push(sel);
  return list.map(function (c) { return opt(c, catIcon(ty, c) + '  ' + c, sel); }).join('') + '<option value="__new__">＋ New category…</option>';
}
function iconPicker(sel) { return '<div class="icons" role="radiogroup" aria-label="Icon">' + ICON_CHOICES.map(function (e) { return '<button type="button" class="ic' + (e === sel ? ' on' : '') + '" data-act="pickIcon" data-i="' + e + '" aria-label="' + e + '">' + e + '</button>'; }).join('') + '</div>'; }
function colorPicker(sel) { var o = ''; for (var i = 0; i < 8; i++) o += '<button type="button" class="cw' + (i === sel ? ' on' : '') + '" data-act="pickColor" data-c="' + i + '" style="background:var(--c' + (i + 1) + ')" aria-label="Colour ' + (i + 1) + '"></button>'; return '<div class="colors" role="radiogroup" aria-label="Colour">' + o + '</div>'; }
ACT.pickIcon = function (el) { var box = el.closest('.icons'); $$('.ic', box).forEach(function (b) { b.classList.remove('on'); }); el.classList.add('on'); var w = el.closest('form'); if (w && w.elements.ncicon) w.elements.ncicon.value = el.getAttribute('data-i'); };
ACT.pickColor = function (el) { var box = el.closest('.colors'); $$('.cw', box).forEach(function (b) { b.classList.remove('on'); }); el.classList.add('on'); var w = el.closest('form'); if (w && w.elements.nccolor) w.elements.nccolor.value = el.getAttribute('data-c'); };
function openTxnForm(o) {
  o = o || {};
  if (!activeAccounts().length) {
    openModal('Add a transaction', empty('Create an account first', 'Every transaction belongs to an account such as Cash, GCash or a bank.', '<div class="btns center"><button class="btn primary" data-act="starterAccounts">Add starter accounts</button><button class="btn" data-act="addAccount">Add my own account</button></div>'));
    return;
  }
  var t = o.id ? DB.txns.filter(function (x) { return x.id === o.id; })[0] : null, fee = 0;
  if (t && t.parentId) { return openTxnForm({ id: t.parentId }); }
  if (t) DB.txns.forEach(function (k) { if (k.parentId === t.id) fee = k.amount; });
  var type = t ? t.type : (o.type || 'expense'), acc = t ? t.account : (o.account || defaultAccountId());
  var v = { date: t ? t.date : (o.date || S.date || today()), time: t ? t.time : nowTime(), amount: t ? centsToInput(t.amount) : '', desc: t ? t.desc : '', cat: t ? t.category : '', method: t ? t.method : DB.settings.defaultMethod, notes: t ? t.notes : '', to: t ? t.toAccount : '', fee: fee ? centsToInput(fee) : '' };
  var seg = ['income', 'expense', 'transfer'].map(function (k) { return '<label class="seg ' + k + '"><input type="radio" name="type" value="' + k + '"' + (k === type ? ' checked' : '') + '><span>' + k[0].toUpperCase() + k.slice(1) + '</span></label>'; }).join('');
  var body = '<form id="txf" data-type="' + type + '" novalidate><div class="segs" role="radiogroup" aria-label="Type">' + seg + '</div>' +
    '<div class="row2 keep">' + fld('Date', 'date', '<input type="date" name="date" value="' + esc(v.date) + '" required>') + fld('Time', 'time', '<input type="time" name="time" value="' + esc(v.time) + '" required>') + '</div>' +
    fld('Amount (' + DB.settings.currency.symbol + ')', 'amount', '<input name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + esc(v.amount) + '" required>') +
    '<div class="row2">' + fld('Account', 'account', '<select name="account">' + acctOptions(acc) + '</select>') +
    '<div class="only-t">' + fld('To account', 'toAccount', '<select name="toAccount">' + acctOptions(v.to, { blank: 'Choose…' }) + '</select>') + '</div></div>' +
    '<div class="not-t">' + fld('Category', 'category', '<select name="category">' + catSelectFor(type, v.cat) + '</select>') + '<div class="newcat" hidden><label class="fld"><span>New category name</span><input name="ncname" maxlength="30" autocomplete="off" placeholder="e.g. Pets, Gym, Coffee"><div class="err" data-for="ncname"></div></label><input type="hidden" name="ncicon" value="🏷️"><input type="hidden" name="nccolor" value="0"><div class="muted sm">Pick an icon</div>' + iconPicker('🏷️') + '<div class="muted sm">Pick a colour</div>' + colorPicker(0) + '</div></div>' +
    fld('Description', 'desc', '<input name="desc" list="descs" maxlength="120" autocomplete="off" placeholder="What was this for?" value="' + esc(v.desc) + '"><datalist id="descs">' + descSuggestions() + '</datalist>') +
    '<div class="not-t">' + fld('Payment method', 'method', '<select name="method">' + (DB.methods.indexOf(v.method) < 0 && v.method ? opt(v.method, v.method, v.method) : '') + DB.methods.map(function (m) { return opt(m, m, v.method); }).join('') + '</select>') + '</div>' +
    ((DB.settings.askFee || fee) ? '<div class="only-t">' + fld('Transfer fee (optional)', 'fee', '<input name="fee" inputmode="decimal" autocomplete="off" placeholder="0.00" value="' + esc(v.fee) + '">', 'Recorded as a separate expense in “' + esc(DB.settings.feeCategory) + '”, charged to the source account.') + '</div>' : '') +
    '<div class="only-t hint-box" id="xferHint"></div>' +
    fld('Notes', 'notes', '<textarea name="notes" rows="2" maxlength="500">' + esc(v.notes) + '</textarea>') +
    (t ? '<div class="muted sm">ID: ' + esc(t.id) + '</div>' : '') +
    '<div class="err" data-for="_"></div><div class="btns">' + (t ? '<button type="button" class="btn danger left" data-act="delTxn" data-id="' + esc(t.id) + '">Delete</button>' : '') +
    '<button type="button" class="btn" data-act="closeModal">Cancel</button>' + (t ? '' : '<button type="submit" class="btn" data-more="1">Save & add another</button>') + '<button type="submit" class="btn primary">' + (t ? 'Save changes' : 'Save') + '</button></div></form>';
  var el = openModal(t ? 'Edit transaction' : 'Add transaction', body, { noFocus: false });
  var form = $('#txf', el); syncTypeUI(form);
  form.addEventListener('change', function (e) { if (e.target.name === 'type') { form.setAttribute('data-type', e.target.value); var cs = form.elements.category, cur = cs.value; cs.innerHTML = catSelectFor(e.target.value, ''); if ([].some.call(cs.options, function (x) { return x.value === cur; })) cs.value = cur; $('.newcat', form).hidden = cs.value !== '__new__'; syncTypeUI(form); } if (e.target.name === 'account' || e.target.name === 'toAccount') syncTypeUI(form); if (e.target.name === 'category') { var nc = $('.newcat', form); nc.hidden = e.target.value !== '__new__'; if (!nc.hidden) form.elements.ncname.focus(); } });
  var more = false; form.addEventListener('click', function (e) { more = !!e.target.getAttribute('data-more'); });
  form.addEventListener('submit', function (e) {
    e.preventDefault(); var typ = form.elements.type.value, catVal = fv(form, 'category'), newCat = null;
    if (typ !== 'transfer' && catVal === '__new__') {
      var nm = fv(form, 'ncname').trim(), tk = typ === 'income' ? 'income' : 'expense';
      if (!nm) return showErrors(form, { ncname: 'Enter a name for the new category.' });
      var ex = DB.categories[tk].filter(function (c) { return c.toLowerCase() === nm.toLowerCase(); })[0];
      newCat = { type: tk, name: ex || nm, existed: !!ex, icon: fv(form, 'ncicon'), ci: +fv(form, 'nccolor') }; catVal = newCat.name;
    }
    var res = saveTxn({ type: typ, date: fv(form, 'date'), time: fv(form, 'time'), amount: fv(form, 'amount'), account: fv(form, 'account'), toAccount: fv(form, 'toAccount'), category: catVal, desc: fv(form, 'desc'), method: fv(form, 'method'), notes: fv(form, 'notes'), fee: fv(form, 'fee') }, t ? t.id : null);
    if (!res.ok) { showErrors(form, res.errors); return; }
    if (newCat && !newCat.existed) { DB.categories[newCat.type].push(newCat.name); DB.catMeta[catKey(newCat.type, newCat.name)] = { icon: newCat.icon, ci: newCat.ci }; }
    S.date = res.txn.date; var added = !t;
    closeModal(true); commit(t ? 'Transaction updated.' : 'Transaction saved.');
    if (added && more) openTxnForm({ type: typ, account: res.txn.account, date: res.txn.date });
  });
}
function syncTypeUI(form) {
  var ty = form.elements.type.value, lbl = form.elements.account.closest('label').firstElementChild;
  lbl.textContent = ty === 'income' ? 'Deposit to account' : ty === 'expense' ? 'Paid from account' : 'From account';
  var hint = $('#xferHint', form); if (!hint) return;
  var to = acctById(fv(form, 'toAccount'));
  hint.textContent = to && kindOf(to) === 'liability' ? 'Paying a credit card or other liability: this reduces what you owe. It is not counted as spending, because the original purchases were already recorded as expenses.' : 'Transfers move money between your accounts. They are not income or expenses.';
}
ACT.addTxn = function (el) { openTxnForm({ date: el && el.getAttribute('data-date') || undefined, type: el && el.getAttribute('data-type') || undefined, account: el && el.getAttribute('data-acct') || undefined }); };
ACT.editTxn = function (el) { openTxnForm({ id: el.getAttribute('data-id') }); };
ACT.closeModal = function () { closeModal(); };
ACT.delTxn = function (el) {
  var id = el.getAttribute('data-id'), t = DB.txns.filter(function (x) { return x.id === id; })[0]; if (!t) return;
  var extra = t.type === 'transfer' && DB.txns.some(function (k) { return k.parentId === id; }) ? ' Its transfer fee will be deleted too.' : '';
  confirmBox('Delete this transaction?', '<b>' + esc(t.desc) + '</b> · ' + fmtMoney(t.amount, (acctById(t.account) || {}).currency) + ' on ' + esc(fmtDate(t.date)) + '.' + extra + '<br>Balances and reports will update. This can’t be undone.', 'Delete permanently', function () {
    deleteTxn(id); closeModal(true); commit('Transaction deleted.');
  });
};
/* ================= Page 1: Records ================= */
function monthNav(key, k) { // k = state key name holding 'YYYY-MM'
  var y0 = +key.slice(0, 4), m0 = key.slice(5, 7), yrs = [], minY = +today().slice(0, 4) - 6, maxY = +today().slice(0, 4) + 2;
  DB.txns.forEach(function (t) { var y = +t.date.slice(0, 4); if (y < minY) minY = y; if (y > maxY) maxY = y; }); if (y0 < minY) minY = y0; if (y0 > maxY) maxY = y0;
  for (var y = maxY; y >= minY; y--) yrs.push(y);
  return '<div class="mnav" data-k="' + k + '"><button class="ib" data-act="mshift" data-k="' + k + '" data-n="-12" aria-label="Previous year" title="Previous year">«</button><button class="ib" data-act="mshift" data-k="' + k + '" data-n="-1" aria-label="Previous month">‹</button>' +
    '<select class="sm" data-mn aria-label="Month">' + MONTHS.map(function (m, i) { return opt(pad2(i + 1), m, m0); }).join('') + '</select><select class="sy" data-mn aria-label="Year">' + yrs.map(function (y) { return opt(y, y, y0); }).join('') + '</select>' +
    '<button class="ib" data-act="mshift" data-k="' + k + '" data-n="1" aria-label="Next month">›</button><button class="ib" data-act="mshift" data-k="' + k + '" data-n="12" aria-label="Next year" title="Next year">»</button>' +
    '<button class="btn sm" data-act="mnow" data-k="' + k + '">This month</button></div>';
}
ACT.mshift = function (el) { var k = el.getAttribute('data-k'); S[k] = addMonthsKey(S[k], +el.getAttribute('data-n')); render(); };
ACT.mnow = function (el) { S[el.getAttribute('data-k')] = today().slice(0, 7); if (el.getAttribute('data-k') === 'cal') S.date = today(); render(); };
function totalsStats(s) { return stat('Income', fmtMoney(s.income), 'pos') + stat('Expenses', fmtMoney(s.expense), 'neg') + stat('Net total', fmtMoney(s.net, null, true), cls(s.net), 'Income − Expenses'); }
function pageRecords() {
  var tabs = '<div class="tabs" role="tablist">' + RTABS.map(function (t) { return '<a role="tab" href="#/records/' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + '</a>'; }).join('') + '</div>';
  var body = ({ daily: tabDaily, calendar: tabCalendar, monthly: tabMonthly, summary: tabSummary, description: tabDescription })[S.tab]();
  return '<header class="ph"><h1>Records</h1><button class="btn primary hide-m" data-act="addTxn" data-date="' + esc(S.date) + '">+ Add transaction</button></header>' + tabs + body;
}
function firstRunBanner() {
  if (DB.accounts.length) return '';
  return '<section class="card welcome"><h2>Welcome 👋</h2><p>Start by adding the places your money lives — Cash, GCash, a bank, a credit card — then record transactions. Everything is saved in this browser.</p><div class="btns"><button class="btn primary" data-act="starterAccounts">Add starter accounts</button><button class="btn" data-act="addAccount">Add my own account</button><button class="btn" data-act="loadSample">Try with sample data</button></div></section>';
}
function dayList(date) {
  var list = sortTxns(filterTxns({ from: date, to: date }), DB.settings.sort === 'date-desc' ? 'date-desc' : DB.settings.sort);
  return list;
}
function tabDaily() {
  var d = S.date, list = dayList(d), s = summarize(list);
  var nav = '<div class="datenav"><button class="ib" data-act="dshift" data-n="-1" aria-label="Previous day">‹</button><input type="date" data-f="$date" value="' + esc(d) + '" aria-label="Date"><button class="ib" data-act="dshift" data-n="1" aria-label="Next day">›</button><button class="btn sm" data-act="dnow">Today</button><span class="dlabel">' + esc(fmtDate(d, true)) + '</span></div>';
  return firstRunBanner() + nav + '<div class="stats3">' + totalsStats(s) + '</div>' +
    (s.transfers ? '<p class="muted sm">Transfers today: ' + fmtMoney(s.transfers) + ' (not counted as income or expense).</p>' : '') +
    '<section class="card"><div class="chead"><h3>Transactions · ' + list.length + '</h3><button class="btn primary sm" data-act="addTxn" data-date="' + esc(d) + '">+ Add</button></div>' +
    txnList(list, { group: false, emptyHtml: empty('Nothing recorded on this day', 'Add income, an expense or a transfer for ' + esc(fmtDate(d)) + '.', '<button class="btn primary" data-act="addTxn" data-date="' + esc(d) + '">+ Add transaction</button>') }) + '</section>';
}
ACT.dshift = function (el) { S.date = addDays(S.date, +el.getAttribute('data-n')); render(); };
ACT.dnow = function () { S.date = today(); render(); };

function tabCalendar() {
  var key = S.cal, ws = DB.settings.weekStart, first = key + '-01', last = monthEnd(key), nDays = +last.slice(8);
  var list = filterTxns({ from: first, to: last }), perDay = {};
  list.forEach(function (t) { var o = perDay[t.date] || (perDay[t.date] = { i: 0, e: 0, n: 0 }); o.n++; if (t.type === 'transfer') return; if (!reportable(t)) return; if (t.type === 'income') o.i += amtMain(t); else o.e += amtMain(t); });
  var off = (parseYMD(first).getDay() - ws + 7) % 7, cells = '';
  var heads = ''; for (var i = 0; i < 7; i++) heads += '<div class="dow">' + DOW[(ws + i) % 7] + '</div>';
  for (var b = 0; b < off; b++) cells += '<div class="day blank"></div>';
  for (var d = 1; d <= nDays; d++) {
    var ds = key + '-' + pad2(d), o = perDay[ds];
    cells += '<button class="day' + (o ? ' has' : '') + (ds === S.date ? ' sel' : '') + (ds === today() ? ' today' : '') + '" data-act="pickDay" data-date="' + ds + '" aria-label="' + esc(fmtDate(ds, true)) + (o ? ', ' + o.n + ' transactions' : '') + '"><span class="dn">' + d + '</span>' +
      (o ? (o.i ? '<span class="ci">+' + shortMoney(o.i).replace(DB.settings.currency.symbol, '') + '</span>' : '') + (o.e ? '<span class="ce">−' + shortMoney(o.e).replace(DB.settings.currency.symbol, '') + '</span>' : '') + '<span class="dots">' + (o.i ? '<i class="pos"></i>' : '') + (o.e ? '<i class="neg"></i>' : '') + (!o.i && !o.e ? '<i class="xf"></i>' : '') + '</span>' : '') + '</button>';
  }
  var sel = S.date, sl = dayList(sel), ss = summarize(sl), ms = summarize(list);
  var inMonth = monthKey(sel) === key;
  return firstRunBanner() + monthNav(key, 'cal') + '<div class="muted sm mline">' + esc(monthLabel(key)) + ': income <b class="pos">' + fmtMoney(ms.income) + '</b> · expenses <b class="neg">' + fmtMoney(ms.expense) + '</b> · net <b class="' + cls(ms.net) + '">' + fmtMoney(ms.net, null, true) + '</b></div>' +
    '<div class="cal" role="grid">' + heads + cells + '</div><div class="legend"><span><i class="sq pos"></i>Income</span><span><i class="sq neg"></i>Expenses</span><span><i class="sq xf"></i>Transfer only</span></div>' +
    '<section class="card"><div class="chead"><h3>' + esc(fmtDate(sel, true)) + '</h3><button class="btn primary sm" data-act="addTxn" data-date="' + esc(sel) + '">+ Add for this date</button></div><div class="stats3">' + totalsStats(ss) + '</div>' +
    txnList(sl, { group: false, emptyHtml: '<div class="muted pad">Nothing recorded on this date. Pick a highlighted day, or add a transaction.</div>' }) + (inMonth ? '' : '<p class="muted sm">This date is outside the month shown.</p>') + '</section>';
}
ACT.pickDay = function (el) { S.date = el.getAttribute('data-date'); render(); };

function catBars(items, total, type) {
  if (!items.length) return '<div class="muted pad">No ' + (type === 'income' ? 'income' : 'expenses') + ' this month.</div>';
  return '<ul class="bars">' + items.map(function (c) { var p = total ? c.value / total * 100 : 0; return '<li><div class="bl"><span class="cico sm" style="--cc:var(--c' + (c.ci + 1) + ')">' + c.icon + '</span><span class="bn">' + esc(c.name) + '</span><span class="bv">' + fmtMoney(c.value) + '</span><span class="bp">' + p.toFixed(1) + '%</span></div><div class="bt"><div class="bf c' + (c.ci + 1) + '" style="width:' + Math.max(p, 1.5).toFixed(1) + '%"></div></div></li>'; }).join('') + '</ul>';
}
function cmpRow(label, cur, prev, goodUp) {
  var d = cur - prev, pct = prev ? (d / Math.abs(prev) * 100) : null, good = d === 0 ? '' : ((d > 0) === goodUp ? 'pos' : 'neg');
  return '<tr><th>' + label + '</th><td class="r">' + fmtMoney(cur) + '</td><td class="r">' + fmtMoney(prev) + '</td><td class="r ' + good + '">' + (d === 0 ? 'no change' : fmtMoney(d, null, true)) + (pct == null ? '' : ' <small>(' + (pct > 0 ? '+' : '') + pct.toFixed(1) + '%)</small>') + '</td></tr>';
}
function tabMonthly() {
  var key = S.month, prev = addMonthsKey(key, -1), list = filterTxns({ from: monthStart(key), to: monthEnd(key) }), s = summarize(list), p = summarize(filterTxns({ from: monthStart(prev), to: monthEnd(prev) }));
  return firstRunBanner() + monthNav(key, 'month') + '<h2 class="mt">' + esc(monthLabel(key)) + '</h2><div class="stats3">' + totalsStats(s) + '</div>' +
    (DB.settings.cardSplit && s.cardExpense ? '<p class="muted sm">Of your expenses, ' + fmtMoney(s.cardExpense) + ' were charged to credit cards. They count as spending when purchased; paying the card later is a transfer, not new spending.</p>' : '') +
    (s.transfers ? '<p class="muted sm">Transfers this month: ' + fmtMoney(s.transfers) + ' (not income or expense).</p>' : '') +
    '<section class="card"><h3>Compared with ' + esc(monthLabel(prev)) + '</h3><div class="tscroll"><table class="tbl"><thead><tr><th></th><th class="r">' + esc(monthLabel(key, 1)) + '</th><th class="r">' + esc(monthLabel(prev, 1)) + '</th><th class="r">Change</th></tr></thead><tbody>' +
    cmpRow('Income', s.income, p.income, true) + cmpRow('Expenses', s.expense, p.expense, false) + cmpRow('Net total', s.net, p.net, true) + '</tbody></table></div></section>' +
    '<div class="grid2"><section class="card"><h3>Expenses by category</h3>' + catBars(byCategory(list, 'expense'), s.expense, 'expense') + '</section><section class="card"><h3>Income by source</h3>' + catBars(byCategory(list, 'income'), s.income, 'income') + '</section></div>';
}

/* ---------- Summary ---------- */
function summaryFilters(f, withType) {
  return '<div class="filters"><label>From<input type="date" data-f="summary.from" value="' + esc(f.from) + '"></label><label>To<input type="date" data-f="summary.to" value="' + esc(f.to) + '"></label>' +
    '<label>Account<select data-f="summary.acct">' + acctOptions(f.acct, { blank: 'All accounts', all: 1 }) + '</select></label><label>Category<select data-f="summary.cat">' + catOptions(f.cat, 'All categories') + '</select></label>' +
    '<label>Type<select data-f="summary.type">' + opt('', 'All types', f.type) + opt('income', 'Income', f.type) + opt('expense', 'Expense', f.type) + opt('transfer', 'Transfer', f.type) + '</select></label></div>' +
    '<div class="chips"><button class="chip" data-act="sumPreset" data-p="month">This month</button><button class="chip" data-act="sumPreset" data-p="last">Last month</button><button class="chip" data-act="sumPreset" data-p="year">This year</button><button class="chip" data-act="sumPreset" data-p="all">All time</button></div>';
}
ACT.sumPreset = function (el) {
  var p = el.getAttribute('data-p'), f = S.f.summary, t = today(), ds = DB.txns.map(function (x) { return x.date; }).sort();
  if (p === 'month') { f.from = t.slice(0, 7) + '-01'; f.to = t; }
  else if (p === 'last') { var k = addMonthsKey(t.slice(0, 7), -1); f.from = monthStart(k); f.to = monthEnd(k); }
  else if (p === 'year') { f.from = t.slice(0, 4) + '-01-01'; f.to = t; }
  else { f.from = ds[0] || t; f.to = t > (ds[ds.length - 1] || '') ? t : ds[ds.length - 1]; }
  render();
};
function tabSummary() {
  var f = S.f.summary, bad = f.from && f.to && f.from > f.to;
  var list = bad ? [] : filterTxns({ from: f.from, to: f.to, acct: f.acct, cat: f.cat, type: f.type }), s = summarize(list);
  var nw = netWorthFigures(f.to || today(), f.acct), miss = missingRates();
  var accNote = f.acct ? ' for ' + esc(acctName(f.acct)) : '';
  return firstRunBanner() + summaryFilters(f) + (bad ? '<div class="warn">The start date is after the end date.</div>' : '') +
    '<h3 class="mt">Cash flow <small class="muted">' + esc(fmtDate(f.from)) + ' – ' + esc(fmtDate(f.to)) + '</small></h3><div class="stats3 s4">' + stat('Total income', fmtMoney(s.income), 'pos') + stat('Total expenses', fmtMoney(s.expense), 'neg') + stat('Net cash flow', fmtMoney(s.net, null, true), cls(s.net), 'Income − Expenses') + stat('Total transfers', fmtMoney(s.transfers), '', 'Not income or expense') + '</div>' +
    '<h3 class="mt">Net worth <small class="muted">as of ' + esc(fmtDate(f.to || today())) + accNote + '</small></h3><div class="stats3">' + stat('Total assets', fmtMoney(nw.assets), 'pos') + stat('Total liabilities', fmtMoney(nw.liabilities), nw.liabilities ? 'neg' : '') + stat('Net worth', fmtMoney(nw.netWorth, null, true), cls(nw.netWorth), 'Assets − Liabilities') + '</div>' +
    '<p class="muted sm">Cash flow measures money moving in and out during the period. Net worth is what you own minus what you owe on the end date. They are different measures, so they need not match. Category and type filters apply to cash flow only; the account filter applies to both.</p>' +
    (miss.length ? '<div class="warn">No exchange rate set for ' + esc(miss.join(', ')) + '. Those balances are shown at 1:1 until you set a rate in Settings → Currency.</div>' : '') +
    '<section class="card"><div class="chead"><h3>Matching transactions · ' + list.length + '</h3></div>' + txnList(sortTxns(list).slice(0, 100), { emptyHtml: '<div class="muted pad">No transactions match these filters.</div>' }) + (list.length > 100 ? '<p class="muted sm">Showing the latest 100. Narrow the filters or export a CSV to see all.</p>' : '') + '</section>';
}

/* ---------- Description ---------- */
function tabDescription() {
  var f = S.f.desc, list = filterTxns({ q: f.q, type: f.type, acct: f.acct, cat: f.cat }), groups = {};
  list.forEach(function (t) {
    var k = t.desc.trim().toLowerCase(), g = groups[k] || (groups[k] = { key: k, name: t.desc.trim(), income: 0, expense: 0, transfers: 0, n: 0, last: '', cats: {}, items: [] });
    g.n++; g.items.push(t); g.cnt = g.cnt || {}; if (t.type !== 'transfer') g.cnt[t.category + '|' + t.type] = (g.cnt[t.category + '|' + t.type] || 0) + 1; if (t.date > g.last) { g.last = t.date; g.name = t.desc.trim(); }
    if (t.type !== 'transfer') g.cats[t.category] = 1;
    if (t.type === 'income' && reportable(t)) g.income += amtMain(t); else if (t.type === 'expense' && reportable(t)) g.expense += amtMain(t); else if (t.type === 'transfer') g.transfers += amtMain(t);
  });
  var arr = Object.keys(groups).map(function (k) {
    var g = groups[k], best = Object.keys(g.cnt || {}).sort(function (a, b) { return g.cnt[b] - g.cnt[a]; })[0];
    if (best) { var pr = best.split('|'); g.icon = catIcon(pr[1], pr[0]); g.ci = catIndex(pr[1], pr[0]); } else { g.icon = '🔁'; g.ci = -1; }
    return g;
  });
  arr.sort({ 'total-desc': function (a, b) { return (b.income + b.expense) - (a.income + a.expense); }, 'expense-desc': function (a, b) { return b.expense - a.expense; }, 'income-desc': function (a, b) { return b.income - a.income; }, 'count-desc': function (a, b) { return b.n - a.n; }, 'recent': function (a, b) { return b.last.localeCompare(a.last); }, 'name': function (a, b) { return a.name.localeCompare(b.name); } }[f.sort]);
  var tot = summarize(list);
  var head = '<div class="filters"><label class="grow">Search<input type="search" data-f="desc.q" value="' + esc(f.q) + '" placeholder="Description, category, account, notes, amount…"></label>' +
    '<label>Sort by<select data-f="desc.sort">' + opt('total-desc', 'Biggest total', f.sort) + opt('expense-desc', 'Most expenses', f.sort) + opt('income-desc', 'Most income', f.sort) + opt('count-desc', 'Most records', f.sort) + opt('recent', 'Most recent', f.sort) + opt('name', 'Name A–Z', f.sort) + '</select></label>' +
    '<label>Type<select data-f="desc.type">' + opt('', 'All types', f.type) + opt('income', 'Income', f.type) + opt('expense', 'Expense', f.type) + opt('transfer', 'Transfer', f.type) + '</select></label>' +
    '<label>Account<select data-f="desc.acct">' + acctOptions(f.acct, { blank: 'All accounts', all: 1 }) + '</select></label><label>Category<select data-f="desc.cat">' + catOptions(f.cat, 'All categories') + '</select></label></div>';
  var body = arr.length ? arr.map(function (g) {
    var open = S.open[g.key], cats = Object.keys(g.cats).slice(0, 3).join(', ');
    return '<section class="card grp"><button class="ghead" data-act="toggleGrp" data-k="' + esc(g.key) + '" aria-expanded="' + !!open + '"><span class="gname"><b>' + esc(g.name) + '</b><small>' + g.n + ' record' + (g.n > 1 ? 's' : '') + (cats ? ' · ' + esc(cats) : '') + ' · last ' + esc(fmtDate(g.last)) + '</small></span><span class="gtot">' + (g.income ? '<span class="pos">+' + fmtMoney(g.income) + '</span>' : '') + (g.expense ? '<span class="neg">−' + fmtMoney(g.expense) + '</span>' : '') + (!g.income && !g.expense ? '<span class="muted">' + fmtMoney(g.transfers) + ' moved</span>' : '') + '</span><span class="chev">' + (open ? '▾' : '▸') + '</span></button>' +
      (open ? txnList(sortTxns(g.items).slice(0, 80)) + (g.items.length > 80 ? '<p class="muted sm">Showing the latest 80.</p>' : '') + '<div class="gfoot"><span class="muted sm">Tap a row to edit it.</span><button class="btn sm" data-act="bulkDel" data-k="' + esc(g.key) + '">Delete all ' + g.n + '…</button></div>' : '') + '</section>';
  }).join('') : (DB.txns.length ? '<div class="muted pad">No records match your search.</div>' : empty('No history yet', 'Once you record transactions they are grouped here by description.', '<button class="btn primary" data-act="addTxn">+ Add transaction</button>'));
  return firstRunBanner() + head + '<p class="muted sm">' + arr.length + ' description' + (arr.length === 1 ? '' : 's') + ' · ' + list.length + ' records · income <b class="pos">' + fmtMoney(tot.income) + '</b> · expenses <b class="neg">' + fmtMoney(tot.expense) + '</b></p>' + body;
}
ACT.toggleGrp = function (el) { var k = el.getAttribute('data-k'); S.open[k] = !S.open[k]; render(); };
ACT.bulkDel = function (el) {
  var k = el.getAttribute('data-k'), f = S.f.desc, ids = filterTxns({ q: f.q, type: f.type, acct: f.acct, cat: f.cat }).filter(function (t) { return t.desc.trim().toLowerCase() === k; }).map(function (t) { return t.id; });
  confirmBox('Delete ' + ids.length + ' records?', 'This permanently deletes every record shown under “' + esc(k) + '” with the current filters (and the fees attached to any transfers). Balances and reports update. This can’t be undone.', 'Delete ' + ids.length + ' records', function () { ids.forEach(deleteTxn); commit(ids.length + ' records deleted.'); });
};
ACT.starterAccounts = function () {
  var defs = [['Cash on Hand', 'Cash', 'g_cash'], ['GCash', 'E-Wallet', 'g_ewallet'], ['Maya', 'E-Wallet', 'g_ewallet'], ['BDO Savings', 'Savings', 'g_bank'], ['Credit Card', 'Credit Card', 'g_card'], ['Emergency Fund', 'Savings', 'g_savings']], n = 0;
  defs.forEach(function (d) { if (!DB.accounts.some(function (a) { return a.name === d[0] && a.status !== 'deleted'; })) { saveAccount({ name: d[0], type: d[1], groupId: d[2], opening: '0', currency: DB.settings.currency.code, include: true }); n++; } });
  if (!DB.settings.defaultAccount) { var c = DB.accounts.filter(function (a) { return a.name === 'Cash on Hand'; })[0]; if (c) DB.settings.defaultAccount = c.id; }
  closeModal(true); commit(n + ' accounts added. Set their balances in Accounts.');
};
/* ================= Page 2: Statistics ================= */
function statsRange() {
  var st = S.stats, r = st.ref, ws = DB.settings.weekStart, from, to, label;
  if (st.mode === 'day') { from = to = r; label = fmtDate(r, true); }
  else if (st.mode === 'week') { from = weekStartOf(r, ws); to = addDays(from, 6); label = fmtDate(from) + ' – ' + fmtDate(to); }
  else if (st.mode === 'month') { from = monthStart(monthKey(r)); to = monthEnd(monthKey(r)); label = monthLabel(monthKey(r)); }
  else if (st.mode === 'year') { from = r.slice(0, 4) + '-01-01'; to = r.slice(0, 4) + '-12-31'; label = r.slice(0, 4); }
  else { from = st.from; to = st.to; label = fmtDate(from) + ' – ' + fmtDate(to); }
  return { from: from, to: to, label: label, bad: from > to };
}
ACT.statMode = function (el) { S.stats.mode = el.getAttribute('data-m'); render(); };
ACT.statShift = function (el) {
  var n = +el.getAttribute('data-n'), st = S.stats, m = st.mode;
  if (m === 'day') st.ref = addDays(st.ref, n); else if (m === 'week') st.ref = addDays(st.ref, 7 * n);
  else if (m === 'month') st.ref = monthStart(addMonthsKey(monthKey(st.ref), n)); else if (m === 'year') st.ref = (+st.ref.slice(0, 4) + n) + '-01-01';
  render();
};
ACT.statNow = function () { S.stats.ref = today(); render(); };
function pageStats() {
  var R = statsRange(), st = S.stats, CHs = '';
  var modes = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['custom', 'Custom']];
  var ctrl = '<div class="segs wide" role="group" aria-label="Period">' + modes.map(function (m) { return '<button class="segbtn' + (st.mode === m[0] ? ' on' : '') + '" data-act="statMode" data-m="' + m[0] + '">' + m[1] + '</button>'; }).join('') + '</div>' +
    (st.mode === 'custom' ? '<div class="filters"><label>From<input type="date" data-f="$stats.from" value="' + esc(st.from) + '"></label><label>To<input type="date" data-f="$stats.to" value="' + esc(st.to) + '"></label></div>' :
      '<div class="datenav"><button class="ib" data-act="statShift" data-n="-1" aria-label="Previous">‹</button><span class="dlabel strong">' + esc(R.label) + '</span><button class="ib" data-act="statShift" data-n="1" aria-label="Next">›</button><button class="btn sm" data-act="statNow">Today</button></div>');
  if (R.bad) return '<header class="ph"><h1>Statistics</h1></header>' + ctrl + '<div class="warn">The start date is after the end date.</div>';
  if (!DB.txns.length) return '<header class="ph"><h1>Statistics</h1></header>' + empty('No data to chart yet', 'Charts appear here and update automatically as you add transactions.', '<button class="btn primary" data-act="addTxn">+ Add transaction</button><button class="btn" data-act="loadSample">Try with sample data</button>');
  var list = filterTxns({ from: R.from, to: R.to }), s = summarize(list), span = daysBetween(R.from, R.to) + 1;
  var gran = st.mode === 'day' ? 'hour' : (st.mode === 'week' || st.mode === 'month') ? 'day' : st.mode === 'year' ? 'month' : (span <= 62 ? 'day' : span <= 900 ? 'month' : 'year');
  var rows = bucketize(list, R.from, R.to, gran);
  function lab(k) { return gran === 'hour' ? k : gran === 'day' ? (st.mode === 'week' || span <= 7 ? DOW[parseYMD(k).getDay()] + ' ' + +k.slice(8) : (span > 31 ? MONTHS[+k.slice(5, 7) - 1].slice(0, 3) + ' ' + +k.slice(8) : '' + +k.slice(8))) : gran === 'month' ? MONTHS[+k.slice(5, 7) - 1].slice(0, 3) + (span > 366 ? ' ' + k.slice(2, 4) : '') : k; }
  function full(k) { return gran === 'hour' ? k + ':00' : gran === 'day' ? fmtDate(k, true) : gran === 'month' ? monthLabel(k) : k; }
  var labels = rows.map(function (r) { return lab(r.key); }), fulls = rows.map(function (r) { return full(r.key); });
  var gl = { hour: 'by hour', day: 'by day', month: 'by month', year: 'by year' }[gran];
  var INC = { name: 'Income', cls: 'inc' }, EXP = { name: 'Expenses', cls: 'exp' };
  CHs += chartCard('c1', 'Income vs. expenses', { kind: 'bar', labels: labels, full: fulls, series: [{ name: 'Income', cls: 'inc', values: rows.map(function (r) { return r.income; }) }, { name: 'Expenses', cls: 'exp', values: rows.map(function (r) { return r.expense; }) }], aria: 'Income versus expenses ' + gl }, esc(R.label) + ', ' + gl + '.');
  CHs += chartCard('c8', 'Net cash flow', { kind: 'bar', signed: true, labels: labels, full: fulls, series: [{ name: 'Net', cls: 'inc', values: rows.map(function (r) { return r.net; }) }], aria: 'Net cash flow ' + gl }, 'Green bars: you earned more than you spent. Red bars: you spent more than you earned.');
  var dl = Math.min(31, Math.max(14, span)), dFrom = addDays(R.to, -(dl - 1)), drows = bucketize(filterTxns({ from: dFrom, to: R.to }), dFrom, R.to, 'day');
  CHs += chartCard('c2', 'Daily financial activity', { kind: 'line', labels: drows.map(function (r) { return '' + +r.key.slice(8); }), full: drows.map(function (r) { return fmtDate(r.key, true); }), series: [{ name: 'Income', cls: 'inc', values: drows.map(function (r) { return r.income; }) }, { name: 'Expenses', cls: 'exp', values: drows.map(function (r) { return r.expense; }) }], aria: 'Daily income and expenses' }, 'The ' + dl + ' days ending ' + esc(fmtDate(R.to)) + '.');
  var mTo = monthKey(R.to), mFrom = addMonthsKey(mTo, -11), mrows = bucketize(filterTxns({ from: monthStart(mFrom), to: monthEnd(mTo) }), monthStart(mFrom), monthEnd(mTo), 'month');
  CHs += chartCard('c3', 'Monthly trends', { kind: 'line', labels: mrows.map(function (r) { return MONTHS[+r.key.slice(5, 7) - 1].slice(0, 3); }), full: mrows.map(function (r) { return monthLabel(r.key); }), series: [{ name: 'Income', cls: 'inc', values: mrows.map(function (r) { return r.income; }) }, { name: 'Expenses', cls: 'exp', values: mrows.map(function (r) { return r.expense; }) }, { name: 'Net', cls: 'net', values: mrows.map(function (r) { return r.net; }) }], aria: 'Monthly trends' }, '12 months ending ' + esc(monthLabel(mTo)) + '.');
  var years = DB.txns.map(function (t) { return +t.date.slice(0, 4); }), y1 = +R.to.slice(0, 4), y0 = Math.max(Math.min.apply(null, years.concat([y1])), y1 - 9);
  var arows = bucketize(filterTxns({ from: y0 + '-01-01', to: y1 + '-12-31' }), y0 + '-01-01', y1 + '-12-31', 'year');
  CHs += chartCard('c4', 'Annual trends', { kind: 'bar', labels: arows.map(function (r) { return r.key; }), series: [{ name: 'Income', cls: 'inc', values: arows.map(function (r) { return r.income; }) }, { name: 'Expenses', cls: 'exp', values: arows.map(function (r) { return r.expense; }) }], aria: 'Annual trends' }, 'Year by year, up to 10 years.');
  CHs += chartCard('c5', 'Expense breakdown by category', { kind: 'donut', items: byCategory(list, 'expense'), centerLabel: 'Expenses', aria: 'Expenses by category' }, esc(R.label));
  CHs += chartCard('c6', 'Income breakdown by source', { kind: 'donut', items: byCategory(list, 'income'), centerLabel: 'Income', aria: 'Income by source' }, esc(R.label));
  var bal = computeBalances(R.to), items = [], liab = 0;
  DB.accounts.forEach(function (a, i) { if (!counted(a)) return; var v = toMain(bal[a.id], a.currency); if (kindOf(a) === 'liability') liab += -v; else if (v > 0) items.push({ name: a.name, value: v, ci: items.length }); });
  items.sort(function (a, b) { return b.value - a.value; }).forEach(function (x, i) { x.ci = i; });
  CHs += chartCard('c7', 'Account balance distribution', { kind: 'donut', items: items, centerLabel: 'Assets', aria: 'Account balances' }, 'Asset accounts with a positive balance on ' + esc(fmtDate(R.to)) + '.' + (liab ? ' Liabilities of ' + fmtMoney(liab) + ' are not shown here.' : ''));
  return '<header class="ph"><h1>Statistics</h1></header>' + ctrl + '<div class="stats3">' + totalsStats(s) + '</div><p class="muted sm">Transfers (' + fmtMoney(s.transfers) + ') are excluded from every chart except the account balance distribution.</p><div class="chartgrid">' + CHs + '</div>';
}
/* ================= Page 3: Accounts ================= */
function balText(a, bal) { // bal in account currency cents
  var k = kindOf(a); if (k === 'liability') return bal < 0 ? '<span class="neg">' + fmtMoney(-bal, a.currency) + '</span> <small>owed</small>' : bal > 0 ? '<span class="pos">' + fmtMoney(bal, a.currency) + '</span> <small>credit</small>' : fmtMoney(0, a.currency);
  return '<span class="' + (bal < 0 ? 'neg' : '') + '">' + fmtMoney(bal, a.currency) + '</span>';
}
function pageAccounts() {
  var head = '<header class="ph"><h1>Accounts</h1><div class="btns"><button class="btn" data-act="addTxn" data-type="transfer">⇄ Transfer</button><button class="btn primary" data-act="addAccount">+ Add account</button></div></header>';
  if (S.acct && acctById(S.acct) && acctById(S.acct).status !== 'deleted') return head + accountDetail(acctById(S.acct));
  S.acct = '';
  var tabs = '<div class="tabs"><a href="#/accounts/list" class="' + (S.acctTab === 'list' ? 'on' : '') + '">Accounts</a><a href="#/accounts/settings" class="' + (S.acctTab === 'settings' ? 'on' : '') + '">Account settings</a></div>';
  if (S.acctTab === 'settings') return head + tabs + accountSettingsPanel();
  var nw = netWorthFigures(), bal = computeBalances(), miss = missingRates();
  var cards = '<div class="stats3">' + stat('Total assets', fmtMoney(nw.assets), 'pos') + stat('Total liabilities', fmtMoney(nw.liabilities), nw.liabilities ? 'neg' : '') + stat('Net worth', fmtMoney(nw.netWorth, null, true), cls(nw.netWorth), 'Assets − Liabilities') + '</div>';
  var shown = DB.accounts.filter(function (a) { return a.status !== 'deleted'; });
  if (!shown.length) return head + tabs + '<section class="card welcome"><h2>No accounts yet</h2><p>Add the places your money lives. Liabilities such as credit cards are added the same way, in a liability group.</p><div class="btns"><button class="btn primary" data-act="starterAccounts">Add starter accounts</button><button class="btn" data-act="addAccount">Add my own account</button></div></section>';
  var groups = DB.groups.map(function (g) {
    var accts = shown.filter(function (a) { return a.groupId === g.id; }); if (!accts.length) return '';
    var sub = 0; accts.forEach(function (a) { if (counted(a)) sub += toMain(bal[a.id], a.currency); });
    return '<section class="card"><div class="chead"><h3>' + esc(g.name) + ' <span class="bdg ' + (g.kind === 'liability' ? 'fee' : 'xf') + '">' + g.kind + '</span></h3><div class="gsub">' + (g.kind === 'liability' ? (sub < 0 ? '<span class="neg">' + fmtMoney(-sub) + '</span> owed' : fmtMoney(sub)) : fmtMoney(sub)) + '</div></div><div class="alist">' +
      accts.map(function (a) {
        var foreign = a.currency !== DB.settings.currency.code;
        return '<a class="arow' + (a.status === 'archived' ? ' dim' : '') + '" href="#/accounts/' + a.id + '" data-act="openAcct" data-id="' + a.id + '"><div class="an"><b>' + esc(a.name) + '</b><small>' + esc(a.type) + (foreign ? ' · ' + esc(a.currency) : '') + (a.status === 'archived' ? ' · archived' : '') + (a.include === false ? ' · not in totals' : '') + '</small></div><div class="ab">' + balText(a, bal[a.id]) + (foreign && rateOf(a.currency) ? '<small class="muted">≈ ' + fmtMoney(toMain(bal[a.id], a.currency)) + '</small>' : '') + '</div></a>';
      }).join('') + '</div></section>';
  }).join('');
  return head + tabs + cards + (miss.length ? '<div class="warn">No exchange rate set for ' + esc(miss.join(', ')) + '. Those accounts are counted at 1:1 until you add a rate in Settings → Currency.</div>' : '') + '<p class="muted sm">Totals use each account’s current balance (opening balance + income − expenses + transfers in − transfers out). Accounts switched off “Include in totals” are left out.</p>' + groups;
}
ACT.openAcct = function (el) { S.acct = el.getAttribute('data-id'); S.f.acct = { q: '', type: '' }; location.hash = '#/accounts/' + S.acct; };
function accountDetail(a) {
  var bal = computeBalances()[a.id], f = S.f.acct, all = sortTxns(filterTxns({ acct: a.id }), 'date-asc'), run = a.opening, rb = {};
  all.forEach(function (t) { run += delta(t, a.id); rb[t.id] = run; });
  var list = filterTxns({ acct: a.id, q: f.q, type: f.type }); list = sortTxns(list, 'date-desc');
  var s = summarize(list.filter(function (t) { return t.account === a.id; }));
  var inn = 0, out = 0; all.forEach(function (t) { var d = delta(t, a.id); if (d > 0) inn += d; else out -= d; });
  return '<p><a href="#/accounts/list" class="back" data-act="backAcct">‹ All accounts</a></p><section class="card"><div class="chead"><div><h2>' + esc(a.name) + '</h2><div class="muted sm">' + esc(a.type) + ' · ' + esc(groupById(a.groupId).name) + ' · ' + esc(a.currency) + (a.status !== 'active' ? ' · <b>' + a.status + '</b>' : '') + (a.include === false ? ' · not in totals' : '') + '</div></div><div class="bigbal">' + balText(a, bal) + '</div></div>' +
    (a.notes ? '<p class="muted">' + esc(a.notes) + '</p>' : '') +
    '<div class="stats3"><div class="stat"><div class="sl">Opening balance</div><div class="sv">' + fmtMoney(a.opening, a.currency) + '</div></div><div class="stat"><div class="sl">Money in</div><div class="sv pos">' + fmtMoney(inn, a.currency) + '</div><div class="ss">income + transfers in</div></div><div class="stat"><div class="sl">Money out</div><div class="sv neg">' + fmtMoney(out, a.currency) + '</div><div class="ss">expenses + transfers out</div></div></div>' +
    '<div class="btns wrap"><button class="btn primary" data-act="addTxn" data-acct="' + a.id + '">+ Transaction</button><button class="btn" data-act="addTxn" data-type="transfer" data-acct="' + a.id + '">⇄ Transfer</button><button class="btn" data-act="editAcct" data-id="' + a.id + '">Edit</button>' +
    (a.status === 'archived' ? '<button class="btn" data-act="unarchive" data-id="' + a.id + '">Unarchive</button>' : '<button class="btn" data-act="archive" data-id="' + a.id + '">Archive</button>') + '<button class="btn danger" data-act="delAcct" data-id="' + a.id + '">Delete…</button></div></section>' +
    '<section class="card"><div class="chead"><h3>Transaction history · ' + list.length + '</h3></div><div class="filters"><label class="grow">Search<input type="search" data-f="acct.q" value="' + esc(f.q) + '" placeholder="Search this account"></label><label>Type<select data-f="acct.type">' + opt('', 'All types', f.type) + opt('income', 'Income', f.type) + opt('expense', 'Expense', f.type) + opt('transfer', 'Transfer', f.type) + '</select></label></div>' +
    (list.length ? txnList(list.slice(0, 200), { rb: rb }) + (list.length > 200 ? '<p class="muted sm">Showing the latest 200.</p>' : '') : '<div class="muted pad">No transactions for this account yet.</div>') + '</section>';
}
ACT.backAcct = function () { S.acct = ''; location.hash = '#/accounts/list'; };
ACT.archive = function (el) { var a = acctById(el.getAttribute('data-id')); setAccountStatus(a.id, 'archived'); commit('“' + a.name + '” archived. It stays in your totals but is hidden from new transactions.'); };
ACT.unarchive = function (el) { var a = acctById(el.getAttribute('data-id')); setAccountStatus(a.id, 'active'); commit('“' + a.name + '” is active again.'); };
ACT.delAcct = function (el) {
  var a = acctById(el.getAttribute('data-id')), n = DB.txns.filter(function (t) { return t.account === a.id || t.toAccount === a.id; }).length;
  confirmBox('Delete “' + a.name + '”?', 'The account moves to <b>Deleted accounts</b> (Account settings) where you can restore it. While deleted it is left out of totals, and its ' + n + ' transaction' + (n === 1 ? '' : 's') + ' are hidden from reports. Transfers it took part in keep the other account’s balance unchanged.', 'Delete account', function () {
    setAccountStatus(a.id, 'deleted'); S.acct = ''; if (location.hash !== '#/accounts/list') location.hash = '#/accounts/list'; commit('Account deleted. You can restore it in Account settings.');
  });
};
ACT.restoreAcct = function (el) { var a = acctById(el.getAttribute('data-id')); setAccountStatus(a.id, 'active'); commit('“' + a.name + '” restored.'); };
ACT.purgeAcct = function (el) {
  var a = acctById(el.getAttribute('data-id')), n = DB.txns.filter(function (t) { return t.type !== 'transfer' && t.account === a.id; }).length;
  confirmBox('Permanently delete “' + a.name + '”?', 'This erases the account and its ' + n + ' income/expense record' + (n === 1 ? '' : 's') + ' forever. Transfers with other accounts are removed, and the other account’s opening balance is adjusted so its balance stays the same. This can’t be undone — consider downloading a backup first.', 'Delete forever', function () { purgeAccount(a.id); commit('Account permanently deleted.'); });
};

/* ---------- account form ---------- */
ACT.addAccount = function () { openAccountForm(null); };
ACT.editAcct = function (el) { openAccountForm(el.getAttribute('data-id')); };
function openAccountForm(id) {
  var a = id ? acctById(id) : null, hasTx = a && DB.txns.some(function (t) { return t.account === a.id || t.toAccount === a.id; }), d = a ? txnDeltaFor(a.id) : 0;
  var g0 = a ? a.groupId : 'g_cash', kind0 = (groupById(g0) || {}).kind, s0 = kind0 === 'liability' ? -1 : 1;
  var body = '<form id="acf" novalidate>' + fld('Account name', 'name', '<input name="name" maxlength="60" value="' + esc(a ? a.name : '') + '" placeholder="e.g. GCash, BDO Savings" required>') +
    '<div class="row2">' + fld('Group', 'groupId', '<select name="groupId">' + DB.groups.map(function (g) { return opt(g.id, g.name + ' (' + g.kind + ')', g0); }).join('') + '</select>') + fld('Account type', 'type', '<select name="type">' + TYPES.map(function (t) { return opt(t, t, a ? a.type : 'Cash'); }).join('') + '</select>') + '</div>' +
    '<div class="row2">' + fld('Currency', 'currency', '<select name="currency"' + (hasTx ? ' disabled' : '') + '>' + CURRENCIES.map(function (c) { return opt(c.code, c.code + ' — ' + c.name, a ? a.currency : DB.settings.currency.code); }).join('') + '</select>', hasTx ? 'Locked because this account has transactions.' : '') +
    fld('Opening balance', 'opening', '<input name="opening" inputmode="decimal" autocomplete="off" value="' + esc(a ? centsToInput(s0 * a.opening) : '0.00') + '">') + '</div>' +
    (a ? fld('Current balance', 'current', '<input name="current" inputmode="decimal" autocomplete="off" value="' + esc(centsToInput(s0 * (a.opening + d))) + '">', 'Edit this to match your real balance. The opening balance is adjusted for you; your transactions stay as they are.') : '') +
    (a ? fld('Status', 'status', '<select name="status">' + opt('active', 'Active', a.status) + opt('archived', 'Archived (hidden from new transactions)', a.status) + '</select>') : '') +
    fld('Notes', 'notes', '<textarea name="notes" rows="2" maxlength="300">' + esc(a ? a.notes : '') + '</textarea>') +
    '<label class="tgl"><input type="checkbox" name="include"' + (!a || a.include !== false ? ' checked' : '') + '><span class="sw"></span><span class="tl">Include in totals<small>Counts toward assets, liabilities, net worth and reports.</small></span></label>' +
    '<div class="err" data-for="_"></div><div class="btns"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary" type="submit">' + (a ? 'Save changes' : 'Add account') + '</button></div></form>';
  var el = openModal(a ? 'Edit account' : 'Add account', body), form = $('#acf', el);
  function sign() { return (groupById(form.elements.groupId.value) || {}).kind === 'liability' ? -1 : 1; }
  function labels() { form.elements.opening.closest('label').firstElementChild.textContent = sign() < 0 ? 'Opening amount owed' : 'Opening balance'; var c = form.elements.current; if (c) c.closest('label').firstElementChild.textContent = sign() < 0 ? 'Currently owed' : 'Current balance'; }
  labels();
  form.addEventListener('input', function (e) {
    if (!a) return; var s = sign();
    if (e.target.name === 'opening') { var o = parseMoney(e.target.value, true, true); if (!o.err) form.elements.current.value = centsToInput(o.cents + s * d); }
    if (e.target.name === 'current') { var c = parseMoney(e.target.value, true, true); if (!c.err) form.elements.opening.value = centsToInput(c.cents - s * d); }
  });
  form.addEventListener('change', function (e) { if (e.target.name === 'groupId') labels(); if (e.target.name === 'type' && !a) { var t = e.target.value; if (t === 'Credit Card') form.elements.groupId.value = 'g_card'; } });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var res = saveAccount({ name: fv(form, 'name'), groupId: fv(form, 'groupId'), type: fv(form, 'type'), currency: hasTx ? a.currency : fv(form, 'currency'), opening: fv(form, 'opening'), notes: fv(form, 'notes'), include: form.elements.include.checked }, a ? a.id : null);
    if (!res.ok) { showErrors(form, res.errors); return; }
    if (a && form.elements.status) setAccountStatus(a.id, form.elements.status.value);
    closeModal(true); commit(a ? 'Account updated.' : 'Account added.');
  });
}

/* ---------- account settings (used here and in Settings → Accounts) ---------- */
function accountSettingsPanel() {
  var S0 = DB.settings, live = DB.accounts.filter(function (a) { return a.status !== 'deleted'; }), del = DB.accounts.filter(function (a) { return a.status === 'deleted'; });
  var groups = '<section class="card"><div class="chead"><h3>Account groups</h3><button class="btn sm primary" data-act="addGroup">+ Add group</button></div><div class="alist">' + DB.groups.map(function (g) {
    var n = DB.accounts.filter(function (a) { return a.groupId === g.id && a.status !== 'deleted'; }).length;
    return '<div class="arow"><div class="an"><b>' + esc(g.name) + '</b><small>' + g.kind + ' · ' + n + ' account' + (n === 1 ? '' : 's') + '</small></div><div class="btns"><button class="btn sm" data-act="editGroup" data-id="' + g.id + '">Edit</button><button class="btn sm danger" data-act="delGroup" data-id="' + g.id + '">Delete</button></div></div>';
  }).join('') + '</div><p class="muted sm">Asset groups hold what you own. Liability groups hold what you owe (credit cards, loans). Their balances are shown as “owed” and reduce your net worth.</p></section>';
  var accts = '<section class="card"><h3>Accounts & “Include in totals”</h3>' + (live.length ? '<div class="alist">' + live.map(function (a) {
    return '<div class="arow"><div class="an"><b>' + esc(a.name) + '</b><small>' + esc(groupById(a.groupId).name) + (a.status === 'archived' ? ' · archived' : '') + '</small></div><div class="btns">' + toggle('acct-inc:' + a.id, a.include !== false, 'In totals') + '<button class="btn sm" data-act="editAcct" data-id="' + a.id + '">Edit</button></div></div>';
  }).join('') + '</div>' : '<div class="muted pad">No accounts yet.</div>') + '<p class="muted sm">Switching an account off removes it from assets, liabilities, net worth and income/expense reports (useful for accounts you only track on the side).</p></section>';
  var feeCats = DB.categories.expense.map(function (c) { return opt(c, c, S0.feeCategory); }).join('');
  var xfer = '<section class="card"><h3>Transfer & expense settings</h3>' + toggle('askFee', S0.askFee, 'Show a transfer-fee field on transfers', 'A fee is saved as its own expense, charged to the source account. The transfer itself stays neutral.') +
    '<label class="fld"><span>Category used for transfer fees</span><select data-s="feeCategory">' + feeCats + '</select></label>' +
    '<p class="muted sm"><b>Credit cards:</b> record a purchase as an <b>expense</b> from the card account (your debt grows). When you pay the card, record a <b>transfer</b> from your bank or wallet to the card. That settles the liability and is never counted as spending, so nothing is counted twice.</p></section>';
  var card = '<section class="card"><h3>Card expense display</h3>' + toggle('cardBadge', S0.cardBadge, 'Show a “Card” tag on credit-card expenses', 'Shown in transaction lists.') + toggle('cardSplit', S0.cardSplit, 'Show how much spending was charged to cards', 'Shown on the Monthly tab.') + '<p class="muted sm">These options only change what is displayed. Totals always count card purchases as expenses on the purchase date.</p></section>';
  var arch = live.filter(function (a) { return a.status === 'archived'; });
  var archived = arch.length ? '<section class="card"><h3>Archived accounts</h3><div class="alist">' + arch.map(function (a) { return '<div class="arow"><div class="an"><b>' + esc(a.name) + '</b><small>Hidden from new transactions, still in totals</small></div><button class="btn sm" data-act="unarchive" data-id="' + a.id + '">Unarchive</button></div>'; }).join('') + '</div></section>' : '';
  var dels = '<section class="card"><h3>Deleted accounts</h3>' + (del.length ? '<div class="alist">' + del.map(function (a) { return '<div class="arow"><div class="an"><b>' + esc(a.name) + '</b><small>Deleted ' + esc(a.deletedAt ? fmtDate(a.deletedAt) : '') + '</small></div><div class="btns"><button class="btn sm" data-act="restoreAcct" data-id="' + a.id + '">Restore</button><button class="btn sm danger" data-act="purgeAcct" data-id="' + a.id + '">Delete forever</button></div></div>'; }).join('') + '</div>' : '<div class="muted pad">No deleted accounts.</div>') + '</section>';
  return groups + accts + xfer + card + archived + dels;
}
ACT.addGroup = function () { groupForm(null); };
ACT.editGroup = function (el) { groupForm(el.getAttribute('data-id')); };
function groupForm(id) {
  var g = id ? groupById(id) : null, used = g && DB.accounts.some(function (a) { return a.groupId === g.id; });
  var el = openModal(g ? 'Edit group' : 'Add group', '<form id="grf" novalidate>' + fld('Group name', 'name', '<input name="name" maxlength="40" value="' + esc(g ? g.name : '') + '">') + fld('Kind', 'kind', '<select name="kind"' + (used ? ' disabled' : '') + '>' + opt('asset', 'Asset — something you own', g ? g.kind : 'asset') + opt('liability', 'Liability — something you owe', g ? g.kind : 'asset') + '</select>', used ? 'Can’t change while accounts use this group.' : '') + '<div class="btns"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Save</button></div></form>');
  $('#grf', el).addEventListener('submit', function (e) {
    e.preventDefault(); var f = e.target, name = fv(f, 'name').trim();
    if (!name) return showErrors(f, { name: 'Enter a name.' });
    if (DB.groups.some(function (x) { return x.id !== (g && g.id) && x.name.toLowerCase() === name.toLowerCase(); })) return showErrors(f, { name: 'That group already exists.' });
    if (g) { g.name = name; if (!used) g.kind = fv(f, 'kind'); } else DB.groups.push({ id: uid('g'), name: name, kind: fv(f, 'kind') });
    closeModal(true); commit('Group saved.');
  });
}
ACT.delGroup = function (el) {
  var g = groupById(el.getAttribute('data-id'));
  if (DB.accounts.some(function (a) { return a.groupId === g.id; })) return toast('Move or delete the accounts in “' + g.name + '” first.', 'err');
  if (DB.groups.length <= 1) return toast('Keep at least one group.', 'err');
  confirmBox('Delete group “' + g.name + '”?', 'The group is empty, so no accounts are affected.', 'Delete group', function () { DB.groups = DB.groups.filter(function (x) { return x.id !== g.id; }); commit('Group deleted.'); });
};
/* ================= Page 4: Settings & Tools ================= */
var SSECT = [['calculator', 'Calculator'], ['transactions', 'Transaction settings'], ['theme', 'Theme'], ['help', 'Help'], ['accounts', 'Accounts'], ['currency', 'Currency'], ['backup', 'Backup & Restore'], ['sync', 'Sync']];
function pageSettings() {
  var nav = '<div class="chips scroll">' + SSECT.map(function (s) { return '<a class="chip' + (S.settings === s[0] ? ' on' : '') + '" href="#/settings/' + s[0] + '">' + s[1] + '</a>'; }).join('') + '</div>';
  var fn = { calculator: secCalc, transactions: secTxnSettings, theme: secTheme, help: secHelp, accounts: accountSettingsPanel, currency: secCurrency, backup: secBackup, sync: secSync }[S.settings] || secCalc;
  return '<header class="ph"><h1>Settings & Tools</h1></header>' + nav + fn();
}
function afterSettingsRender() { if (S.settings === 'currency') { var cf = $('#curf'); if (cf) curPreview(cf); } if (S.settings === 'calculator') calcRefresh(); if (S.settings === 'backup') backupRefresh(); }
function setSetting(k, v) { DB.settings[k] = v; }
ACT.setting = function (t) {
  var k = t.getAttribute('data-s'), v = t.type === 'checkbox' ? t.checked : t.value;
  if (k.indexOf('acct-inc:') === 0) { var a = acctById(k.slice(9)); if (a) a.include = v; }
  else if (k === 'weekStart') DB.settings.weekStart = +v;
  else DB.settings[k] = v;
  commit();
};
function secTxnSettings() {
  var s = DB.settings;
  function sel(k, opts) { return '<label class="fld"><span>' + opts[0] + '</span><select data-s="' + k + '">' + opts[1].map(function (o) { return opt(o[0], o[1], s[k]); }).join('') + '</select></label>'; }
  var catEd = ['expense', 'income'].map(function (ty) {
    return '<div class="catbox"><h4>' + (ty === 'expense' ? 'Expense' : 'Income') + ' categories</h4><ul class="catlist">' + DB.categories[ty].map(function (c, i) { return '<li><span class="cico sm" style="--cc:var(--c' + (catCi(ty, c) + 1) + ')">' + catIcon(ty, c) + '</span><span>' + esc(c) + '</span><button class="ib sm" data-act="editCat" data-t="' + ty + '" data-i="' + i + '" aria-label="Edit ' + esc(c) + '">✎</button><button class="ib sm" data-act="delCat" data-t="' + ty + '" data-i="' + i + '" aria-label="Delete ' + esc(c) + '">×</button></li>'; }).join('') + '</ul><button class="btn sm" data-act="addCat" data-t="' + ty + '">+ New category</button></div>';
  }).join('');
  return '<section class="card"><h3>Display & sorting</h3><div class="row2">' + sel('sort', ['Default sorting', [['date-desc', 'Newest first'], ['date-asc', 'Oldest first'], ['amount-desc', 'Largest amount'], ['amount-asc', 'Smallest amount']]]) +
    sel('defaultTab', ['Opening tab in Records', RTABS])+
    sel('dateFormat', ['Date format', [['MMM D, YYYY', 'Oct 5, 2026'], ['YYYY-MM-DD', '2026-10-05'], ['DD/MM/YYYY', '05/10/2026'], ['MM/DD/YYYY', '10/05/2026']]]) + sel('timeFormat', ['Time format', [['12', '12-hour (3:30 PM)'], ['24', '24-hour (15:30)']]]) +
    '<label class="fld"><span>Week starts on</span><select data-s="weekStart">' + opt(0, 'Sunday', s.weekStart) + opt(1, 'Monday', s.weekStart) + '</select></label>' +
    '<label class="fld"><span>Default account</span><select data-s="defaultAccount">' + acctOptions(s.defaultAccount, { blank: 'First active account' }) + '</select></label>' +
    '<label class="fld"><span>Default payment method</span><select data-s="defaultMethod">' + DB.methods.map(function (m) { return opt(m, m, s.defaultMethod); }).join('') + '</select></label></div>' +
    toggle('showTime', s.showTime, 'Show time in transaction lists') + toggle('showNotes', s.showNotes, 'Show notes in transaction lists') + toggle('compact', s.compact, 'Compact rows', 'Fit more transactions on screen.') + '</section>' +
    '<section class="card"><h3>Default categories</h3><div class="grid2">' + catEd + '</div><p class="muted sm">Tap ✎ to change a category’s name, icon or colour. Renaming updates your existing transactions. Deleting one keeps old transactions as they are.</p></section>' +
    '<section class="card"><h3>Payment methods</h3><div class="chips">' + DB.methods.map(function (m, i) { return '<span class="chip">' + esc(m) + ' <button class="ib sm" data-act="delMethod" data-i="' + i + '" aria-label="Remove ' + esc(m) + '">×</button></span>'; }).join('') + '<button class="chip" data-act="addMethod">+ Add</button></div></section>';
}
function nameForm(title, val, cb) {
  var el = openModal(title, '<form id="nf" novalidate><label class="fld"><span>Name</span><input name="n" maxlength="40" value="' + esc(val || '') + '"><div class="err" data-for="n"></div></label><div class="btns"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Save</button></div></form>');
  $('#nf', el).addEventListener('submit', function (e) { e.preventDefault(); var n = fv(e.target, 'n').trim(); if (!n) return showErrors(e.target, { n: 'Enter a name.' }); var m = cb(n); if (m) return showErrors(e.target, { n: m }); closeModal(true); commit('Saved.'); });
}
ACT.addCat = function (el) { catForm(el.getAttribute('data-t'), -1); };
ACT.editCat = function (el) { catForm(el.getAttribute('data-t'), +el.getAttribute('data-i')); };
function catForm(ty, i) {
  var old = i >= 0 ? DB.categories[ty][i] : '', icon = i >= 0 ? catIcon(ty, old) : '🏷️', ci = i >= 0 ? catCi(ty, old) : DB.categories[ty].length % 8;
  var el = openModal(i >= 0 ? 'Edit category' : 'New ' + ty + ' category', '<form id="ccf" novalidate><label class="fld"><span>Name</span><input name="n" maxlength="30" value="' + esc(old) + '" autocomplete="off"><div class="err" data-for="n"></div></label><input type="hidden" name="ncicon" value="' + esc(icon) + '"><input type="hidden" name="nccolor" value="' + ci + '"><div class="muted sm">Icon</div>' + iconPicker(icon) + '<label class="fld"><span>Or type your own emoji</span><input name="own" maxlength="4" placeholder="🙂" autocomplete="off"></label><div class="muted sm">Colour</div>' + colorPicker(ci) + '<div class="btns"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">Save</button></div></form>');
  var f = $('#ccf', el);
  f.elements.own.addEventListener('input', function () { var v = f.elements.own.value.trim(); if (v) { f.elements.ncicon.value = v; $$('.ic', f).forEach(function (b) { b.classList.remove('on'); }); } });
  f.addEventListener('submit', function (e) {
    e.preventDefault(); var n = fv(f, 'n').trim(), l = DB.categories[ty];
    if (!n) return showErrors(f, { n: 'Enter a name.' });
    if (l.some(function (c, j) { return j !== i && c.toLowerCase() === n.toLowerCase(); })) return showErrors(f, { n: 'That category already exists.' });
    var meta = { icon: fv(f, 'ncicon') || '🏷️', ci: +fv(f, 'nccolor') };
    if (i >= 0) { delete DB.catMeta[catKey(ty, old)]; l[i] = n; DB.txns.forEach(function (t) { if (t.type === ty && t.category === old) t.category = n; }); if (ty === 'expense' && DB.settings.feeCategory === old) DB.settings.feeCategory = n; } else l.push(n);
    DB.catMeta[catKey(ty, n)] = meta; closeModal(true); commit('Category saved.');
  });
}
ACT.delCat = function (el) {
  var ty = el.getAttribute('data-t'), i = +el.getAttribute('data-i'), c = DB.categories[ty][i];
  if (DB.categories[ty].length <= 1) return toast('Keep at least one category.', 'err');
  if (ty === 'expense' && c === DB.settings.feeCategory) return toast('This is your transfer-fee category. Choose another in Account settings first.', 'err');
  var n = DB.txns.filter(function (t) { return t.type === ty && t.category === c; }).length;
  confirmBox('Delete category “' + c + '”?', n ? n + ' existing transactions keep this category name.' : 'No transactions use it.', 'Delete', function () { DB.categories[ty].splice(i, 1); delete DB.catMeta[catKey(ty, c)]; commit('Category deleted.'); });
};
ACT.addMethod = function () { nameForm('Add payment method', '', function (n) { if (DB.methods.some(function (m) { return m.toLowerCase() === n.toLowerCase(); })) return 'Already exists.'; DB.methods.push(n); }); };
ACT.delMethod = function (el) { if (DB.methods.length <= 1) return toast('Keep at least one method.', 'err'); DB.methods.splice(+el.getAttribute('data-i'), 1); commit(); };

/* ---------- theme ---------- */
var THEMES = [['standard', 'Standard', 'Balanced blue-grey, easy on the eyes.'], ['light', 'Light / Bright', 'Clean white with crisp contrast.'], ['dark', 'Dark', 'Low glare for evenings.']];
function currentTheme() { try { return localStorage.getItem(THEME_KEY) || 'standard'; } catch (e) { return document.documentElement.getAttribute('data-theme') || 'standard'; } }
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ } }
function secTheme() {
  var cur = currentTheme();
  return '<section class="card"><h3>Theme</h3><div class="themes">' + THEMES.map(function (t) { return '<button class="theme' + (cur === t[0] ? ' on' : '') + '" data-act="theme" data-t="' + t[0] + '" aria-pressed="' + (cur === t[0]) + '"><span class="tp ' + t[0] + '"><i></i><i></i><i></i></span><b>' + t[1] + '</b><small>' + t[2] + '</small></button>'; }).join('') + '</div><p class="muted sm">Your choice is remembered on this device.</p></section>';
}
ACT.theme = function (el) { applyTheme(el.getAttribute('data-t')); render(); toast('Theme changed.'); };

/* ---------- help ---------- */
function secHelp() {
  function d(q, a) { return '<details class="faq"><summary>' + q + '</summary><div>' + a + '</div></details>'; }
  return '<section class="card"><h3>User guide</h3><ol class="guide"><li><b>Add accounts</b> (Accounts page): Cash, GCash, a bank, a credit card… Enter what each holds today as the opening balance. For a credit card enter the amount you currently owe.</li><li><b>Record transactions</b> with <b>+ Add transaction</b>: choose Income, Expense or Transfer.</li><li><b>Review</b> on Records (Daily, Calendar, Monthly, Summary, Description) and chart it on Statistics.</li><li><b>Back up</b> regularly in Settings → Backup & Restore.</li></ol></section>' +
    '<section class="card"><h3>Recording transactions</h3>' + d('Income', 'Money coming in (salary, sales, gifts). Choose the account that receives it. It raises that account’s balance.') + d('Expense', 'Money going out. Choose the account you paid from. Paying with a credit card? Pick the card as the account: it counts as spending now and increases what you owe.') + d('Transfer', 'Moving money between your own accounts (cash → GCash, bank → savings). It lowers the source and raises the destination by the same amount. Transfers are <b>not</b> income or expenses. Transfer fees are saved as a separate expense.') + d('Paying a credit-card bill', 'Record a transfer from the account you paid with to the card. This reduces what you owe and is not counted as spending again.') + d('Editing or deleting', 'Tap any transaction to edit or delete it. Balances and reports update at once. Deleting asks you to confirm.') + '</section>' +
    '<section class="card"><h3>Accounts guide</h3>' + d('Balance formula', 'Opening balance + income − expenses + transfers in − transfers out.') + d('Assets, liabilities, net worth', 'Assets are what you own. Liabilities are what you owe (credit cards, loans). Net worth = assets − liabilities. Net cash flow (income − expenses) is a separate measure of a period.') + d('Archive vs. delete', 'Archive hides an account from new entries but keeps it in totals. Delete moves it to “Deleted accounts” (restorable) and removes it from totals and reports.') + d('Include in totals', 'Turn this off for accounts you want to track without affecting your totals.') + d('Foreign currency', 'Each account has its own currency. Totals convert to your main currency using the rates in Settings → Currency. Transfers only work between accounts in the same currency.') + '</section>' +
    '<section class="card"><h3>FAQ</h3>' + d('Where is my data stored?', 'Only in this browser on this device (localStorage). There is no server or cloud account. Clearing site data or using a different browser/device means starting empty, so download backups.') + d('Can I use it on my phone and laptop?', 'Yes, but each device has its own data. Move data by downloading a backup on one and restoring it on the other.') + d('Does it work offline?', 'Yes. Only the optional online exchange-rate fetch needs internet.') + d('Why is my net worth different from my cash flow?', 'Net worth is a snapshot of what you have; cash flow is what moved during a period. Opening balances, transfers and card debts affect one but not the other.') + '</section>' +
    '<section class="card"><h3>Backup & recovery</h3><p>Go to Settings → Backup & Restore → <b>Download full backup</b> and keep the file somewhere safe (email it to yourself, cloud drive). To recover, choose <b>Restore from backup</b> and pick the file. You’ll see a summary and must confirm before anything is replaced. Right after a restore you can <b>Undo</b> it. You can also export CSV and import transactions from other apps.</p></section>';
}

/* ---------- currency ---------- */
function secCurrency() {
  var c = DB.settings.currency, rt = DB.settings.rates;
  var others = CURRENCIES.filter(function (x) { return x.code !== c.code; });
  var used = {}; DB.accounts.forEach(function (a) { used[a.currency] = 1; });
  return '<section class="card"><h3>Main currency</h3><form id="curf" class="row2" novalidate>' +
    fld('Main currency', 'code', '<select name="code">' + CURRENCIES.map(function (x) { return opt(x.code, x.code + ' — ' + x.name + ' (' + x.symbol + ')', c.code); }).join('') + '</select>') +
    fld('Currency symbol', 'symbol', '<input name="symbol" maxlength="4" value="' + esc(c.symbol) + '">') + fld('Subcurrency name', 'sub', '<input name="sub" maxlength="20" value="' + esc(c.sub) + '">', '100 ' + esc(c.sub) + 's = 1 ' + esc(c.name) + '. All amounts are stored in whole ' + esc(c.sub) + 's, so there are no rounding errors.') +
    fld('Decimal precision', 'decimals', '<select name="decimals">' + opt(2, '2 decimals (₱1,234.50)', c.decimals) + opt(0, '0 decimals (₱1,235, display only)', c.decimals) + '</select>', 'Zero hides the ' + esc(c.sub) + ' on screen; stored amounts stay exact.') +
    fld('Thousands separator', 'thousands', '<select name="thousands">' + opt(',', 'Comma 1,234', c.thousands) + opt('.', 'Dot 1.234', c.thousands) + opt(' ', 'Space 1 234', c.thousands) + opt('', 'None 1234', c.thousands) + '</select>') +
    fld('Decimal separator', 'decimal', '<select name="decimal">' + opt('.', 'Dot 0.50', c.decimal) + opt(',', 'Comma 0,50', c.decimal) + '</select>') +
    fld('Symbol position', 'symbolPos', '<select name="symbolPos">' + opt('before', 'Before the number', c.symbolPos) + opt('after', 'After the number', c.symbolPos) + '</select>') +
    '<div class="fld"><span>Preview</span><div class="preview" id="curPrev"></div><div class="err" data-for="_"></div></div><div class="btns full"><button class="btn primary">Save currency settings</button></div></form></section>' +
    '<section class="card"><h3>Exchange rates</h3><p class="muted sm">Used to convert accounts in other currencies into ' + esc(c.code) + ' for totals and the currency converter. Enter how many ' + esc(c.code) + ' one unit costs. Rates you enter are never overwritten unless you press fetch.</p><div class="rates">' +
    others.map(function (x) { return '<label class="fld rate"><span>1 ' + x.code + (used[x.code] ? ' <small class="bdg xf">in use</small>' : '') + ' =</span><div class="rin"><input data-rate="' + x.code + '" inputmode="decimal" value="' + esc(rt[x.code] || '') + '" placeholder="not set"><em>' + esc(c.code) + '</em></div></label>'; }).join('') + '</div>' +
    '<div class="btns wrap"><button class="btn primary" data-act="saveRates">Save rates</button><button class="btn" data-act="fetchRates">Fetch latest rates online</button></div><p class="muted sm" id="rateMsg">' + esc(S.rateMsg) + '</p><p class="muted sm">Online fetch uses the free open.er-api.com service and needs internet. If it fails, enter rates by hand.</p></section>';
}
ACT.saveRates = function () {
  var bad = 0; $$('[data-rate]').forEach(function (i) {
    var code = i.getAttribute('data-rate'), v = i.value.trim().replace(/,/g, ''); if (!v) { delete DB.settings.rates[code]; return; }
    var n = Number(v); if (!(n > 0) || n > 1e7) { bad++; i.classList.add('bad'); } else { DB.settings.rates[code] = n; i.classList.remove('bad'); }
  });
  if (bad) return toast(bad + ' rate(s) are invalid. Use a positive number.', 'err'); S.rateMsg = 'Rates saved.'; commit('Exchange rates saved.');
};
ACT.fetchRates = function () {
  var main = DB.settings.currency.code, msg = $('#rateMsg'); if (msg) msg.textContent = 'Fetching…';
  fetch('https://open.er-api.com/v6/latest/' + main).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
    if (!j || j.result !== 'success' || !j.rates) throw new Error('Unexpected reply'); var n = 0;
    CURRENCIES.forEach(function (c) { if (c.code !== main && j.rates[c.code] > 0) { DB.settings.rates[c.code] = Math.round(1e6 / j.rates[c.code]) / 1e6; n++; } });
    S.rateMsg = 'Updated ' + n + ' rates (' + (j.time_last_update_utc || '').slice(0, 16) + ').'; commit('Rates updated.');
  }).catch(function (e) { S.rateMsg = 'Could not fetch rates (' + (e.message || 'offline') + '). Enter them by hand.'; render(); toast('Could not fetch rates. Enter them by hand.', 'err'); });
};
function wireCurrencyForm() {
  document.addEventListener('change', function (e) {
    var f = e.target.form; if (!f || f.id !== 'curf') return;
    if (e.target.name === 'code') { var x = CURRENCIES.filter(function (c) { return c.code === e.target.value; })[0]; f.elements.symbol.value = x.symbol; f.elements.sub.value = x.sub; }
    curPreview(f);
  });
  document.addEventListener('input', function (e) { var f = e.target.form; if (f && f.id === 'curf') curPreview(f); });
  document.addEventListener('submit', function (e) {
    var f = e.target; if (f.id !== 'curf') return; e.preventDefault();
    var c = DB.settings.currency, code = fv(f, 'code'), sym = fv(f, 'symbol').trim(), sub = fv(f, 'sub').trim();
    if (!sym) return showErrors(f, { symbol: 'Enter a symbol.' }); if (!sub) return showErrors(f, { sub: 'Enter a name.' });
    if (fv(f, 'thousands') === fv(f, 'decimal')) return showErrors(f, { decimal: 'Thousands and decimal separators must differ.' });
    function apply() {
      var changed = code !== c.code;
      Object.assign(c, { code: code, symbol: sym, sub: sub, decimals: +fv(f, 'decimals'), thousands: fv(f, 'thousands'), decimal: fv(f, 'decimal'), symbolPos: fv(f, 'symbolPos') });
      if (changed) { c.name = CURRENCIES.filter(function (x) { return x.code === code; })[0].name; DB.settings.rates = {}; }
      commit('Currency settings saved.');
    }
    if (code !== c.code) confirmBox('Change main currency?', 'Your accounts keep their own currencies and amounts. Exchange rates are stored relative to the main currency, so they will be cleared and you’ll need to enter them again. Totals show in the new currency.', 'Change currency', apply, { safe: true }); else apply();
  });
}
function curPreview(f) {
  var p = $('#curPrev'); if (!p) return; var save = DB.settings.currency; DB.settings.currency = Object.assign({}, save, { symbol: fv(f, 'symbol'), decimals: +fv(f, 'decimals'), thousands: fv(f, 'thousands'), decimal: fv(f, 'decimal'), symbolPos: fv(f, 'symbolPos'), code: save.code });
  try { p.textContent = fmtMoney(123456789) + '   ' + fmtMoney(-5050); } finally { DB.settings.currency = save; }
}
/* ================= Calculator & converters ================= */
var CALC_TABS = [['standard', 'Standard'], ['scientific', 'Scientific'], ['units', 'Unit converter'], ['currency', 'Currency converter'], ['percent', 'Percentage']];
function secCalc() {
  var c = S.calc, tabs = '<div class="tabs sub">' + CALC_TABS.map(function (t) { return '<button class="' + (c.tab === t[0] ? 'on' : '') + '" data-act="calcTab" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
  var body = c.tab === 'units' ? calcUnits() : c.tab === 'currency' ? calcCurrency() : c.tab === 'percent' ? calcPercent() : calcPad(c.tab === 'scientific');
  return '<section class="card">' + tabs + body + '</section>';
}
function calcPad(sci) {
  function k(l, v, c) { return '<button class="key ' + (c || '') + '" data-act="calcKey" data-k="' + esc(v == null ? l : v) + '">' + l + '</button>'; }
  var std = k('C', 'C', 'fn') + k('⌫', 'BS', 'fn') + k('%', '%', 'fn') + k('÷', '÷', 'op') + k('7') + k('8') + k('9') + k('×', '×', 'op') + k('4') + k('5') + k('6') + k('−', '−', 'op') + k('1') + k('2') + k('3') + k('+', '+', 'op') + k('0') + k('.') + k('(') + k(')') + '<button class="key eq wide" data-act="calcKey" data-k="=">=</button>';
  var sc = sci ? '<div class="sci">' + [['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('], ['ln', 'ln('], ['log', 'log('], ['asin', 'asin('], ['acos', 'acos('], ['atan', 'atan('], ['√', 'sqrt('], ['xʸ', '^'], ['π', 'π'], ['e', 'e'], ['n!', '!'], ['eˣ', 'exp('], ['|x|', 'abs(']].map(function (x) { return k(x[0], x[1], 'fn'); }).join('') + '<button class="key fn" data-act="calcDeg">' + (S.calc.deg ? 'Deg' : 'Rad') + '</button></div>' : '';
  return '<div class="calc"><input id="calcIn" class="cin" value="' + esc(S.calc.expr) + '" placeholder="0" autocomplete="off" inputmode="text" aria-label="Calculator expression"><div id="calcOut" class="cout"></div>' + sc + '<div class="pad4">' + std + '</div><div id="calcHist" class="chist"></div></div>';
}
function calcRefresh() {
  var out = $('#calcOut'); if (!out) return; var r = calcEval(S.calc.expr, S.calc.deg);
  out.textContent = r.err !== undefined ? r.err : '= ' + fmtCalc(r.val); out.classList.toggle('bad', !!r.err && S.calc.expr !== '');
  var h = $('#calcHist'); if (h) h.innerHTML = S.calc.hist.map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('');
}
ACT.calcTab = function (el) { S.calc.tab = el.getAttribute('data-t'); render(); };
ACT.calcDeg = function () { S.calc.deg = !S.calc.deg; render(); };
ACT.calcKey = function (el) {
  var k = el.getAttribute('data-k'), c = S.calc, inp = $('#calcIn');
  if (k === 'C') c.expr = ''; else if (k === 'BS') c.expr = c.expr.replace(/(asin|acos|atan|sqrt|sin|cos|tan|log|ln|exp|abs)\($|.$/, '');
  else if (k === '=') { var r = calcEval(c.expr, c.deg); if (r.val !== undefined) { c.hist.unshift(c.expr + ' = ' + fmtCalc(r.val)); c.hist = c.hist.slice(0, 6); c.expr = fmtCalc(r.val); } }
  else c.expr += k;
  if (inp) inp.value = c.expr; calcRefresh();
};
function unitOpts(cat) { return cat === 'Temperature' ? ['C', 'F', 'K'] : Object.keys(UNITS[cat]); }
function calcUnits() {
  var u = S.calc.unit, cats = Object.keys(UNITS).concat(['Temperature']), us = unitOpts(u.cat);
  if (us.indexOf(u.from) < 0) u.from = us[0]; if (us.indexOf(u.to) < 0) u.to = us[1] || us[0];
  var n = parseFloat(u.val), res = isFinite(n) && String(u.val).trim() !== '' ? fmtCalc(convertUnit(u.cat, n, u.from, u.to)) : '—';
  return '<div class="row2">' + '<label class="fld"><span>Type</span><select data-f="$calc.unit.cat">' + cats.map(function (c) { return opt(c, c, u.cat); }).join('') + '</select></label><label class="fld"><span>Value</span><input data-f="$calc.unit.val" inputmode="decimal" value="' + esc(u.val) + '"></label>' +
    '<label class="fld"><span>From</span><select data-f="$calc.unit.from">' + us.map(function (x) { return opt(x, x, u.from); }).join('') + '</select></label><label class="fld"><span>To</span><select data-f="$calc.unit.to">' + us.map(function (x) { return opt(x, x, u.to); }).join('') + '</select></label></div><div class="result">' + esc(u.val) + ' ' + esc(u.from) + ' = <b>' + esc(res) + ' ' + esc(u.to) + '</b></div>';
}
function calcCurrency() {
  var c = S.calc.cur, main = DB.settings.currency.code; if (!c.to) c.to = main; if (c.from === c.to) c.from = CURRENCIES.filter(function (x) { return x.code !== c.to; })[0].code;
  var m = parseMoney(c.amt, true), rf = rateOf(c.from), rt = rateOf(c.to), res;
  if (m.err) res = '<span class="muted">' + esc(m.err) + '</span>'; else if (rf == null || rt == null) res = '<span class="neg">Set the ' + esc(rf == null ? c.from : c.to) + ' rate in Settings → Currency first.</span>';
  else { var out = Math.round(m.cents * rf / rt); res = fmtMoney(m.cents, c.from).replace(symOf(main), symOf(main)) + ' = <b>' + fmtMoney(out, c.to) + '</b>'; }
  var o = CURRENCIES.map(function (x) { return [x.code, x.code + ' — ' + x.name]; });
  return '<div class="row2"><label class="fld"><span>Amount</span><input data-f="$calc.cur.amt" inputmode="decimal" value="' + esc(c.amt) + '"></label><span></span><label class="fld"><span>From</span><select data-f="$calc.cur.from">' + o.map(function (x) { return opt(x[0], x[1], c.from); }).join('') + '</select></label><label class="fld"><span>To</span><select data-f="$calc.cur.to">' + o.map(function (x) { return opt(x[0], x[1], c.to); }).join('') + '</select></label></div><div class="result">' + res + '</div><p class="muted sm">Uses the rates saved in Settings → Currency (manual or fetched). They are not live market rates.</p>';
}
function calcPercent() {
  var p = S.calc.pct, a = parseFloat(p.a), b = parseFloat(p.b), ok = isFinite(a) && isFinite(b), r = '—', txt;
  var modes = [['of', 'X% of Y'], ['is', 'X is what % of Y'], ['chg', '% change from X to Y'], ['add', 'Y plus X%'], ['sub', 'Y minus X%']];
  if (ok) {
    if (p.mode === 'of') r = fmtCalc(a / 100 * b); else if (p.mode === 'is') r = b === 0 ? 'undefined' : fmtCalc(a / b * 100) + '%'; else if (p.mode === 'chg') r = a === 0 ? 'undefined' : fmtCalc((b - a) / Math.abs(a) * 100) + '%'; else if (p.mode === 'add') r = fmtCalc(b * (1 + a / 100)); else r = fmtCalc(b * (1 - a / 100));
  }
  return '<div class="row2"><label class="fld"><span>Calculate</span><select data-f="$calc.pct.mode">' + modes.map(function (m) { return opt(m[0], m[1], p.mode); }).join('') + '</select></label><span></span><label class="fld"><span>X</span><input data-f="$calc.pct.a" inputmode="decimal" value="' + esc(p.a) + '"></label><label class="fld"><span>Y</span><input data-f="$calc.pct.b" inputmode="decimal" value="' + esc(p.b) + '"></label></div><div class="result">Result: <b>' + esc(r) + '</b></div>';
}
function wireCalc() {
  document.addEventListener('input', function (e) { if (e.target.id === 'calcIn') { S.calc.expr = e.target.value; calcRefresh(); } });
  document.addEventListener('keydown', function (e) { if (e.target.id === 'calcIn' && e.key === 'Enter') { e.preventDefault(); ACT.calcKey({ getAttribute: function () { return '='; } }); } });
}

/* ================= Backup & restore ================= */
var EXP = { from: '', to: '' };
function hasSnapshot() { try { return !!localStorage.getItem(BACKUP_KEY); } catch (e) { return false; } }
function secBackup() {
  var ds = DB.txns.map(function (t) { return t.date; }).sort(); if (!EXP.from) EXP.from = ds[0] || today().slice(0, 4) + '-01-01'; if (!EXP.to) EXP.to = today();
  var imp = S.imp, impHtml = '';
  if (imp) {
    var ok = imp.items.length, newCnt = imp.items.filter(function (i) { return !i.dupe; }).length;
    impHtml = '<div class="impbox"><h4>Preview</h4><p><b>' + ok + '</b> rows read · <b>' + newCnt + '</b> new · <b>' + imp.dupes + '</b> look like duplicates · <b class="' + (imp.errors.length ? 'neg' : '') + '">' + imp.errors.length + '</b> problems</p>' +
      (imp.errors.length ? '<ul class="errs">' + imp.errors.slice(0, 8).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + (imp.errors.length > 8 ? '<li>…and ' + (imp.errors.length - 8) + ' more</li>' : '') + '</ul><p class="muted sm">Rows with problems are skipped.</p>' : '') +
      (imp.newAccounts.length ? '<p>Accounts not found: <b>' + imp.newAccounts.map(esc).join(', ') + '</b></p>' : '') +
      '<label class="tgl"><input type="checkbox" id="impSkip" checked><span class="sw"></span><span class="tl">Skip duplicates<small>Same date, time, type, description, amount and account.</small></span></label>' +
      (imp.newAccounts.length ? '<label class="tgl"><input type="checkbox" id="impCreate" checked><span class="sw"></span><span class="tl">Create missing accounts<small>With a zero opening balance. Otherwise those rows are skipped.</small></span></label>' : '') +
      '<div class="btns"><button class="btn" data-act="impCancel">Cancel</button><button class="btn primary" data-act="impGo"' + (ok ? '' : ' disabled') + '>Import ' + ok + ' rows</button></div></div>';
  }
  return '<section class="card"><h3>Where your data lives</h3><p>' + (storageOK ? '✅ Saved automatically in this browser' + (DB.savedAt ? ' (last save ' + esc(new Date(DB.savedAt).toLocaleString()) + ')' : '') + '.' : '<b class="neg">⚠ Not saving.</b> ' + esc(lastSaveError || 'Browser storage is unavailable.')) + '</p><p class="muted sm">' + DB.txns.length + ' transactions · ' + DB.accounts.length + ' accounts. There is no cloud sync; download backups to keep your data safe or move it to another device.</p></section>' +
    '<section class="card"><h3>Export</h3><div class="row2"><label class="fld"><span>From</span><input type="date" id="expFrom" value="' + esc(EXP.from) + '"></label><label class="fld"><span>To</span><input type="date" id="expTo" value="' + esc(EXP.to) + '"></label></div><div class="btns wrap"><button class="btn" data-act="expCSV">Transactions (CSV)</button><button class="btn" data-act="expRepCSV">Report (CSV)</button><button class="btn" data-act="expRepHTML">Report (printable HTML)</button></div></section>' +
    '<section class="card"><h3>Full backup</h3><p class="muted sm">One file with everything: accounts, groups, transactions, categories and settings.</p><div class="btns wrap"><button class="btn primary" data-act="expBackup">Download full backup</button></div>' +
    '<h4>Restore from backup</h4><p class="muted sm">Replaces everything currently in the app. You’ll confirm first, and can undo afterwards.</p><div class="btns wrap"><label class="btn filebtn">Choose backup file…<input type="file" id="restoreFile" accept=".json,application/json" hidden></label>' + (hasSnapshot() ? '<button class="btn" data-act="undoRestore">Undo last restore</button>' : '') + '</div></section>' +
    '<section class="card"><h3>Import transactions</h3><p class="muted sm">Choose a CSV with columns <b>Date, Type, Amount, Account</b> (required) and Description, Category, To Account, Payment Method, Notes, Time (optional). Files exported from this app work as-is.</p><div class="btns wrap"><label class="btn filebtn">Choose CSV file…<input type="file" id="importFile" accept=".csv,text/csv" hidden></label><button class="btn" data-act="csvTemplate">Download template</button></div>' + impHtml + '</section>' +
    '<section class="card"><h3>Sample data & reset</h3><div class="btns wrap"><button class="btn" data-act="loadSample">Load sample data</button>' + (DB.accounts.some(function (a) { return a.sample; }) ? '<button class="btn" data-act="removeSample">Remove sample data</button>' : '') + '<button class="btn danger" data-act="eraseAll">Erase all data…</button></div></section>';
}
function backupRefresh() { }
function readFile(file, cb) { var r = new FileReader(); r.onload = function () { cb(String(r.result)); }; r.onerror = function () { toast('Could not read that file.', 'err'); }; r.readAsText(file); }
function expRange() { var f = $('#expFrom'), t = $('#expTo'); if (f) EXP.from = f.value; if (t) EXP.to = t.value; if (!isDate(EXP.from) || !isDate(EXP.to) || EXP.from > EXP.to) { toast('Choose a valid date range (start on or before end).', 'err'); return null; } return EXP; }
ACT.expCSV = function () { var r = expRange(); if (!r) return; var l = filterTxns({ from: r.from, to: r.to }); if (!l.length) return toast('No transactions in that range.', 'err'); download('transactions-' + r.from + '_to_' + r.to + '.csv', txnsToCSV(l), 'text/csv;charset=utf-8'); toast('Exported ' + l.length + ' transactions.'); };
ACT.expRepCSV = function () { var r = expRange(); if (!r) return; download('report-' + r.from + '_to_' + r.to + '.csv', reportCSV(r.from, r.to), 'text/csv;charset=utf-8'); toast('Report downloaded.'); };
ACT.expRepHTML = function () { var r = expRange(); if (!r) return; download('report-' + r.from + '_to_' + r.to + '.html', reportHTML(r.from, r.to), 'text/html'); toast('Report downloaded. Open it and use Print to save as PDF.'); };
ACT.expBackup = function () { var d = JSON.parse(JSON.stringify(DB)); d.exportedAt = new Date().toISOString(); download('finance-backup-' + today() + '.json', JSON.stringify(d, null, 1), 'application/json'); toast('Backup downloaded. Keep it somewhere safe.'); };
ACT.csvTemplate = function () { download('transactions-template.csv', 'Date,Time,Type,Description,Category,Amount,Account,To Account,Payment Method,Notes\r\n2026-01-15,09:30,expense,Lunch,Food,185.50,Cash on Hand,,Cash,\r\n2026-01-15,18:00,income,Salary,Salary,15000,BDO Savings,,Bank Transfer,\r\n2026-01-16,10:00,transfer,Load GCash,,1000,BDO Savings,GCash,,\r\n', 'text/csv'); };
function snapshotNow() { try { localStorage.setItem(BACKUP_KEY, JSON.stringify(DB)); return true; } catch (e) { return false; } }
ACT.undoRestore = function () {
  confirmBox('Undo the last restore?', 'Your data goes back to how it was just before you restored. Anything added since will be lost.', 'Undo restore', function () {
    try { var v = validateDB(JSON.parse(localStorage.getItem(BACKUP_KEY))); if (!v.ok) throw 0; DB = v.db; localStorage.removeItem(BACKUP_KEY); commit('Restore undone.'); } catch (e) { toast('Could not undo: the saved copy is unreadable.', 'err'); }
  }, { safe: true });
};
ACT.impCancel = function () { S.imp = null; render(); };
ACT.impGo = function () {
  var skip = $('#impSkip').checked, cr = $('#impCreate') ? $('#impCreate').checked : false, prep = S.imp;
  confirmBox('Import transactions?', 'This adds up to ' + prep.items.length + ' transactions to your existing data. Existing records are not changed.', 'Import', function () {
    snapshotNow(); var r = commitImport(prep, { skipDupes: skip, createAccounts: cr }); S.imp = null; commit('Imported ' + r.made + ' transactions' + (r.skipped ? ', skipped ' + r.skipped : '') + (r.created ? ', created ' + r.created + ' accounts' : '') + '.');
  }, { safe: true });
};
ACT.eraseAll = function () {
  confirmBox('Erase ALL data?', 'This deletes every account, transaction, category and setting stored in this browser' + (SYNC.on ? ' <b>and, because sync is on, the cloud copy and your other devices</b>' : '') + '. Download a backup first if you might need it.', 'Erase everything', function () {
    snapshotNow(); DB = newDB(); S.imp = null; commit('All data erased. “Undo last restore” can bring it back until you restore or erase again.');
  }, { typed: 'DELETE' });
};
function wireBackup() {
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.files || !t.files[0]) return; var file = t.files[0];
    if (t.id === 'restoreFile') {
      readFile(file, function (txt) {
        var obj; try { obj = JSON.parse(txt); } catch (x) { t.value = ''; return toast('That file isn’t valid JSON, so it can’t be a backup.', 'err'); }
        var v = validateDB(obj); t.value = '';
        if (!v.ok) return toast('Restore failed. ' + v.errors.join(' '), 'err');
        confirmBox('Replace all current data?', 'Backup: <b>' + v.db.accounts.length + '</b> accounts, <b>' + v.db.txns.length + '</b> transactions' + (obj.exportedAt ? ' (made ' + esc(String(obj.exportedAt).slice(0, 10)) + ')' : '') + '.<br>Currently: <b>' + DB.accounts.length + '</b> accounts, <b>' + DB.txns.length + '</b> transactions.<br>Everything now in the app will be overwritten. You can undo right after.', 'Replace with backup', function () {
          snapshotNow(); DB = v.db; commit('Backup restored.');
        });
      });
    } else if (t.id === 'importFile') {
      readFile(file, function (txt) { t.value = ''; S.imp = prepareImport(txt); if (!S.imp.items.length && S.imp.errors.length) toast('Nothing can be imported: ' + S.imp.errors[0], 'err'); render(); });
    }
  });
}

/* ================= Sample data ================= */
ACT.loadSample = function () {
  var seed = 7; function rnd(a, b) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return a + Math.floor(seed / 0x7fffffff * (b - a + 1)); }
  function mk(n, ty, g, op) { var r = saveAccount({ name: n, type: ty, groupId: g, opening: op, currency: DB.settings.currency.code, include: true }); if (r.account) r.account.sample = true; return r.account; }
  var suffix = DB.accounts.some(function (a) { return a.name === 'Cash (sample)'; }) ? ' 2' : '';
  var cash = mk('Cash (sample)' + suffix, 'Cash', 'g_cash', '3000'), gc = mk('GCash (sample)' + suffix, 'E-Wallet', 'g_ewallet', '2000'), bank = mk('Bank (sample)' + suffix, 'Savings', 'g_bank', '25000'), cc = mk('Credit Card (sample)' + suffix, 'Credit Card', 'g_card', '3000');
  if (!cash || !gc || !bank || !cc) return toast('Sample accounts could not be created.', 'err');
  function tx(date, o) { var r = saveTxn(Object.assign({ date: date, time: pad2(rnd(7, 21)) + ':' + pad2(rnd(0, 59)), method: 'Cash', notes: '', desc: '' }, o)); if (r.txn) r.txn.sample = true; }
  var start = addDays(today(), -89);
  for (var d = start, i = 0; d <= today(); d = addDays(d, 1), i++) {
    var day = +d.slice(8);
    if (day === 15 || day === 30 || (day === 28 && d.slice(5, 7) === '02')) tx(d, { type: 'income', amount: '18000', account: bank.id, category: 'Salary', desc: 'Salary', method: 'Bank Transfer' });
    if (day === 5) { tx(d, { type: 'expense', amount: String(rnd(1800, 2600)), account: bank.id, category: 'Electricity', desc: 'Electricity', method: 'Online Payment' }); tx(d, { type: 'expense', amount: '1299', account: bank.id, category: 'Internet', desc: 'Internet', method: 'Online Payment' }); }
    if (day === 10) tx(d, { type: 'transfer', amount: '3000', account: bank.id, toAccount: cc.id, desc: 'Credit card payment' });
    if (i % 14 === 3) tx(d, { type: 'transfer', amount: '2000', account: bank.id, toAccount: gc.id, desc: 'Load GCash', fee: '15' });
    if (i % 14 === 8) tx(d, { type: 'transfer', amount: '3500', account: bank.id, toAccount: cash.id, desc: 'Cash withdrawal' });
    if (i % 3 !== 2) tx(d, { type: 'expense', amount: String(rnd(80, 320)), account: i % 2 ? cash.id : gc.id, category: 'Food', desc: 'Food', method: i % 2 ? 'Cash' : 'GCash' });
    if (i % 2 === 0) tx(d, { type: 'expense', amount: String(rnd(30, 150)), account: cash.id, category: 'Transportation', desc: 'Transportation' });
    if (i % 9 === 4) tx(d, { type: 'expense', amount: String(rnd(500, 2500)), account: cc.id, category: 'Shopping', desc: 'Shopping', method: 'Credit Card' });
    if (i % 30 === 12) tx(d, { type: 'income', amount: String(rnd(1500, 4000)), account: gc.id, category: 'Business Income', desc: 'Business Income', method: 'GCash' });
  }
  S.date = today(); commit('Sample data added. Remove it any time in Backup & Restore.');
};
ACT.removeSample = function () {
  confirmBox('Remove sample data?', 'Deletes the sample accounts and their transactions. Your own data is not touched.', 'Remove sample data', function () {
    DB.accounts.filter(function (a) { return a.sample; }).forEach(function (a) { purgeAccount(a.id); });
    DB.txns = DB.txns.filter(function (t) { return !t.sample; }); commit('Sample data removed.');
  });
};
/* ================= Cloud sync (optional; needs the api/finance.js function) ================= */
var SYNC_KEY = 'finance-tracker:sync';
var SYNC = { on: false, pass: '', rev: 0, dirty: false, last: 0, state: 'off', msg: '', busy: false, ver: 0, applying: false, timer: null, conflictOpen: false };
function syncLoad() {
  try { var j = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); if (j && j.pass) { SYNC.on = true; SYNC.pass = j.pass; SYNC.rev = j.rev || 0; SYNC.dirty = !!j.dirty; SYNC.last = j.last || 0; SYNC.state = 'idle'; } } catch (e) { /* ignore */ }
}
function syncPersist() { try { if (SYNC.on) localStorage.setItem(SYNC_KEY, JSON.stringify({ pass: SYNC.pass, rev: SYNC.rev, dirty: SYNC.dirty, last: SYNC.last })); else localStorage.removeItem(SYNC_KEY); } catch (e) { /* ignore */ } }
function syncCall(method, o) {
  o = o || {};
  var headers = { 'x-passcode': o.pass != null ? o.pass : SYNC.pass, 'x-base-rev': String(o.base != null ? o.base : SYNC.rev) };
  if (o.body != null) headers['content-type'] = 'text/plain';
  return fetch('api/finance' + (o.meta ? '?meta=1' : ''), { method: method, headers: headers, body: o.body, cache: 'no-store' }).then(function (r) {
    return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } return { status: r.status, j: j }; });
  });
}
function syncFail(res, err) { // returns a state + message for a failed call
  if (err) return { state: 'offline', msg: 'Can’t reach the sync server. Your changes stay on this device and will sync when you are back online.' };
  if (!res.j) return { state: 'unavailable', msg: 'Sync isn’t set up on this site (the api/finance.js function wasn’t found). See the README.' };
  if (res.status === 401) return { state: 'auth', msg: 'The sync passcode was not accepted.' };
  if (res.status === 500 && res.j.error === 'not_configured') return { state: 'unavailable', msg: 'The server isn’t configured yet. Add FINANCE_PASSCODE and connect an Upstash Redis database in Vercel, then redeploy.' };
  if (res.status === 413) return { state: 'error', msg: 'Your data is too large to sync (limit about 4 MB).' };
  return { state: 'error', msg: 'The sync server returned an error (' + res.status + '). Will retry.' };
}
function syncSet(state, msg) { SYNC.state = state; SYNC.msg = msg || ''; syncUi(); }
function syncUi() {
  var el = $('#syncStat'); if (el) {
    var t = { off: 'Sync off', idle: 'Sync on', saving: 'Saving…', synced: 'Synced ' + (SYNC.last ? new Date(SYNC.last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''), offline: 'Offline · will sync later', unavailable: 'Sync unavailable', auth: 'Sync passcode rejected', error: 'Sync problem', conflict: 'Sync conflict' }[SYNC.state] || '';
    el.className = 'syncstat ' + SYNC.state; el.textContent = (SYNC.state === 'synced' || SYNC.state === 'idle' ? '● ' : SYNC.state === 'off' ? '○ ' : '⚠ ') + t; el.title = SYNC.msg || t; el.setAttribute('data-act', 'goSync');
    if (SYNC.state === 'saving') el.textContent = '↻ Saving…';
  }
  var b = $('#syncBox'); if (b && S.page === 'settings' && S.settings === 'sync' && !$('#syncPass:focus')) b.innerHTML = syncBoxHtml();
}
ACT.goSync = function () { go('settings/sync'); };
function syncApply(dataStr, rev) {
  var v; try { v = validateDB(JSON.parse(dataStr)); } catch (e) { v = { ok: false, errors: ['Cloud data could not be read.'] }; }
  if (!v.ok) { syncSet('error', 'The cloud copy is invalid: ' + v.errors.join(' ')); return false; }
  if (DB.txns.length || DB.accounts.length) snapshotNow();
  SYNC.applying = true; DB = v.db; save(); SYNC.applying = false;
  SYNC.rev = rev; SYNC.dirty = false; SYNC.last = Date.now(); syncPersist(); syncSet('synced'); render(); return true;
}
function syncMarkDirty() { if (!SYNC.on || SYNC.applying) return; SYNC.dirty = true; SYNC.ver++; syncPersist(); clearTimeout(SYNC.timer); SYNC.timer = setTimeout(syncPush, 1500); syncSet('saving'); }
function syncPush() {
  if (!SYNC.on || SYNC.busy) { if (SYNC.on) { clearTimeout(SYNC.timer); SYNC.timer = setTimeout(syncPush, 1500); } return; }
  if (SYNC.state === 'conflict' || SYNC.state === 'auth' || SYNC.state === 'unavailable') return;
  SYNC.busy = true; var ver = SYNC.ver;
  syncCall('PUT', { body: JSON.stringify(DB) }).then(function (res) {
    SYNC.busy = false;
    if (res.status === 200 && res.j && res.j.rev) { SYNC.rev = res.j.rev; SYNC.last = Date.now(); if (ver === SYNC.ver) SYNC.dirty = false; syncPersist(); syncSet('synced'); if (SYNC.dirty) syncMarkDirty(); }
    else if (res.status === 409 && res.j) syncConflict(res.j.rev);
    else { var f = syncFail(res); syncSet(f.state, f.msg); if (f.state === 'error') { clearTimeout(SYNC.timer); SYNC.timer = setTimeout(syncPush, 30000); } }
  }).catch(function (e) { SYNC.busy = false; var f = syncFail(null, e); syncSet(f.state, f.msg); clearTimeout(SYNC.timer); SYNC.timer = setTimeout(syncPush, 30000); });
}
function syncPoll() {
  if (!SYNC.on || SYNC.busy || SYNC.conflictOpen || ['auth', 'unavailable'].indexOf(SYNC.state) >= 0 || modalStack.length) return;
  if (SYNC.dirty) return syncPush();
  SYNC.busy = true;
  syncCall('GET', { meta: true }).then(function (res) {
    SYNC.busy = false;
    if (res.status !== 200 || !res.j) { var f = syncFail(res); return syncSet(f.state, f.msg); }
    if (res.j.rev !== SYNC.rev && res.j.rev > 0) syncPull(); else { SYNC.last = Date.now(); syncPersist(); syncSet('synced'); }
  }).catch(function (e) { SYNC.busy = false; var f = syncFail(null, e); syncSet(f.state, f.msg); });
}
function syncPull() {
  SYNC.busy = true;
  syncCall('GET').then(function (res) {
    SYNC.busy = false;
    if (res.status !== 200 || !res.j) { var f = syncFail(res); return syncSet(f.state, f.msg); }
    if (res.j.data == null) return syncPush();
    if (SYNC.dirty) return syncConflict(res.j.rev);
    if (syncApply(res.j.data, res.j.rev)) toast('Updated with changes from another device.');
  }).catch(function (e) { SYNC.busy = false; var f = syncFail(null, e); syncSet(f.state, f.msg); });
}
function syncConflict(cloudRev) {
  if (SYNC.conflictOpen) return; SYNC.conflictOpen = true; syncSet('conflict', 'Another device saved changes while this device had unsynced changes.');
  var el = openModal('Sync conflict', '<p>Another device saved changes to the cloud copy, and this device also has changes that haven’t been uploaded. Choose which version to keep. Nothing is merged automatically.</p><div class="btns wrap"><button class="btn" data-act="syncDownloadLocal">Download this device’s data first</button></div><div class="btns"><button class="btn" data-act="syncUseCloud">Use cloud version</button><button class="btn primary" data-act="syncKeepMine">Keep this device’s version</button></div><p class="muted sm">“Use cloud” replaces this device’s data (a safety copy is kept for “Undo last restore”). “Keep this device” overwrites the cloud copy.</p>', { sticky: true });
  SYNC.pendingCloudRev = cloudRev;
}
function syncCloseConflict() { SYNC.conflictOpen = false; closeModal(true); }
ACT.syncDownloadLocal = function () { ACT.expBackup(); };
ACT.syncUseCloud = function () { syncCloseConflict(); SYNC.dirty = false; syncPull(); };
ACT.syncKeepMine = function () { SYNC.rev = SYNC.pendingCloudRev || SYNC.rev; syncCloseConflict(); if (SYNC.state === 'conflict') SYNC.state = 'idle'; SYNC.dirty = true; syncPersist(); syncPush(); };
ACT.syncNow = function () { if (!SYNC.on) return; if (['auth', 'unavailable', 'error', 'offline', 'conflict'].indexOf(SYNC.state) >= 0) SYNC.state = 'idle'; SYNC.busy = false; if (SYNC.dirty) syncPush(); else syncPoll(); toast('Checking…'); };
ACT.syncOff = function () {
  confirmBox('Turn off sync on this device?', 'Your data stays on this device and in the cloud. This device just stops syncing and forgets the passcode.', 'Turn off sync', function () { SYNC.on = false; SYNC.pass = ''; SYNC.dirty = false; syncPersist(); syncSet('off'); render(); toast('Sync turned off on this device.'); }, { safe: true });
};
ACT.syncOn = function () {
  var pass = ($('#syncPass') || {}).value || ''; if (!pass.trim()) return toast('Enter your sync passcode.', 'err');
  var msg = $('#syncMsg'); if (msg) msg.textContent = 'Connecting…';
  syncCall('GET', { pass: pass, base: 0 }).then(function (res) {
    if (res.status !== 200 || !res.j) { var f = syncFail(res); if (msg) msg.textContent = f.msg; return; }
    function enable() { SYNC.on = true; SYNC.pass = pass; SYNC.state = 'idle'; syncPersist(); }
    var localEmpty = !DB.accounts.length && !DB.txns.length;
    if (res.j.data == null) { // cloud empty: upload this device's data
      enable(); SYNC.rev = 0; SYNC.dirty = true; syncPersist(); syncPush(); toast('Sync on. Uploading your data…'); render(); return;
    }
    if (localEmpty) { enable(); if (syncApply(res.j.data, res.j.rev)) toast('Sync on. Your cloud data was loaded.'); return; }
    var el = openModal('Which data do you want to keep?', '<p>The cloud already has data, and this device has data too. They are not merged.</p><div class="btns"><button class="btn" data-act="syncChooseCloud">Use cloud data<br><small>replaces this device</small></button><button class="btn primary" data-act="syncChooseMine">Use this device’s data<br><small>replaces the cloud copy</small></button></div>', { sticky: true });
    SYNC.pending = { pass: pass, rev: res.j.rev, data: res.j.data }; SYNC.enable = enable;
  }).catch(function (e) { var f = syncFail(null, e); if (msg) msg.textContent = f.msg; });
};
ACT.syncChooseCloud = function () { var p = SYNC.pending; closeModal(true); SYNC.enable(); if (syncApply(p.data, p.rev)) toast('Sync on. Cloud data loaded.'); };
ACT.syncChooseMine = function () { var p = SYNC.pending; closeModal(true); SYNC.enable(); SYNC.rev = p.rev; SYNC.dirty = true; syncPersist(); syncPush(); toast('Sync on. Uploading this device’s data…'); render(); };
function syncBoxHtml() {
  var labels = { idle: 'On', synced: 'Synced', saving: 'Saving…', offline: 'Offline', unavailable: 'Not available', auth: 'Passcode rejected', error: 'Problem', conflict: 'Conflict' };
  if (SYNC.on) return '<p><b>' + (labels[SYNC.state] || 'On') + '</b>' + (SYNC.last ? ' · last checked ' + esc(new Date(SYNC.last).toLocaleString()) : '') + (SYNC.dirty ? ' · changes waiting to upload' : '') + '</p>' + (SYNC.msg ? '<div class="warn">' + esc(SYNC.msg) + '</div>' : '') + '<div class="btns wrap"><button class="btn primary" data-act="syncNow">Sync now</button><button class="btn" data-act="syncOff">Turn off on this device</button></div>';
  return '<label class="fld"><span>Sync passcode</span><input id="syncPass" type="password" autocomplete="off" placeholder="The passcode you set in Vercel"></label><div class="btns wrap"><button class="btn primary" data-act="syncOn">Turn on sync</button></div><p class="muted sm" id="syncMsg"></p>';
}
function secSync() {
  return '<section class="card"><h3>Sync across devices</h3><p class="muted sm">Open this site on any phone or computer, enter the same passcode, and your accounts and transactions follow you. Changes upload within a couple of seconds and other devices check every 20 seconds.</p><div id="syncBox">' + syncBoxHtml() + '</div></section>' +
    '<section class="card"><h3>How it works</h3><ul class="guide"><li>Your data is kept in a private database on your own Vercel account. Only someone with the passcode can read or change it.</li><li>The whole data file is saved each time. If two devices change things at the same moment, you’ll be asked which version to keep. Nothing is merged silently.</li><li>Each device still keeps its own copy, so the app works offline and uploads later.</li><li>Keep downloading backups now and then. Sync is not a backup: deleting something on one device deletes it everywhere.</li><li>Needs the one-time server setup in the README (a free Upstash Redis database and a passcode). Without it this page will say sync is unavailable.</li></ul></section>';
}
function syncStart() {
  syncLoad(); onSaved = syncMarkDirty;
  setInterval(syncPoll, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) syncPoll(); });
  window.addEventListener('online', function () { if (SYNC.on && SYNC.state === 'offline') SYNC.state = 'idle'; syncPoll(); });
  if (SYNC.on) { syncUi(); setTimeout(function () { if (SYNC.dirty) syncPush(); else syncPoll(); }, 400); }
}
/* ================= Boot ================= */
var booted = false;
function boot() {
  if (booted) return; booted = true;
  var res = load();
  document.getElementById('root').innerHTML = shell();
  wireEvents(); wireChartTips(); wireCurrencyForm(); wireCalc(); wireBackup();
  if (!location.hash) { S.tab = DB.settings.defaultTab || 'daily'; }
  syncStart(); readHash(); render();
  if (res.status === 'corrupt') openModal('Saved data could not be read', '<p>' + esc((res.errors || []).join(' ')) + '</p><p>A copy of the unreadable data was kept in this browser. The app has started empty so you can continue; you can restore a backup file in Settings → Backup & Restore.</p><div class="btns"><button class="btn primary" data-act="closeModal">OK</button></div>', { sticky: true });
  if (res.status === 'nostorage') toast('Browser storage is blocked. Data will not be kept after you close this tab.', 'err');
}
document.addEventListener('DOMContentLoaded', boot);
if (document.readyState !== 'loading') boot();
})();
