// Invoice backend: a Google Apps Script web app bound to a Google Sheet.
// Setup steps are in README.md. Paste this whole file into Extensions > Apps Script.

const SHEET_NAME = "Invoices";
// status is the payment state (open / partial / paid); archived and disabled are separate flags.
const HEADERS = ["id", "created", "status", "paidAt", "paidInfo", "data", "archivedAt", "disabled"];
const COL = { id: 1, created: 2, status: 3, paidAt: 4, paidInfo: 5, data: 6, archivedAt: 7, disabled: 8 };
const METHODS = { paypal: "PayPal", ach: "ACH bank transfer (US)" };
// Time zone for times in notification emails (Las Vegas, Nevada = Pacific Time).
const EMAIL_TIME_ZONE = "America/Los_Angeles";
// Fields every method always has. Labels are fixed; extra fields can be added after them.
const REQUIRED_FIELDS = {
  paypal: ["PayPal address"],
  ach: ["Beneficiary name", "Bank name", "Bank address", "Routing (ABA)", "SWIFT code", "Account number", "Account type"],
};
// Older label names, mapped onto the current required labels.
const LABEL_ALIASES = {
  "PayPal email": "PayPal address",
  "Account holder": "Beneficiary name",
  "Routing number (ABA)": "Routing (ABA)",
};

// Run once from the Apps Script editor. Prints your admin key in the execution log.
function setup() {
  sheet_();
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty("ADMIN_KEY");
  if (!key) {
    key = randomId_(32);
    props.setProperty("ADMIN_KEY", key);
  }
  if (!props.getProperty("SETTINGS")) {
    props.setProperty("SETTINGS", JSON.stringify(defaultSettings_()));
  }
  MailApp.getRemainingDailyQuota(); // Triggers the email permission prompt.
  Logger.log("Invoices sheet: " + spreadsheet_().getUrl());
  Logger.log("Admin key: " + key);
}

function doGet(e) {
  return handle_({ action: "get", id: e.parameter.id });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: "Bad request" });
  }
  return handle_(body);
}

