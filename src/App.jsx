import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import { unzipSync } from "fflate";
import { SignIn, SignedIn, SignedOut, UserButton, useAuth } from "@clerk/clerk-react";

/* ─── Google Font ─── */
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap";
document.head.appendChild(fontLink);

/* ─── Design Tokens ─── */
const T = {
  bg: "#0f1117",
  card: "#181c27",
  border: "#252a38",
  gold: "#f0b429",
  text: "#e8eaf0",
  muted: "#7a8099",
  overdue: "#e05252",
  today: "#f0b429",
  upcoming: "#3ecf8e",
  noDate: "#7a8099",
  font: "'DM Sans', sans-serif",
};

/* ─── Helpers ─── */
const FR_MONTHS = { janvier:1,février:2,fevrier:2,mars:3,avril:4,mai:5,juin:6,juillet:7,août:8,aout:8,septembre:9,octobre:10,novembre:11,décembre:12,decembre:12 };
const EN_MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };

function resolveMonth(word) {
  if (!word) return null;
  const w = word.toLowerCase().trim();
  if (FR_MONTHS[w]) return FR_MONTHS[w];
  if (EN_MONTHS[w]) return EN_MONTHS[w];
  const frKey = Object.keys(FR_MONTHS).find(k => k.startsWith(w) || w.startsWith(k.slice(0,3)));
  if (frKey) return FR_MONTHS[frKey];
  const enKey = Object.keys(EN_MONTHS).find(k => k.startsWith(w) || w.startsWith(k.slice(0,3)));
  if (enKey) return EN_MONTHS[enKey];
  return null;
}

function buildIso(y, m, d) {
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const fullYear = year < 100 ? (year < 50 ? 2000 + year : 1900 + year) : year;
  return fullYear + "-" + String(month).padStart(2,"0") + "-" + String(day).padStart(2,"0");
}

// Tokenize: split string into digit-runs and letter-runs, ignoring separators.
// "14janvier2026" and "14 janvier 2026" both produce ["14","janvier","2026"].
function tokenize(s) {
  return s.match(/\d+|[A-Za-z\u00C0-\u024F]+/g) || [];
}

function sanitizeDate(raw, yearHint) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().replace(/\s+/g, " ");
  if (!s) return null;
  const yr = yearHint || new Date().getFullYear();

  // 1. Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const r = buildIso(...s.split("-")); if (r) return r; }

  // 2. DD-MM-YYYY / DD/MM/YYYY / DD.MM.YYYY (primary format the AI now returns)
  const dmy = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
  if (dmy) { const r = buildIso(dmy[3], dmy[2], dmy[1]); if (r) return r; }

  // 3. DD-MM or DD/MM — no year, assume current year
  const dm = s.match(/^(\d{1,2})[-\/](\d{1,2})$/);
  if (dm) { const r = buildIso(yr, dm[2], dm[1]); if (r) return r; }

  // 4. Token-based fallback — handles anything the AI returns with missing spaces
  //    e.g. "30 avril2026", "14janvier2026", "janvier 2026"
  const t = tokenize(s);
  const isNum = x => /^\d+$/.test(x);

  if (t.length === 3) {
    const [a, b, c] = t;
    if (isNum(a) && !isNum(b) && isNum(c)) { const mon = resolveMonth(b); if (mon) { const r = buildIso(c, mon, a); if (r) return r; } }
    if (!isNum(a) && isNum(b) && isNum(c)) { const mon = resolveMonth(a); if (mon) { const r = buildIso(c, mon, b); if (r) return r; } }
  }
  if (t.length === 2) {
    const [a, b] = t;
    if (isNum(a) && !isNum(b)) { const mon = resolveMonth(b); if (mon) { const r = buildIso(yr, mon, a); if (r) return r; } }
    if (!isNum(a) && isNum(b) && parseInt(b,10) <= 31) { const mon = resolveMonth(a); if (mon) { const r = buildIso(yr, mon, b); if (r) return r; } }
    if (!isNum(a) && isNum(b) && parseInt(b,10) > 31)  { const mon = resolveMonth(a); if (mon) { const r = buildIso(b, mon, 1); if (r) return r; } }
    if (isNum(a) && !isNum(b) && parseInt(a,10) > 31)  { const mon = resolveMonth(b); if (mon) { const r = buildIso(a, mon, 1); if (r) return r; } }
  }

  // 5. Native Date parse as last resort
  try { const n = new Date(s); if (!isNaN(n.getTime())) { const r = buildIso(n.getFullYear(), n.getMonth()+1, n.getDate()); if (r) return r; } } catch(_) {}

  return null;
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}

function fmtDate(iso) {
  if (!iso) return "—";
  const p = iso.split("-");
  if (p.length === 3) return p[2] + "/" + p[1] + "/" + p[0];
  return iso;
}

const COMMISSION_RATE = 0.09;
const commission = n => Number(n) * COMMISSION_RATE;

function fmtMoney(n) {
  if (n == null || isNaN(n)) return "$0.00";
  return "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function getWeekKey(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d.getTime())) return null;
  const thu = new Date(d); thu.setDate(d.getDate() - (d.getDay()+6)%7 + 3);
  const y = thu.getFullYear();
  const jan4 = new Date(y, 0, 4);
  const w = 1 + Math.round(((thu - jan4) / 86400000 - 3 + (jan4.getDay()+6)%7) / 7);
  return `${y}-W${String(w).padStart(2,"0")}`;
}

const getMonthKey = iso => iso ? iso.slice(0,7) : null;
const getYearKey  = iso => iso ? iso.slice(0,4) : null;

function deliveryStatus(dd) {
  if (!dd) return "no-date";
  const t = todayStr();
  if (dd < t) return "delivered";
  if (dd === t) return "today";
  return "upcoming";
}

const STATUS_COLOR = { delivered:"#7a8099", today:T.today, upcoming:T.upcoming, "no-date":T.noDate };
const STATUS_LABEL = { delivered:"Delivered", today:"Today", upcoming:"Upcoming", "no-date":"No Date" };
const statusColor = s => STATUS_COLOR[s] || T.noDate;
const statusLabel = s => STATUS_LABEL[s] || "No Date";

/* ─── Excel serial → DD-MM-YYYY ─── */
function excelSerialToDate(serial) {
  const d = XLSX.SSF.parse_date_code(serial);
  if (!d) return String(serial);
  return `${String(d.d).padStart(2,"0")}-${String(d.m).padStart(2,"0")}-${d.y}`;
}

// Strict check: only treat as date serial if format string has unambiguous date tokens
function isDateSerial(val, cell) {
  if (!cell || cell.t !== "n" || typeof val !== "number") return false;
  return cell.z && /\b(yy|mm|dd|d|m|y)\b/i.test(cell.z);
}

function parseSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type:"array", cellDates:false, cellNF:true });
        const sections = wb.SheetNames.map(name => {
          const ws = wb.Sheets[name];
          if (!ws || !ws["!ref"]) return `=== Sheet: ${name} ===\n(empty)`;
          const range = XLSX.utils.decode_range(ws["!ref"]);
          const rows = [];
          for (let r = range.s.r; r <= range.e.r; r++) {
            const row = [];
            for (let c = range.s.c; c <= range.e.c; c++) {
              const addr = XLSX.utils.encode_cell({r,c});
              const cell = ws[addr];
              if (!cell) { row.push(""); continue; }
              row.push(isDateSerial(cell.v, cell) ? excelSerialToDate(cell.v) : cell.v != null ? String(cell.v) : "");
            }
            rows.push(row);
          }
          const csv = rows.map(r => r.map(v => `"${v.replace(/"/g,'""')}"`).join(",")).join("\n");
          return `=== Sheet: ${name} ===\n${csv}`;
        });
        resolve(sections.join("\n\n"));
      } catch(err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function readArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Some "PDFs" uploaded by clients are actually ZIP archives containing
// per-page JPEGs and .txt files. For the AP format only pages 1, 11, 13,
// and 14 carry data we need; pages 2–10 and 12 are individual product
// category sheets that are almost entirely zeros. Skipping them cuts the
// payload to Claude by roughly 80%.
const NEEDED_PAGES = ["1.txt", "11.txt", "13.txt", "14.txt"];

function unzipTxtPages(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const decoder = new TextDecoder();
  const txtEntries = NEEDED_PAGES
    .map(name => [name, files[name]])
    .filter(([, data]) => data != null && data.length > 0);

  if (!txtEntries.length) {
    throw new Error("ZIP archive missing required pages (1, 11, 13, 14)");
  }

  return txtEntries
    .map(([name, data]) => `--- Page ${name.replace(".txt", "")} ---\n${decoder.decode(data)}`)
    .join("\n\n");
}

/* ─── AI Extraction ─── */
// NOTE: Uses /api/extract so the API key stays server-side (Vercel function)
const SYS_PROMPT = `You are a sales document parser for Alimentation Première meat-order documents. Input arrives in one of two formats:

A) EXCEL workbooks: sections separated by "=== Sheet: <name> ===" headers. Sheets named "Entente", "Fiche Client", and "Résumé".

B) DOCUMENT TEXT extracted from a ZIP archive of per-page .txt files: sections separated by "--- Page N ---" headers. Page 1 holds the Entente data (client + order date). Later pages hold product/résumé data with rows like "CODE  Description  Format  Price  [qty per delivery]  Total $" and running "Sous-total: X,XXX.XX $" lines.

Return ONLY a JSON object with these exact keys:

- client (string): EXCEL — "Entente" sheet, value next to (right of or below) "Client 1:". ZIP — Page 1 next to "Client 1:".
- date (string): EXCEL — "Entente" sheet, value next to "Date:". ZIP — Page 1 next to "Date:". Format DD-MM-YYYY (convert from jj/mm/aaaa or any other).
- deliveryDate (string or null): EXCEL — "Fiche Client" sheet, value next to "1e livraison le:". ZIP — any page where this label appears. Format DD-MM-YYYY. Null if not present.
- total (number): the GRAND TOTAL across all deliveries combined. EXCEL — the numeric value at "vente totale :" in "Fiche Client". ZIP — prefer a "vente totale" line if present; otherwise SUM every "Sous-total: X,XXX.XX $" line across all pages. No currency symbols, no thousand separators.
- items (array of strings): every product whose quantity is > 0. EXCEL — "Résumé" sheet column 2 where AT LEAST ONE of the four numeric qty columns to its right is > 0; use the column-2 name. ZIP — product rows on pages 2+ where any per-delivery qty is > 0; use the description text. Skip products with all-zero quantities and skip header rows.

If the document matches neither AP format (generic PDF, single-sheet CSV, etc.), fall back to extracting the same five fields from wherever they appear.

Return ONLY valid JSON. No markdown fences, no explanation, no extra keys.`;

function parseResponse(data) {
  if (!data.content || !data.content[0] || data.content[0].type !== "text") {
    throw new Error("Unexpected API response structure");
  }
  const text = data.content[0].text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(text);
  const orderDate = sanitizeDate(parsed.date);
  const orderYear = orderDate ? parseInt(orderDate.slice(0, 4), 10) : new Date().getFullYear();
  return {
    client:       parsed.client || "Unknown",
    date:         orderDate || todayStr(),
    deliveryDate: sanitizeDate(parsed.deliveryDate, orderYear) || null,
    total:        Number(String(parsed.total || 0).replace(/,/g, "").replace(/\s*\$/, "").trim()) || 0,
    items:        Array.isArray(parsed.items) ? parsed.items : [],
  };
}

async function extractFromFile(file) {
  const name = (file.name || "").toLowerCase();
  const ext = (name.match(/\.([^.]+)$/) || [])[1] || "";
  const typeStr = file.type || "";

  let messages;

  // Spreadsheets first — XLSX is internally a ZIP, so route by extension/MIME
  // before doing magic-byte detection or it would be mis-classified as a ZIP.
  if (ext === "xlsx" || ext === "xls" || ext === "csv" || /excel|spreadsheet|csv/.test(typeStr)) {
    const csv = await parseSpreadsheet(file);
    messages = [{ role:"user", content:`Extract the sales order data from this spreadsheet CSV:\n\n${csv}\n\nReturn ONLY a JSON object.` }];
  } else {
    const buffer = await readArrayBuffer(file);
    const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    // ZIP magic: 50 4B 03 04
    const isZip = head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04;
    // PDF magic: 25 50 44 46 ("%PDF")
    const isRealPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;

    if (isZip) {
      const text = unzipTxtPages(buffer);
      messages = [{ role:"user", content:`Extract the sales order data from this document text:\n\n${text}\n\nReturn ONLY a JSON object.` }];
    } else if (isRealPdf) {
      const b64 = bufferToBase64(buffer);
      messages = [{ role:"user", content:[
        { type:"document", source:{ type:"base64", media_type:"application/pdf", data:b64 } },
        { type:"text", text:"Extract the sales order data from this document. Return ONLY a JSON object." }
      ]}];
    } else {
      throw new Error("Unrecognized file format (not a PDF, ZIP, or spreadsheet)");
    }
  }

  const headers = { "Content-Type": "application/json" };
  const body = JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:1000, system:SYS_PROMPT, messages });

  let resp = await fetch("/api/extract", { method:"POST", headers, body });

  // On 429, wait the Retry-After window (+1s buffer) and try once more.
  if (resp.status === 429) {
    const retryAfter = parseInt(resp.headers.get("retry-after") || "15", 10) || 15;
    await new Promise(r => setTimeout(r, (retryAfter + 1) * 1000));
    resp = await fetch("/api/extract", { method:"POST", headers, body });
  }

  if (!resp.ok) throw new Error(`API error ${resp.status}`);
  return parseResponse(await resp.json());
}

/* ─── Reusable Atoms ─── */
function Card({ children, style }) {
  return <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:20, ...style }}>{children}</div>;
}

function Badge({ label, color, bg }) {
  return <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:600, color:color||T.bg, background:bg||T.gold, marginRight:4, marginBottom:2, whiteSpace:"nowrap" }}>{label}</span>;
}

function Empty({ msg }) {
  return <div style={{ textAlign:"center", color:T.muted, padding:"60px 0", fontSize:14 }}>
    <div style={{ fontSize:32, marginBottom:8 }}>📂</div>{msg}
  </div>;
}