function handle_(body) {
  try {
    return json_(route_(body || {}));
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

const PUBLIC_ACTIONS = { get: getInvoice_, paid: markPaid_ };
const ADMIN_ACTIONS = {
  verify: () => ({ ok: true }),
  create: createInvoice_,
  update: updateInvoice_,
  list: listInvoices_,
  reset: (b) => setStatus_(b.id, "reset"),
  disable: (b) => setStatus_(b.id, "disable"),
  enable: (b) => setStatus_(b.id, "enable"),
  archive: (b) => setStatus_(b.id, "archive"),
  rotate: rotateId_,
  remove: removeInvoice_,
  getSettings: () => ({ ok: true, settings: settings_() }),
  saveSettings: saveSettings_,
};

function route_(b) {
  if (PUBLIC_ACTIONS[b.action]) return PUBLIC_ACTIONS[b.action](b);
  if (ADMIN_ACTIONS[b.action]) {
    const key = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
    if (!key || b.key !== key) return { ok: false, error: "Invalid admin key" };
    return ADMIN_ACTIONS[b.action](b);
  }
  return { ok: false, error: "Unknown action" };
}

// ---------- Public ----------

function getInvoice_(b) {
  const row = findRow_(b.id);
  if (!row) return { ok: false, error: "not_found" };
  const rec = readRow_(row);
  if (rec.disabled) return { ok: true, status: "disabled" };
  const s = settings_();
  const paidInfo = rec.paidInfo || {};
  return {
    ok: true,
    status: rec.status,
    paidAt: rec.paidAt,
    invoice: rec.invoice,
    business: s.business,
    // Only the methods on this invoice, with payment details hidden once that part is paid.
    payments: (rec.invoice.payments || []).map((p) => {
      const paid = paidInfo[p.method];
      return {
        method: p.method,
        name: METHODS[p.method],
        amount: p.amount,
        paidAt: paid ? paid.at : "",
        fields: paid ? [] : s[p.method].fields,
      };
    }),
  };
}

function markPaid_(b) {
  return withLock_(() => {
    const row = findRow_(b.id);
    if (!row) return { ok: false, error: "not_found" };
    const rec = readRow_(row);
    if (rec.disabled) return { ok: false, error: "This invoice link is no longer active." };
    const part = (rec.invoice.payments || []).find((p) => p.method === b.method);
    if (!part) return { ok: false, error: "That payment method isn't on this invoice." };

    const paidInfo = rec.paidInfo || {};
    if (paidInfo[part.method]) return { ok: true, status: rec.status };

    paidInfo[part.method] = { at: new Date().toISOString(), reference: str_(b.reference, 500) };
    const status = statusFor_(rec.invoice, paidInfo);
    const paidAt = status === "paid" ? new Date().toISOString() : "";
    sheet_().getRange(row, COL.status, 1, 3).setValues([[status, paidAt, JSON.stringify(paidInfo)]]);

    try {
      notify_(rec.invoice, part, paidInfo[part.method], status);
    } catch (err) {
      console.error("Notification failed: " + err);
    }
    return { ok: true, status: status };
  });
}

function statusFor_(invoice, paidInfo) {
  const parts = invoice.payments || [];
  const done = parts.filter((p) => paidInfo && paidInfo[p.method]).length;
  if (!done) return "open";
  return done === parts.length ? "paid" : "partial";
}

function notify_(inv, part, info, status) {
  const s = settings_();
  const money = (n) => inv.cur + " " + Number(n).toFixed(2);
  const parts = inv.payments || [];
  const progress = status === "paid"
    ? parts.length > 1 ? "All payments for this invoice are now marked sent." : "This invoice is now marked paid."
    : "Still waiting on: " + parts.filter((p) => p.method !== part.method).map((p) => METHODS[p.method] + " " + money(p.amount)).join(", ");

  const subject = "Payment sent: " + (inv.inv ? "Invoice " + inv.inv : "Invoice") + (inv.client ? " - " + inv.client : "");
  const body = [
    "Your client marked a payment as sent. Check that the money has arrived before you treat it as settled.",
    "",
    "Invoice: " + (inv.inv || "-"),
    "Client: " + (inv.client || "-") + (inv.client_email ? " <" + inv.client_email + ">" : ""),
    "Week: " + (inv.weekStart || "?") + " to " + (inv.weekEnd || "?"),
    "Method: " + METHODS[part.method],
    "Amount: " + money(part.amount) + " (invoice total " + money(inv.total) + ")",
    "Reference: " + (info.reference || "-"),
    // When the client confirmed, shown in Las Vegas time (PST/PDT).
    "Reported at: " + Utilities.formatDate(new Date(), EMAIL_TIME_ZONE, "MMM d, yyyy h:mm a z") + " (Las Vegas time)",
    "",
    progress,
  ].join("\n");

  // No address in Payment settings means no notification email.
  if (s.notifyEmail) MailApp.sendEmail(s.notifyEmail, subject, body);
}

// ---------- Admin ----------

function createInvoice_(b) {
  const invoice = cleanInvoice_(b.invoice);
  const problem = invoiceProblem_(invoice);
  if (problem) return { ok: false, error: problem };
  return withLock_(() => {
    const id = randomId_(24);
    sheet_().appendRow([id, new Date().toISOString(), "open", "", "", JSON.stringify(invoice)]);
    return { ok: true, id: id };
  });
}

// Edits an invoice in place, keeping its link. Only allowed before any payment is confirmed.
function updateInvoice_(b) {
  const invoice = cleanInvoice_(b.invoice);
  const problem = invoiceProblem_(invoice);
  if (problem) return { ok: false, error: problem };
  return withLock_(() => {
    const row = findRow_(b.id);
    if (!row) return { ok: false, error: "not_found" };
    const rec = readRow_(row);
    if (rec.archivedAt) return { ok: false, error: ARCHIVED_ERROR };
    if (anyPaid_(rec)) return { ok: false, error: "This invoice already has a confirmed payment and can't be edited." };
    sheet_().getRange(row, COL.data).setValue(JSON.stringify(invoice));
    return { ok: true, id: b.id };
  });
}

function invoiceProblem_(invoice) {
  if (!invoice.inv.trim()) return "Enter an invoice number.";
  if (!invoice.client.trim()) return "Enter the client name.";
  if (!invoice.payments.length) return "Add an amount for PayPal, ACH, or both.";
  const s = settings_();
  for (const p of invoice.payments) {
    const missing = s[p.method].fields
      .filter((f) => REQUIRED_FIELDS[p.method].indexOf(f[0]) !== -1 && !f[1])
      .map((f) => f[0]);
    if (missing.length) return "Fill in your " + METHODS[p.method] + " details in Payment settings first (missing: " + missing.join(", ") + ").";
  }
  return "";
}

function listInvoices_() {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, invoices: [] };
  const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return { ok: true, invoices: rows.map(rowToRecord_).reverse() };
}

const ARCHIVED_ERROR = "Archived invoices can't be changed.";

function anyPaid_(rec) {
  return Object.keys(rec.paidInfo || {}).length > 0;
}

function setStatus_(id, op) {
  return withLock_(() => {
    const row = findRow_(id);
    if (!row) return { ok: false, error: "not_found" };
    const rec = readRow_(row);
    if (rec.archivedAt) return { ok: false, error: ARCHIVED_ERROR };
    const sh = sheet_();
    // Move a legacy "disabled" status into the separate column before changing anything.
    sh.getRange(row, COL.status).setValue(rec.status);
    sh.getRange(row, COL.disabled).setValue(rec.disabled ? "1" : "");
    if (op === "reset") {
      sh.getRange(row, COL.status, 1, 3).setValues([["open", "", ""]]);
    } else if (op === "disable") {
      sh.getRange(row, COL.disabled).setValue("1");
    } else if (op === "enable") {
      sh.getRange(row, COL.disabled).setValue("");
    } else if (op === "archive") {
      if (rec.status !== "paid") return { ok: false, error: "Only fully paid invoices can be archived." };
      sh.getRange(row, COL.archivedAt).setValue(new Date().toISOString());
    }
    return { ok: true };
  });
}

// Gives the invoice a new ID so the old link stops working.
function rotateId_(b) {
  return withLock_(() => {
    const row = findRow_(b.id);
    if (!row) return { ok: false, error: "not_found" };
    if (readRow_(row).archivedAt) return { ok: false, error: ARCHIVED_ERROR };
    const id = randomId_(24);
    sheet_().getRange(row, COL.id).setValue(id);
    return { ok: true, id: id };
  });
}

// Invoices with a confirmed payment are kept as a record.
function removeInvoice_(b) {
  return withLock_(() => {
    const row = findRow_(b.id);
    if (!row) return { ok: false, error: "not_found" };
    const rec = readRow_(row);
    if (rec.archivedAt || anyPaid_(rec)) return { ok: false, error: "Paid or archived invoices can't be deleted." };
    sheet_().deleteRow(row);
    return { ok: true };
  });
}

function saveSettings_(b) {
  const s = cleanSettings_(b.settings);
  PropertiesService.getScriptProperties().setProperty("SETTINGS", JSON.stringify(s));
  return { ok: true, settings: s };
}

// ---------- Data helpers ----------

// Uses the spreadsheet this script is attached to. A standalone script creates its own spreadsheet instead.
function spreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("SPREADSHEET_ID");
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create("Invoices");
  props.setProperty("SPREADSHEET_ID", ss.getId());
  return ss;
}