function GrandTotal({ label, amount, commissionAmount, style }) {
  const comm = commissionAmount !== undefined ? commissionAmount : commission(amount);
  return <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 20px", background:`${T.gold}15`, border:`1px solid ${T.gold}40`, borderRadius:10, marginTop:16, ...style }}>
    <span style={{ fontWeight:600, color:T.text, fontSize:14 }}>{label}</span>
    <div style={{ textAlign:"right" }}>
      <div style={{ fontWeight:700, color:T.gold, fontSize:16 }}>{fmtMoney(amount)}</div>
      <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>comm. {fmtMoney(comm)}</div>
    </div>
  </div>;
}

function SidePanel({ title, onClose, children }) {
  return <div style={{ position:"fixed", top:0, right:0, width:420, height:"100%", background:T.card, borderLeft:`1px solid ${T.border}`, zIndex:1000, overflowY:"auto", boxShadow:"-8px 0 32px #00000060" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"20px 24px 16px", borderBottom:`1px solid ${T.border}`, position:"sticky", top:0, background:T.card, zIndex:1 }}>
      <span style={{ fontWeight:700, fontSize:16, color:T.text }}>{title}</span>
      <button onClick={onClose} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:6, color:T.muted, fontSize:18, cursor:"pointer", padding:"2px 10px" }}>✕</button>
    </div>
    <div style={{ padding:24 }}>{children}</div>
  </div>;
}

function PeriodRow({ label, revenue, commissionAmount, count, pct, onClick, isSelected }) {
  const comm = commissionAmount !== undefined ? commissionAmount : commission(revenue);
  return <div onClick={onClick} style={{ display:"flex", alignItems:"center", gap:16, padding:"14px 16px", borderRadius:10, cursor:"pointer", marginBottom:6, background:isSelected ? `${T.gold}18` : "transparent", border:`1px solid ${isSelected ? T.gold+"40" : T.border}`, transition:"all .15s" }}>
    <div style={{ flex:1, minWidth:0 }}>
      <div style={{ fontWeight:600, fontSize:14, color:T.text }}>{label}</div>
      <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>{count} order{count!==1?"s":""}</div>
      <div style={{ marginTop:6, height:3, borderRadius:2, background:T.border }}>
        <div style={{ width:`${pct}%`, height:3, borderRadius:2, background:T.gold, transition:"width .4s ease" }}/>
      </div>
    </div>
    <div style={{ textAlign:"right" }}>
      <div style={{ fontWeight:700, color:T.gold, fontSize:15, whiteSpace:"nowrap" }}>{fmtMoney(revenue)}</div>
      <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>{fmtMoney(comm)} comm.</div>
    </div>
  </div>;
}