let sheetCache_ = null;

function sheet_() {
  if (sheetCache_) return sheetCache_;
  const ss = spreadsheet_();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.setFrozenRows(1);
  }
  // Writes the header row (and adds columns introduced by later versions to older sheets).
  const header = sh.getRange(1, 1, 1, HEADERS.length);
  if (String(header.getValues()[0][HEADERS.length - 1]) !== HEADERS[HEADERS.length - 1]) {
    header.setValues([HEADERS]);
    // Plain text so Sheets doesn't turn IDs or ISO timestamps into numbers or dates.
    sh.getRange(1, 1, sh.getMaxRows(), HEADERS.length).setNumberFormat("@");
  }
  sheetCache_ = sh;
  return sh;
}

function findRow_(id) {
  if (!id || typeof id !== "string") return 0;
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, COL.id, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return 0;
}

function readRow_(row) {
  return rowToRecord_(sheet_().getRange(row, 1, 1, HEADERS.length).getValues()[0]);
}

function rowToRecord_(r) {
  const invoice = parseJson_(r[5], {});
  const paidInfo = parseJson_(r[4], {});
  // Older versions stored "disabled" in the status column instead of the payment state.
  const legacyDisabled = String(r[2]) === "disabled";
  return {
    id: String(r[0]),
    created: String(r[1]),
    status: legacyDisabled ? statusFor_(invoice, paidInfo) : String(r[2]),
    paidAt: String(r[3]),
    paidInfo: paidInfo,
    invoice: invoice,
    archivedAt: String(r[6] || ""),
    disabled: legacyDisabled || String(r[7] || "") === "1",
  };
}

function settings_() {
  const raw = PropertiesService.getScriptProperties().getProperty("SETTINGS");
  return cleanSettings_(raw ? parseJson_(raw, defaultSettings_()) : defaultSettings_());
}

function defaultSettings_() {
  return {
    business: { name: "", email: "", address: "" },
    notifyEmail: "",
    paypal: { fields: REQUIRED_FIELDS.paypal.map((l) => [l, ""]) },
    ach: { fields: REQUIRED_FIELDS.ach.map((l) => [l, l === "Account type" ? "Checking" : ""]) },
  };
}

function cleanInvoice_(d) {
  d = d || {};
  const payments = Object.keys(METHODS)
    .map((m) => ({ method: m, amount: money_((d.amounts || {})[m]) }))
    .filter((p) => p.amount > 0);
  const custom = arr_(d.custom, 30)
    .map((r) => [str_(r[0], 100), str_(r[1], 500)])
    .filter((r) => r[0] || r[1]);
  return {
    inv: str_(d.inv, 60),
    client: str_(d.client, 200),
    client_email: str_(d.client_email, 200),
    date: str_(d.date, 10),
    weekStart: str_(d.weekStart, 10),
    weekEnd: str_(d.weekEnd, 10),
    due: str_(d.due, 10),
    cur: (str_(d.cur, 3) || "USD").toUpperCase(),
    work: str_(d.work, 5000),
    custom: custom,
    payments: payments,
    total: money_(payments.reduce((t, p) => t + p.amount, 0)),
    notes: str_(d.notes, 2000),
  };
}

function cleanSettings_(d) {
  d = d || {};
  const biz = d.business || {};
  return {
    business: { name: str_(biz.name, 200), email: str_(biz.email, 200), address: str_(biz.address, 500) },
    notifyEmail: str_(d.notifyEmail, 200).trim(),
    paypal: cleanMethod_("paypal", d.paypal),
    ach: cleanMethod_("ach", d.ach),
  };
}

// Required fields always come first with their fixed labels; any other fields follow.
function cleanMethod_(key, m) {
  const rows = arr_(m && m.fields, 40).map((f) => {
    const label = str_(f[0], 100).trim();
    return [LABEL_ALIASES[label] || label, str_(f[1], 500).trim()];
  });
  const required = REQUIRED_FIELDS[key];
  const fields = required.map((label) => {
    const found = rows.find((r) => r[0] === label);
    return [label, found ? found[1] : ""];
  });
  rows
    .filter((r) => required.indexOf(r[0]) === -1 && (r[0] || r[1]))
    .slice(0, 30)
    .forEach((r) => fields.push(r));
  return { fields: fields };
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function randomId_(len) {
  let s = "";
  while (s.length < len) s += Utilities.getUuid().replace(/-/g, "");
  return s.slice(0, len);
}

function str_(v, max) {
  return String(v == null ? "" : v).slice(0, max);
}

function money_(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function arr_(v, max) {
  return Array.isArray(v) ? v.slice(0, max).filter((x) => x != null) : [];
}

function parseJson_(v, fallback) {
  try {
    return v ? JSON.parse(v) : fallback;
  } catch (err) {
    return fallback;
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