/* ─── Stats Bar ─── */
function StatsBar({ orders, activeOrders }) {
  const today = todayStr();
  const currentMonthKey = today.slice(0,7);
  const weekStart = (() => {
    const d = new Date(today+"T12:00:00");
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().slice(0,10);
  })();

  const totalSales      = orders.reduce((s,o)=>s+o.total,0);
  const weekSales       = orders.filter(o=>o.date>=weekStart).reduce((s,o)=>s+o.total,0);
  const monthSales      = orders.filter(o=>o.date.slice(0,7)===currentMonthKey).reduce((s,o)=>s+o.total,0);
  const monthOrders     = orders.filter(o=>o.date.slice(0,7)===currentMonthKey).length;
  const clients         = new Set(orders.map(o=>o.client)).size;

  const totalComm       = activeOrders.reduce((s,o)=>s+o.total,0);
  const weekActiveComm  = activeOrders.filter(o=>o.date>=weekStart).reduce((s,o)=>s+o.total,0);
  const monthActiveComm = activeOrders.filter(o=>o.date.slice(0,7)===currentMonthKey).reduce((s,o)=>s+o.total,0);

  return <div style={{ marginBottom:24 }}>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:12 }}>
      <Card style={{ padding:16 }}>
        <div style={{ fontSize:18, marginBottom:4 }}>🧾</div>
        <div style={{ fontSize:18, fontWeight:700, color:T.text }}>{fmtMoney(totalSales)}</div>
        <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>Total Sales</div>
        <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${T.border}` }}>
          <div style={{ fontSize:18, fontWeight:700, color:T.gold }}>{fmtMoney(commission(totalComm))}</div>
          <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>My Commission (9%)</div>
        </div>
      </Card>
      <Card style={{ padding:16 }}>
        <div style={{ fontSize:18, marginBottom:4 }}>🧑‍💼</div>
        <div style={{ fontSize:22, fontWeight:700, color:T.gold }}>{clients}</div>
        <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>Unique Clients</div>
      </Card>
      <Card style={{ padding:16 }}>
        <div style={{ fontSize:18, marginBottom:4 }}>📋</div>
        <div style={{ fontSize:22, fontWeight:700, color:T.gold }}>{orders.length}</div>
        <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>Orders Filed</div>
      </Card>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
      <Card style={{ padding:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <span style={{ fontSize:18 }}>📅</span>
          <span style={{ fontSize:12, color:T.muted, fontWeight:600 }}>THIS WEEK</span>
        </div>
        <div style={{ fontSize:28, fontWeight:700, color:T.text, letterSpacing:"-0.5px" }}>{fmtMoney(weekSales)}</div>
        <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>{orders.filter(o=>o.date>=weekStart).length} orders this week</div>
        <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${T.border}` }}>
          <div style={{ fontSize:22, fontWeight:700, color:T.gold }}>{fmtMoney(commission(weekActiveComm))}</div>
          <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>My Commission (9%)</div>
        </div>
      </Card>
      <Card style={{ padding:20, border:`1px solid ${T.gold}30` }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <span style={{ fontSize:18 }}>📆</span>
          <span style={{ fontSize:12, color:T.muted, fontWeight:600 }}>THIS MONTH</span>
        </div>
        <div style={{ fontSize:28, fontWeight:700, color:T.text, letterSpacing:"-0.5px" }}>{fmtMoney(monthSales)}</div>
        <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>{monthOrders} orders this month</div>
        <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${T.border}` }}>
          <div style={{ fontSize:22, fontWeight:700, color:T.gold }}>{fmtMoney(commission(monthActiveComm))}</div>
          <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>My Commission (9%)</div>
        </div>
      </Card>
    </div>
  </div>;
}

/* ─── Upload Tab ─── */
function UploadTab({ onOrderAdded, files, setFiles }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const processOne = useCallback(async (file) => {
    const name = file.name;
    setFiles(prev => {
      const exists = prev.find(e => e.name === name);
      if (exists) return prev.map(e => e.name===name ? {...e, status:"processing"} : e);
      return [...prev, { name, status:"processing", file }];
    });

    // Single attempt — extractFromFile handles its own one-shot 429 retry.
    // On any other failure, fall back to a placeholder so the file is not lost.
    try {
      const data = await extractFromFile(file);
      await onOrderAdded({ fileName: name, ...data });
      setFiles(prev => prev.map(e => e.name===name ? {...e, status:"done"} : e));
    } catch (err) {
      try {
        const fallback = {
          fileName: name,
          client: name.replace(/_pdf\.pdf$/i, "").replace(/_/g, " "),
          date: todayStr(),
          deliveryDate: null,
          total: 0,
          items: ["⚠️ Extraction failed — edit manually"],
        };
        await onOrderAdded(fallback);
        setFiles(prev => prev.map(e => e.name===name ? {...e, status:"done"} : e));
      } catch (saveErr) {
        setFiles(prev => prev.map(e => e.name===name ? {...e, status:"error"} : e));
      }
    }
  }, [onOrderAdded, setFiles]);

  // App-wide serial queue: only one file processes at a time, no matter how
  // many drops or batches arrive. Refs persist across re-renders so a single
  // queue and "is processing" flag survive the whole UploadTab lifetime.
  const processingRef = useRef(false);
  const queueRef = useRef([]);

  const runQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const file = queueRef.current.shift();
        await processOne(file);
      }
    } finally {
      processingRef.current = false;
    }
  }, [processOne]);

  const enqueueFile = useCallback((file) => {
    setFiles(prev => {
      if (prev.find(e => e.name === file.name)) return prev;
      return [...prev, { name: file.name, status: "pending", file }];
    });
    queueRef.current.push(file);
    runQueue();
  }, [runQueue, setFiles]);

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter(f =>
      /pdf|excel|spreadsheet|csv/.test(f.type) || /\.(pdf|xlsx|xls|csv)$/i.test(f.name)
    );
    dropped.forEach(enqueueFile);
  }, [enqueueFile]);

  const onPick = useCallback(e => {
    const picked = Array.from(e.target.files);
    picked.forEach(enqueueFile);
    e.target.value = "";
  }, [enqueueFile]);

  const dotStyle = s => ({
    width:10, height:10, borderRadius:"50%", flexShrink:0,
    background: s==="done" ? T.upcoming : s==="error" ? T.overdue : s==="pending" ? T.muted : T.gold,
    animation: s==="processing" ? "pulse 1s infinite" : "none",
  });

  return <div>
    <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
    <div
      onDragOver={e=>{e.preventDefault();setDragging(true)}}
      onDragLeave={()=>setDragging(false)}
      onDrop={onDrop}
      onClick={()=>inputRef.current.click()}
      style={{ border:`2px dashed ${dragging ? T.gold : T.border}`, borderRadius:16, padding:"60px 40px", textAlign:"center", cursor:"pointer", transition:"border-color .2s", marginBottom:24, background:dragging ? `${T.gold}08` : "transparent" }}>
      <div style={{ fontSize:40, marginBottom:12 }}>📤</div>
      <div style={{ color:T.text, fontWeight:600, fontSize:16, marginBottom:6 }}>Drop files here or click to browse</div>
      <div style={{ color:T.muted, fontSize:13 }}>Supports PDF, Excel (.xlsx, .xls), CSV</div>
      <input ref={inputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv" onChange={onPick} style={{ display:"none" }}/>
    </div>

    {files.length > 0 && <Card>
      <div style={{ fontWeight:600, color:T.text, marginBottom:14, fontSize:14 }}>Processing Queue</div>
      {files.map((f,i) => (
        <div key={f.name} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom:i<files.length-1 ? `1px solid ${T.border}` : "none" }}>
          <div style={dotStyle(f.status)}/>
          <span style={{ flex:1, color:T.text, fontSize:14, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
          {f.status === "error"
            ? <span style={{ fontSize:12, color:T.overdue, fontWeight:600 }}>Failed</span>
            : f.status === "pending"
            ? <span style={{ fontSize:12, color:T.muted, fontWeight:600 }}>Pending</span>
            : <span style={{ fontSize:12, color:f.status==="done" ? T.upcoming : T.gold, fontWeight:600 }}>
                {f.status==="done" ? "Extracted" : "Processing…"}
              </span>
          }
        </div>
      ))}
    </Card>}
  </div>;
}

/* ─── All Orders Tab ─── */
function AllOrdersTab({ orders, onDelete }) {
  if (!orders.length) return <Empty msg="No orders yet. Upload files to get started."/>;
  return <Card style={{ padding:0, overflow:"hidden" }}>
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:T.font }}>
        <thead>
          <tr style={{ background:`${T.gold}12` }}>
            {["Client","Order Date","Delivery Date","Items","Sales","Commission","File",""].map(h=>(
              <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontSize:12, color:T.muted, fontWeight:600, borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...orders].sort((a,b)=>b.date.localeCompare(a.date)).map(o=>{
            const ds = deliveryStatus(o.deliveryDate);
            return <tr key={o.id} style={{ borderBottom:`1px solid ${T.border}28` }}>
              <td style={{ padding:"12px 16px", color:T.text, fontWeight:600, fontSize:14 }}>{o.client}</td>
              <td style={{ padding:"12px 16px", color:T.muted, fontSize:13, whiteSpace:"nowrap" }}>{fmtDate(o.date)}</td>
              <td style={{ padding:"12px 16px", whiteSpace:"nowrap" }}>
                {o.deliveryDate
                  ? <span style={{ background:`${statusColor(ds)}20`, color:statusColor(ds), padding:"3px 10px", borderRadius:20, fontSize:12, fontWeight:600 }}>{fmtDate(o.deliveryDate)}</span>
                  : <span style={{ color:T.muted, fontSize:12 }}>—</span>}
              </td>
              <td style={{ padding:"12px 16px", maxWidth:200 }}>
                {o.items.slice(0,3).map((it,i)=><Badge key={i} label={it} bg={T.border} color={T.text}/>)}
                {o.items.length>3 && <Badge label={`+${o.items.length-3}`} bg={T.border} color={T.muted}/>}
              </td>
              <td style={{ padding:"12px 16px", color:T.text, fontWeight:600, whiteSpace:"nowrap" }}>{fmtMoney(o.total)}</td>
              <td style={{ padding:"12px 16px", color:T.gold, fontWeight:700, whiteSpace:"nowrap" }}>{fmtMoney(commission(o.total))}</td>
              <td style={{ padding:"12px 16px", color:T.muted, fontSize:12, maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{o.fileName}</td>
              <td style={{ padding:"12px 16px" }}>
                <button onClick={()=>onDelete(o.id)} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:6, color:T.muted, cursor:"pointer", padding:"4px 10px", fontSize:12 }}>Delete</button>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </Card>;
}

/* ─── Period Tabs (Weekly/Monthly/Yearly) ─── */
function PeriodTab({ orders, mode }) {
  const [selected, setSelected] = useState(null);

  const grouped = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      const key = mode==="weekly" ? getWeekKey(o.date) : mode==="monthly" ? getMonthKey(o.date) : getYearKey(o.date);
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(o);
    });
    return map;
  }, [orders, mode]);

  const periods   = useMemo(() => Object.keys(grouped).sort((a,b)=>b.localeCompare(a)), [grouped]);
  const revenues  = periods.map(p => grouped[p].reduce((s,o)=>s+o.total,0));
  const comms     = periods.map(p => grouped[p].filter(o=>!o.cancelled).reduce((s,o)=>s+commission(o.total),0));
  const maxRev    = Math.max(...revenues, 1);
  const grandTot  = revenues.reduce((s,v)=>s+v,0);
  const grandComm = comms.reduce((s,v)=>s+v,0);

  const PERIOD_MONTH_NAMES = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function periodLabel(key) {
    if (mode==="weekly") { const [y,w]=key.split("-W"); return `Week ${parseInt(w)}, ${y}`; }
    if (mode==="monthly") { const [y,m]=key.split("-"); return `${PERIOD_MONTH_NAMES[parseInt(m)]} ${y}`; }
    return key;
  }

  function monthBreakdown(yearKey) {
    const map = {};
    (grouped[yearKey]||[]).forEach(o=>{ const m=o.date.slice(0,7); map[m]=(map[m]||0)+o.total; });
    return Object.keys(map).sort().map(k=>({ key:k, total:map[k] }));
  }

  const selOrders = selected ? (grouped[selected]||[]) : [];
  const selRev  = selOrders.reduce((s,o)=>s+o.total,0);
  const selComm = selOrders.filter(o=>!o.cancelled).reduce((s,o)=>s+commission(o.total),0);

  if (!periods.length) return <Empty msg={`No ${mode} data yet.`}/>;

  return <div>
    {periods.map((p,i)=>(
      <PeriodRow key={p} label={periodLabel(p)} revenue={revenues[i]} commissionAmount={comms[i]} count={grouped[p].length} pct={Math.round(revenues[i]/maxRev*100)} onClick={()=>setSelected(selected===p?null:p)} isSelected={selected===p}/>
    ))}
    <GrandTotal label="All-Time Total" amount={grandTot} commissionAmount={grandComm}/>

    {selected && <SidePanel title={periodLabel(selected)} onClose={()=>setSelected(null)}>
      {mode==="yearly" && <div style={{ marginBottom:20 }}>
        <div style={{ fontWeight:600, fontSize:13, color:T.muted, marginBottom:10 }}>Month Breakdown</div>
        {monthBreakdown(selected).map(({key,total})=>{
          const [,m]=key.split("-");
          const mMax = monthBreakdown(selected).reduce((mx,x)=>Math.max(mx,x.total),1);
          return <div key={key} style={{ marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:3 }}>
              <span style={{ color:T.muted }}>{PERIOD_MONTH_NAMES[parseInt(m)]}</span>
              <span style={{ color:T.gold, fontWeight:600 }}>{fmtMoney(total)}</span>
            </div>
            <div style={{ height:3, borderRadius:2, background:T.border }}>
              <div style={{ width:`${Math.round(total/mMax*100)}%`, height:3, borderRadius:2, background:T.gold }}/>
            </div>
          </div>;
        })}
        <div style={{ height:1, background:T.border, margin:"16px 0" }}/>
      </div>}

      {[...selOrders].sort((a,b)=>b.date.localeCompare(a.date)).map(o=>(
        <div key={o.id} style={{ padding:"12px 0", borderBottom:`1px solid ${T.border}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
            <span style={{ fontWeight:600, color:T.text }}>{o.client}</span>
            <div style={{ textAlign:"right" }}>
              <div style={{ color:T.text, fontWeight:600, fontSize:13 }}>{fmtMoney(o.total)}</div>
              <div style={{ color:T.gold, fontWeight:700, fontSize:12 }}>{fmtMoney(commission(o.total))} comm.</div>
            </div>
          </div>
          <div style={{ fontSize:12, color:T.muted }}>{fmtDate(o.date)}{o.deliveryDate ? ` → ${fmtDate(o.deliveryDate)}` : ""}</div>
          <div style={{ marginTop:6 }}>{o.items.slice(0,2).map((it,i)=><Badge key={i} label={it} bg={T.border} color={T.text}/>)}</div>
        </div>
      ))}
      <GrandTotal label="Period Total" amount={selRev} commissionAmount={selComm}/>
    </SidePanel>}
  </div>;
}

/* ─── Clients Tab ─── */
function ClientsTab({ orders }) {
  const clients = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      if (!map[o.client]) map[o.client] = { orders:[], total:0 };
      map[o.client].orders.push(o);
      map[o.client].total += o.total;
    });
    const grand = orders.reduce((s,o)=>s+o.total,0) || 1;
    return Object.entries(map).map(([name,d])=>({
      name,
      total:        d.total,
      count:        d.orders.length,
      lastOrder:    d.orders.map(o=>o.date).sort().at(-1),
      nextDelivery: d.orders.map(o=>o.deliveryDate).filter(Boolean).filter(dd=>dd>=todayStr()).sort()[0] || null,
      pct:          Math.round(d.total/grand*100),
    })).sort((a,b)=>b.total-a.total);
  }, [orders]);

  const maxRev = clients[0]?.total || 1;
  if (!clients.length) return <Empty msg="No client data yet."/>;

  return <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:12 }}>
    {clients.map((c,i)=>(
      <Card key={c.name}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <div>
            <div style={{ fontWeight:700, fontSize:15, color:T.text }}>{c.name}</div>
            <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>{c.count} order{c.count!==1?"s":""}</div>
          </div>
          {i===0 && <Badge label="Top Client" bg={T.gold} color={T.bg}/>}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:12 }}>
          <div>
            <div style={{ fontSize:11, color:T.muted }}>Last Order</div>
            <div style={{ fontSize:13, color:T.text, fontWeight:500 }}>{fmtDate(c.lastOrder)}</div>
          </div>
          {c.nextDelivery && <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:11, color:T.muted }}>Next Delivery</div>
            <div style={{ fontSize:13, color:T.upcoming, fontWeight:600 }}>{fmtDate(c.nextDelivery)}</div>
          </div>}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:T.text }}>{fmtMoney(c.total)}</div>
            <div style={{ fontSize:12, color:T.gold, fontWeight:600 }}>{fmtMoney(commission(c.total))} comm.</div>
          </div>
          <span style={{ fontSize:13, color:T.muted }}>{c.pct}% of sales</span>
        </div>
        <div style={{ height:4, borderRadius:2, background:T.border }}>
          <div style={{ width:`${Math.round(c.total/maxRev*100)}%`, height:4, borderRadius:2, background:T.gold }}/>
        </div>
      </Card>
    ))}
  </div>;
}

/* ─── Deliveries Tab ─── */
function DeliveriesTab({ orders, onCancel }) {
  const [filter, setFilter] = useState("all");

  const enriched = useMemo(()=>orders.map(o=>({...o, ds:deliveryStatus(o.deliveryDate)})), [orders]);
  const filtered = useMemo(()=> filter==="all" ? enriched : enriched.filter(o=>o.ds===filter), [enriched, filter]);

  const chips = [
    {key:"all",label:"All"},
    {key:"delivered",label:"Delivered"},
    {key:"today",label:"Today"},
    {key:"upcoming",label:"Upcoming"},
    {key:"no-date",label:"No Date"},
  ];

  const clientGroups = useMemo(()=>{
    const map = {};
    filtered.forEach(o=>{
      if (!map[o.client]) map[o.client]={client:o.client,orders:[]};
      map[o.client].orders.push(o);
    });
    const score = ds => ({today:0,upcoming:1,delivered:2,"no-date":3})[ds]??3;
    return Object.values(map).sort((a,b)=>{
      return Math.min(...a.orders.map(o=>score(o.ds))) - Math.min(...b.orders.map(o=>score(o.ds)));
    });
  },[filtered]);

  const sortedFiltered = useMemo(()=>{
    const s = {today:0,upcoming:1,delivered:2,"no-date":3};
    return [...filtered].sort((a,b)=> (s[a.ds]??2)-(s[b.ds]??2) || (a.deliveryDate||"z").localeCompare(b.deliveryDate||"z"));
  },[filtered]);

  return <div>
    <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
      {chips.map(c=>(
        <button key={c.key} onClick={()=>setFilter(c.key)}
          style={{ padding:"6px 16px", borderRadius:20, border:`1px solid ${filter===c.key ? T.gold : T.border}`, background:filter===c.key ? `${T.gold}20` : "transparent", color:filter===c.key ? T.gold : T.muted, cursor:"pointer", fontSize:13, fontWeight:filter===c.key?600:400 }}>
          {c.label}
        </button>
      ))}
    </div>

    {!filtered.length ? <Empty msg="No deliveries match this filter."/> : <>
      <Card style={{ padding:0, overflow:"hidden", marginBottom:24 }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:T.font }}>
            <thead>
              <tr style={{ background:`${T.gold}12` }}>
                {["Client","Order Date","Delivery Date","Status","Items","Sales","Commission",""].map(h=>(
                  <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontSize:12, color:T.muted, fontWeight:600, borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map(o=>(
                <tr key={o.id} style={{ borderBottom:`1px solid ${T.border}28` }}>
                  <td style={{ padding:"12px 16px", color:T.text, fontWeight:600, fontSize:14 }}>{o.client}</td>
                  <td style={{ padding:"12px 16px", color:T.muted, fontSize:13, whiteSpace:"nowrap" }}>{fmtDate(o.date)}</td>
                  <td style={{ padding:"12px 16px", color:T.muted, fontSize:13, whiteSpace:"nowrap" }}>{fmtDate(o.deliveryDate)}</td>
                  <td style={{ padding:"12px 16px" }}>
                    <span style={{ background:`${statusColor(o.ds)}20`, color:statusColor(o.ds), padding:"3px 12px", borderRadius:20, fontSize:12, fontWeight:600 }}>{statusLabel(o.ds)}</span>
                  </td>
                  <td style={{ padding:"12px 16px" }}>
                    {o.items.slice(0,2).map((it,i)=><Badge key={i} label={it} bg={T.border} color={T.text}/>)}
                    {o.items.length>2 && <Badge label={`+${o.items.length-2}`} bg={T.border} color={T.muted}/>}
                  </td>
                  <td style={{ padding:"12px 16px", color:T.text, fontWeight:600, whiteSpace:"nowrap" }}>{fmtMoney(o.total)}</td>
                  <td style={{ padding:"12px 16px", color:T.gold, fontWeight:700, whiteSpace:"nowrap" }}>{fmtMoney(commission(o.total))}</td>
                  <td style={{ padding:"12px 16px" }}>
                    <button onClick={()=>onCancel(o.id)} style={{ background:"none", border:`1px solid ${T.overdue}40`, borderRadius:6, color:T.overdue, cursor:"pointer", padding:"4px 10px", fontSize:12 }}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
        {clientGroups.map(g=>{
          const scoreMap = {today:0,upcoming:1,delivered:2,"no-date":3};
          const urgency = Math.min(...g.orders.map(o=>scoreMap[o.ds]??3));
          const urgencyDs = ["today","upcoming","delivered","no-date"][urgency] || "no-date";
          return <Card key={g.client} style={{ borderLeft:`3px solid ${statusColor(urgencyDs)}` }}>
            <div style={{ fontWeight:700, fontSize:14, color:T.text, marginBottom:10 }}>{g.client}</div>
            {g.orders.map(o=>(
              <div key={o.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:`1px solid ${T.border}28`, fontSize:13 }}>
                <div>
                  <span style={{ color:statusColor(o.ds), fontWeight:600 }}>{fmtDate(o.deliveryDate)}</span>
                  <span style={{ color:T.muted, marginLeft:8 }}>{o.items[0]||"Order"}</span>
                </div>
                <span style={{ background:`${statusColor(o.ds)}20`, color:statusColor(o.ds), padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:600 }}>{statusLabel(o.ds)}</span>
              </div>
            ))}
          </Card>;
        })}
      </div>
    </>}
  </div>;
}

/* ─── Cancelled Tab ─── */
function CancelledTab({ orders, onRestore, onDelete }) {
  if (!orders.length) return <Empty msg="No cancelled orders."/>;
  const totalLost = orders.reduce((s,o)=>s+o.total,0);
  return <div>
    <Card style={{ padding:12, marginBottom:16, display:"flex", justifyContent:"space-between", alignItems:"center", background:`${T.overdue}10`, border:`1px solid ${T.overdue}30` }}>
      <div style={{ fontSize:13, color:T.muted }}>{orders.length} cancelled order{orders.length!==1?"s":""}</div>
      <div style={{ textAlign:"right" }}>
        <div style={{ fontSize:15, fontWeight:700, color:T.overdue }}>{fmtMoney(totalLost)} lost sales</div>
        <div style={{ fontSize:12, color:T.muted, marginTop:1 }}>{fmtMoney(commission(totalLost))} lost commission</div>
      </div>
    </Card>
    <Card style={{ padding:0, overflow:"hidden" }}>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:T.font }}>
          <thead>
            <tr style={{ background:`${T.overdue}10` }}>
              {["Client","Order Date","Items","Sales","Commission","File",""].map(h=>(
                <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontSize:12, color:T.muted, fontWeight:600, borderBottom:`1px solid ${T.border}`, whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...orders].sort((a,b)=>b.date.localeCompare(a.date)).map(o=>(
              <tr key={o.id} style={{ borderBottom:`1px solid ${T.border}28`, opacity:0.75 }}>
                <td style={{ padding:"12px 16px", fontWeight:600, fontSize:14 }}>
                  <div style={{ color:T.text }}>{o.client}</div>
                  <div style={{ fontSize:11, marginTop:2 }}><span style={{ background:`${T.overdue}20`, color:T.overdue, padding:"1px 8px", borderRadius:20, fontWeight:600 }}>Cancelled</span></div>
                </td>
                <td style={{ padding:"12px 16px", color:T.muted, fontSize:13, whiteSpace:"nowrap" }}>{fmtDate(o.date)}</td>
                <td style={{ padding:"12px 16px", maxWidth:200 }}>
                  {o.items.slice(0,3).map((it,i)=><Badge key={i} label={it} bg={T.border} color={T.muted}/>)}
                  {o.items.length>3 && <Badge label={`+${o.items.length-3}`} bg={T.border} color={T.muted}/>}
                </td>
                <td style={{ padding:"12px 16px", color:T.muted, fontWeight:600, whiteSpace:"nowrap", textDecoration:"line-through" }}>{fmtMoney(o.total)}</td>
                <td style={{ padding:"12px 16px", color:T.muted, whiteSpace:"nowrap", textDecoration:"line-through" }}>{fmtMoney(commission(o.total))}</td>
                <td style={{ padding:"12px 16px", color:T.muted, fontSize:12, maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{o.fileName}</td>
                <td style={{ padding:"12px 16px" }}>
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={()=>onRestore(o.id)} style={{ background:"none", border:`1px solid ${T.upcoming}50`, borderRadius:6, color:T.upcoming, cursor:"pointer", padding:"4px 10px", fontSize:12 }}>Restore</button>
                    <button onClick={()=>onDelete(o.id)} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:6, color:T.muted, cursor:"pointer", padding:"4px 10px", fontSize:12 }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  </div>;
}

/* ─── Main App ─── */
const BASE_TABS = ["Upload","All Orders","Weekly","Monthly","Yearly","Clients","Deliveries","Cancelled"];

function tabsForRole(role) {
  if (role === "god") return [...BASE_TABS, "Dashboard", "Admin"];
  if (role === "manager") return [...BASE_TABS, "Dashboard"];
  return BASE_TABS;
}

function roleColor(role) {
  if (role === "god") return T.gold;
  if (role === "manager") return T.upcoming;
  return T.muted;
}

export default function SalesDesk() {
  return (
    <>
      <SignedOut>
        <SignInScreen/>
      </SignedOut>
      <SignedIn>
        <AuthedApp/>
      </SignedIn>
    </>
  );
}

function SignInScreen() {
  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:T.font, color:T.text, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:32, fontWeight:700, marginBottom:8, letterSpacing:"-0.5px" }}>
          Sales<span style={{ color:T.gold }}>Desk</span>
        </div>
        <div style={{ fontSize:13, color:T.muted, marginBottom:24 }}>Sign in to continue</div>
        <SignIn appearance={{ baseTheme: undefined, variables: { colorPrimary: T.gold, colorBackground: T.card, colorText: T.text, colorInputBackground: T.bg, colorInputText: T.text } }}/>
      </div>
    </div>
  );
}

function AuthedApp() {
  const { getToken } = useAuth();
  const [me, setMe] = useState(null);
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState("Upload");
  const [uploadFiles, setUploadFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const apiFetch = useCallback(async (path, opts = {}) => {
    const token = await getToken();
    const resp = await fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`${resp.status} ${text || resp.statusText}`);
    }
    if (resp.status === 204) return null;
    return resp.json();
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meData = await apiFetch("/api/me");
        if (cancelled) return;
        setMe(meData);
        const ordersData = await apiFetch("/api/orders");
        if (cancelled) return;
        setOrders(ordersData || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiFetch]);

  const addOrder = useCallback(async (extracted) => {
    const saved = await apiFetch("/api/orders", { method:"POST", body: JSON.stringify(extracted) });
    setOrders(prev => [saved, ...prev]);
  }, [apiFetch]);

  const cancelOrder = useCallback(async (id) => {
    const updated = await apiFetch(`/api/orders?id=${encodeURIComponent(id)}`, { method:"PATCH", body: JSON.stringify({ cancelled:true }) });
    setOrders(prev => prev.map(o => o.id===id ? updated : o));
  }, [apiFetch]);

  const restoreOrder = useCallback(async (id) => {
    const updated = await apiFetch(`/api/orders?id=${encodeURIComponent(id)}`, { method:"PATCH", body: JSON.stringify({ cancelled:false }) });
    setOrders(prev => prev.map(o => o.id===id ? updated : o));
  }, [apiFetch]);

  const deleteOrder = useCallback(async (id) => {
    await apiFetch(`/api/orders?id=${encodeURIComponent(id)}`, { method:"DELETE" });
    setOrders(prev => prev.filter(o => o.id!==id));
  }, [apiFetch]);

  const activeOrders    = useMemo(()=>orders.filter(o=>!o.cancelled), [orders]);
  const cancelledOrders = useMemo(()=>orders.filter(o=>o.cancelled),  [orders]);
  const tabs = useMemo(()=>tabsForRole(me?.role), [me]);

  // If role changes (e.g., god demoted), snap selected tab back to a valid one
  useEffect(() => {
    if (me && !tabs.includes(tab)) setTab("Upload");
  }, [tabs, tab, me]);

  if (loading) {
    return <FullScreenMsg msg="Loading…"/>;
  }
  if (error) {
    return <FullScreenMsg msg={`Error: ${error}`} sub="Check that env vars are set on Vercel: VITE_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, KV_REST_API_URL, KV_REST_API_TOKEN"/>;
  }

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:T.font, color:T.text, padding:"24px 28px" }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
        <div>
          <div style={{ fontSize:24, fontWeight:700, color:T.text, letterSpacing:"-0.5px" }}>
            Sales<span style={{ color:T.gold }}>Desk</span>
          </div>
          <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>AI-Powered Sales File Manager</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:T.upcoming, boxShadow:`0 0 6px ${T.upcoming}` }}/>
            <span style={{ fontSize:12, color:T.muted }}>AI Connected</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 10px", background:T.card, border:`1px solid ${T.border}`, borderRadius:20 }}>
            <span style={{ fontSize:11, color:T.muted }}>{me?.email}</span>
            <span style={{ fontSize:10, fontWeight:700, color:roleColor(me?.role), textTransform:"uppercase", letterSpacing:"0.5px" }}>{me?.role}</span>
            {me?.office && <span style={{ fontSize:10, color:T.muted, textTransform:"uppercase" }}>· {me.office}</span>}
          </div>
          <UserButton afterSignOutUrl="/"/>
        </div>
      </div>

      <StatsBar orders={orders} activeOrders={activeOrders}/>

      {/* Tab Switcher */}
      <div style={{ display:"flex", gap:6, marginBottom:24, flexWrap:"wrap" }}>
        {tabs.map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            style={{ padding:"8px 18px", borderRadius:20, border:`1px solid ${tab===t ? T.gold : T.border}`, background:tab===t ? `${T.gold}20` : T.card, color:tab===t ? T.gold : T.muted, cursor:"pointer", fontFamily:T.font, fontSize:13, fontWeight:tab===t?600:400, transition:"all .15s" }}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab==="Upload"     && <UploadTab onOrderAdded={addOrder} files={uploadFiles} setFiles={setUploadFiles}/>}
      {tab==="All Orders" && <AllOrdersTab orders={activeOrders} onDelete={deleteOrder}/>}
      {tab==="Weekly"     && <PeriodTab orders={orders} mode="weekly"/>}
      {tab==="Monthly"    && <PeriodTab orders={orders} mode="monthly"/>}
      {tab==="Yearly"     && <PeriodTab orders={orders} mode="yearly"/>}
      {tab==="Clients"    && <ClientsTab orders={activeOrders}/>}
      {tab==="Deliveries" && <DeliveriesTab orders={activeOrders} onCancel={cancelOrder}/>}
      {tab==="Cancelled"  && <CancelledTab orders={cancelledOrders} onRestore={restoreOrder} onDelete={deleteOrder}/>}
      {tab==="Dashboard"  && <DashboardTab orders={orders} me={me}/>}
      {tab==="Admin"      && <AdminTab apiFetch={apiFetch}/>}
    </div>
  );
}

function FullScreenMsg({ msg, sub }) {
  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:T.font, color:T.text, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ textAlign:"center", maxWidth:520 }}>
        <div style={{ fontSize:18, color:T.text, marginBottom:8 }}>{msg}</div>
        {sub && <div style={{ fontSize:12, color:T.muted, lineHeight:1.5 }}>{sub}</div>}
      </div>
    </div>
  );
}

/* ─── Dashboard Tab (manager + god) ─── */
function DashboardTab({ orders, me }) {
  const active = useMemo(()=>orders.filter(o=>!o.cancelled), [orders]);
  const today = todayStr();
  const monthKey = today.slice(0,7);

  const byRep = useMemo(() => {
    const map = new Map();
    for (const o of active) {
      const key = o.repUserId || o.repEmail || "unknown";
      if (!map.has(key)) {
        map.set(key, { repUserId:key, repEmail:o.repEmail||"—", repName:o.repName||o.repEmail||"—", office:o.office||"—", count:0, total:0, monthTotal:0 });
      }
      const r = map.get(key);
      r.count += 1;
      r.total += Number(o.total)||0;
      if ((o.date||"").slice(0,7) === monthKey) r.monthTotal += Number(o.total)||0;
    }
    return [...map.values()].sort((a,b) => b.total - a.total);
  }, [active, monthKey]);

  const byOffice = useMemo(() => {
    const map = new Map();
    for (const o of active) {
      const key = o.office || "—";
      if (!map.has(key)) map.set(key, { office:key, count:0, total:0 });
      const r = map.get(key);
      r.count += 1;
      r.total += Number(o.total)||0;
    }
    return [...map.values()].sort((a,b) => b.total - a.total);
  }, [active]);

  if (!orders.length) return <Empty msg="No orders yet."/>;

  return (
    <div>
      <Card style={{ marginBottom:16 }}>
        <div style={{ fontSize:14, fontWeight:600, marginBottom:12, color:T.gold }}>
          Rep Performance {me?.role === "manager" ? `· ${me.office}` : "· all offices"}
        </div>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead>
            <tr style={{ color:T.muted, textAlign:"left" }}>
              <th style={{ padding:"6px 4px", borderBottom:`1px solid ${T.border}`, fontWeight:500 }}>Rep</th>
              <th style={{ padding:"6px 4px", borderBottom:`1px solid ${T.border}`, fontWeight:500 }}>Office</th>
              <th style={{ padding:"6px 4px", borderBottom:`1px solid ${T.border}`, fontWeight:500, textAlign:"right" }}>Orders</th>
              <th style={{ padding:"6px 4px", borderBottom:`1px solid ${T.border}`, fontWeight:500, textAlign:"right" }}>This Month</th>
              <th style={{ padding:"6px 4px", borderBottom:`1px solid ${T.border}`, fontWeight:500, textAlign:"right" }}>Total Sales</th>
              <th style={{ padding:"6px 4px", borderBottom:`1px solid ${T.border}`, fontWeight:500, textAlign:"right" }}>Commission (9%)</th>
            </tr>
          </thead>
          <tbody>
            {byRep.map(r => (
              <tr key={r.repUserId}>
                <td style={{ padding:"8px 4px", borderBottom:`1px solid ${T.border}` }}>
                  <div style={{ color:T.text }}>{r.repName}</div>
                  <div style={{ fontSize:11, color:T.muted }}>{r.repEmail}</div>
                </td>
                <td style={{ padding:"8px 4px", borderBottom:`1px solid ${T.border}`, color:T.muted }}>{r.office}</td>
                <td style={{ padding:"8px 4px", borderBottom:`1px solid ${T.border}`, textAlign:"right", color:T.text }}>{r.count}</td>
                <td style={{ padding:"8px 4px", borderBottom:`1px solid ${T.border}`, textAlign:"right", color:T.text }}>{fmtMoney(r.monthTotal)}</td>
                <td style={{ padding:"8px 4px", borderBottom:`1px solid ${T.border}`, textAlign:"right", color:T.text, fontWeight:600 }}>{fmtMoney(r.total)}</td>
                <td style={{ padding:"8px 4px", borderBottom:`1px solid ${T.border}`, textAlign:"right", color:T.gold, fontWeight:600 }}>{fmtMoney(commission(r.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {me?.role === "god" && byOffice.length > 0 && (
        <Card>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:12, color:T.gold }}>By Office</div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ color:T.muted, textAlign:"left" }}>
                <th style={{ padding:"6px 4px", borderBottom:`1px solid ${T.border}`, fontWeight:500 }}>Office</th>
                <th style={{ padding:"6px 4px", borderBottom:`1px solid ${T.border}`, fontWeight:500, textAlign:"right" }}>Orders</th>
                <th style={{ padding:"6px 4px", borderBottom:`1px solid ${T.border}`, fontWeight:500, textAlign:"right" }}>Total Sales</th>
              </tr>
            </thead>
            <tbody>
              {byOffice.map(o => (
                <tr key={o.office}>
                  <td style={{ padding:"8px 4px", borderBottom:`1px solid ${T.border}`, color:T.text, textTransform:"capitalize" }}>{o.office}</td>
                  <td style={{ padding:"8px 4px", borderBottom:`1px solid ${T.border}`, textAlign:"right", color:T.text }}>{o.count}</td>
                  <td style={{ padding:"8px 4px", borderBottom:`1px solid ${T.border}`, textAlign:"right", color:T.gold, fontWeight:600 }}>{fmtMoney(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/* ─── Admin Tab (god only) ─── */
function AdminTab({ apiFetch }) {
  const [data, setData] = useState({ users: [], offices: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const d = await apiFetch("/api/users");
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { reload(); }, [reload]);

  const updateUser = async (userId, patch) => {
    try {
      setSavingId(userId);
      const updated = await apiFetch(`/api/users?id=${encodeURIComponent(userId)}`, { method:"PATCH", body: JSON.stringify(patch) });
      setData(prev => ({ ...prev, users: prev.users.map(u => u.userId===userId ? updated : u) }));
    } catch (e) {
      alert(`Update failed: ${e.message}`);
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <Empty msg="Loading users…"/>;
  if (error)   return <Empty msg={`Error: ${error}`}/>;
  if (!data.users.length) return <Empty msg="No users yet."/>;

  return (
    <Card>
      <div style={{ fontSize:14, fontWeight:600, marginBottom:12, color:T.gold }}>User Management</div>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
        <thead>
          <tr style={{ color:T.muted, textAlign:"left" }}>
            <th style={{ padding:"6px 4px", borderBottom:`1px solid ${T.border}`, fontWeight:500 }}>User</th>
            <th style={{ padding:"6px 4px", borderBottom:`1px solid ${T.border}`, fontWeight:500 }}>Role</th>
            <th style={{ padding:"6px 4px", borderBottom:`1px solid ${T.border}`, fontWeight:500 }}>Office</th>
          </tr>
        </thead>
        <tbody>
          {data.users.map(u => (
            <tr key={u.userId}>
              <td style={{ padding:"10px 4px", borderBottom:`1px solid ${T.border}` }}>
                <div style={{ color:T.text }}>
                  {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email}
                  {u.isGod && <span style={{ marginLeft:8, fontSize:10, fontWeight:700, color:T.gold }}>GOD</span>}
                </div>
                <div style={{ fontSize:11, color:T.muted }}>{u.email}</div>
              </td>
              <td style={{ padding:"10px 4px", borderBottom:`1px solid ${T.border}` }}>
                <select
                  value={u.role}
                  disabled={u.isGod || savingId===u.userId}
                  onChange={e => updateUser(u.userId, { role: e.target.value })}
                  style={{ padding:"4px 8px", borderRadius:6, border:`1px solid ${T.border}`, background:T.bg, color:T.text, fontFamily:T.font, fontSize:13 }}>
                  <option value="rep">rep</option>
                  <option value="manager">manager</option>
                  {u.isGod && <option value="god">god</option>}
                </select>
              </td>
              <td style={{ padding:"10px 4px", borderBottom:`1px solid ${T.border}` }}>
                <select
                  value={u.office || ""}
                  disabled={u.isGod || savingId===u.userId}
                  onChange={e => updateUser(u.userId, { office: e.target.value })}
                  style={{ padding:"4px 8px", borderRadius:6, border:`1px solid ${T.border}`, background:T.bg, color:T.text, fontFamily:T.font, fontSize:13 }}>
                  {data.offices.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
