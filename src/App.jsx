import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";

/* ─── Load Clerk ─── */
let clerkInstance = null;
async function getClerk() {
  if (clerkInstance) return clerkInstance;
  const publishableKey = "pk_test_cG9zc2libGUtcGVhY29jay04LmNsZXJrLmFjY291bnRzLmRldiQ";
  const frontendApiUrl = "https://possible-peacock-8.clerk.accounts.dev";
  await new Promise((resolve, reject) => {
    if (window.Clerk) return resolve();
    const script = document.createElement("script");
    script.setAttribute("data-clerk-publishable-key", publishableKey);
    script.src = `${frontendApiUrl}/npm/@clerk/clerk-js@latest/dist/clerk.browser.js`;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  // Frontend API script pre-initializes window.Clerk as an instance, just call load()
  await window.Clerk.load();
  clerkInstance = window.Clerk;
  return clerkInstance;
}

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
  goldDim: "#b37f00",
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

function sanitizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;

  // DD/MM or DD-MM (no year — assume current year)
  const dm = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (dm) return `${new Date().getFullYear()}-${dm[2].padStart(2,"0")}-${dm[1].padStart(2,"0")}`;

  // "30 avril2026" or "30avril2026" or "30 avril 2026" — day + month word + year (spaces optional)
  const long = s.match(/^(\d{1,2})\s*([a-zA-ZÀ-ÿ]+)\s*(\d{4})$/i);
  if (long) {
    const mon = FR_MONTHS[long[2].toLowerCase()] || EN_MONTHS[long[2].toLowerCase()];
    if (mon) return `${long[3]}-${String(mon).padStart(2,"0")}-${long[1].padStart(2,"0")}`;
  }

  return null;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const [y,m,d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const COMMISSION_RATE = 0.09;
function commission(n) { return Number(n) * COMMISSION_RATE; }

function fmtMoney(n) {
  if (n == null || isNaN(n)) return "$0.00";
  return "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function getWeekKey(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T12:00:00");
  const thu = new Date(d); thu.setDate(d.getDate() - (d.getDay()+6)%7 + 3);
  const y = thu.getFullYear();
  const jan4 = new Date(y, 0, 4);
  const w = 1 + Math.round(((thu - jan4) / 86400000 - 3 + (jan4.getDay()+6)%7) / 7);
  return `${y}-W${String(w).padStart(2,"0")}`;
}

function getMonthKey(iso) { return iso ? iso.slice(0,7) : null; }
function getYearKey(iso)  { return iso ? iso.slice(0,4) : null; }

function deliveryStatus(deliveryDateIso) {
  if (!deliveryDateIso) return "no-date";
  const today = todayStr();
  if (deliveryDateIso < today) return "delivered";
  if (deliveryDateIso === today) return "today";
  return "upcoming";
}

function statusColor(s) {
  return { delivered: "#7a8099", today: T.today, upcoming: T.upcoming, "no-date": T.noDate }[s] || T.noDate;
}
function statusLabel(s) {
  return { delivered:"Delivered", today:"Today", upcoming:"Upcoming", "no-date":"No Date" }[s] || "No Date";
}

/* ─── Excel serial → DD-MM-YYYY ─── */
function excelSerialToDate(serial) {
  const d = XLSX.SSF.parse_date_code(serial);
  if (!d) return String(serial);
  return `${String(d.d).padStart(2,"0")}-${String(d.m).padStart(2,"0")}-${d.y}`;
}

function isDateSerial(val, cell) {
  return cell && cell.t === "n" && cell.z && /[ymd\/\-]/i.test(cell.z) && typeof val === "number";
}

/* ─── Parse spreadsheet ─── */
function parseSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type:"array", cellDates:false, cellNF:true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
        const rows = [];
        for (let r = range.s.r; r <= range.e.r; r++) {
          const row = [];
          for (let c = range.s.c; c <= range.e.c; c++) {
            const addr = XLSX.utils.encode_cell({r,c});
            const cell = ws[addr];
            if (!cell) { row.push(""); continue; }
            if (isDateSerial(cell.v, cell)) {
              row.push(excelSerialToDate(cell.v));
            } else {
              row.push(cell.v != null ? String(cell.v) : "");
            }
          }
          rows.push(row);
        }
        const csv = rows.map(r => r.map(v => `"${v.replace(/"/g,'""')}"`).join(",")).join("\n");
        resolve(csv);
      } catch(err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ─── AI Extraction ─── */
async function extractFromFile(file) {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  let messages;

  const sysPrompt = `You are a sales document parser for Alimentation Première. The document text is split into labeled pages (=== PAGE 1 ===, === PAGE 13 ===, etc).

Extract order data and return ONLY a JSON object with these exact keys:
- client (string — client name from PAGE 1)
- date (string, format DD/MM/YYYY — order date from PAGE 1)
- deliveryDate (string in DD/MM/YYYY format, or null — first delivery date from PAGE 13, may be in French like "21 avril 2026")
- total (number — from PAGE 13 only: find the single line "Total du concept alimentaire" and extract that one number. It appears ONCE. Do NOT add it to anything else. Do NOT use delivery amounts or weekly payments.)
- items (array of strings — product names ordered)
Return ONLY the JSON object, no markdown, no explanation.`;

  if (isPdf) {
    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const script = document.createElement("script");
          script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          await new Promise(r => { script.onload = r; document.head.appendChild(script); });
          const pdfjsLib = window.pdfjsLib;
          pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(e.target.result) }).promise;
          const numPages = pdf.numPages;
          const lastPage = Math.min(numPages, 14);
          const pagesToRead = [...new Set([1, lastPage])];
          let text = "";
          for (const pageNum of pagesToRead) {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            text += `=== PAGE ${pageNum} ===\n` + content.items.map(i => i.str).join(" ") + "\n\n";
          }
          resolve(text);
        } catch(err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
    messages = [{ role:"user", content:`Extract the sales order data from this document. Return ONLY a JSON object.\n\n${text}` }];
  } else {
    const csv = await parseSpreadsheet(file);
    messages = [{ role:"user", content:`Extract the sales order data from this spreadsheet CSV:\n\n${csv}\n\nReturn ONLY a JSON object.` }];
  }

  const resp = await fetch("/api/extract", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ model:"claude-sonnet-4-5", max_tokens:1024, system:sysPrompt, messages })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${resp.status}`);
  }
  const data = await resp.json();
  if (!data.content?.[0]?.text) throw new Error("Empty response from AI");
  const text = data.content[0].text.replace(/```json|```/g,"").trim();
  const parsed = JSON.parse(text);
  return {
    client: parsed.client || "Unknown",
    date: sanitizeDate(parsed.date) || todayStr(),
    deliveryDate: (() => { try { return sanitizeDate(parsed.deliveryDate) || null; } catch(_) { return null; } })(),
    total: Number(String(parsed.total).replace(/,/g, "").replace(/\s*\$/, "").trim()) || 0,
    items: Array.isArray(parsed.items) ? parsed.items : [],
  };
}

/* ─── Reusable Atoms ─── */
function Card({ children, style }) {
  return <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:20, ...style }}>{children}</div>;
}

function Badge({ label, color, bg }) {
  return <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:600, color: color||T.bg, background: bg||T.gold, marginRight:4, marginBottom:2, whiteSpace:"nowrap" }}>{label}</span>;
}

function Empty({ msg }) {
  return <div style={{ textAlign:"center", color:T.muted, padding:"60px 0", fontSize:14 }}>
    <div style={{ fontSize:32, marginBottom:8 }}>📂</div>
    {msg}
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
  return <div onClick={onClick} style={{ display:"flex", alignItems:"center", gap:16, padding:"14px 16px", borderRadius:10, cursor:"pointer", marginBottom:6, background: isSelected ? `${T.gold}18` : "transparent", border:`1px solid ${isSelected ? T.gold+"40" : T.border}`, transition:"all .15s" }}>
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
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function StatsBar({ orders, activeOrders }) {
  const today = todayStr();
  const currentMonthKey = today.slice(0, 7);
  const weekStart = (() => { const d=new Date(today+"T12:00:00"); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); })();

  // Sales totals include ALL orders (including cancelled)
  const totalSales      = orders.reduce((s,o)=>s+o.total,0);
  const weekSales       = orders.filter(o=>o.date>=weekStart).reduce((s,o)=>s+o.total,0);
  const monthSales      = orders.filter(o=>o.date.slice(0,7)===currentMonthKey).reduce((s,o)=>s+o.total,0);
  const monthOrders     = orders.filter(o=>o.date.slice(0,7)===currentMonthKey).length;
  const clients         = new Set(orders.map(o=>o.client)).size;

  // Commission only on active (non-cancelled) orders
  const totalComm       = activeOrders.reduce((s,o)=>s+o.total,0);
  const weekActiveComm  = activeOrders.filter(o=>o.date>=weekStart).reduce((s,o)=>s+o.total,0);
  const monthActiveComm = activeOrders.filter(o=>o.date.slice(0,7)===currentMonthKey).reduce((s,o)=>s+o.total,0);

  return <div style={{ marginBottom:24 }}>
    {/* Top row: 3 cards */}
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
    {/* Bottom row: 2 wide cards */}
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
      <Card style={{ padding:20, display:"flex", flexDirection:"column", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <span style={{ fontSize:18 }}>📅</span>
          <span style={{ fontSize:12, color:T.muted, fontWeight:600 }}>THIS WEEK</span>
        </div>
        <div>
          <div style={{ fontSize:28, fontWeight:700, color:T.text, letterSpacing:"-0.5px" }}>{fmtMoney(weekSales)}</div>
          <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>{orders.filter(o=>o.date>=weekStart).length} order{orders.filter(o=>o.date>=weekStart).length!==1?"s":""} this week</div>
        </div>
        <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${T.border}` }}>
          <div style={{ fontSize:22, fontWeight:700, color:T.gold }}>{fmtMoney(commission(weekActiveComm))}</div>
          <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>My Commission (9%)</div>
        </div>
      </Card>
      <Card style={{ padding:20, display:"flex", flexDirection:"column", justifyContent:"space-between", border:`1px solid ${T.gold}30` }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <span style={{ fontSize:18 }}>📆</span>
          <span style={{ fontSize:12, color:T.muted, fontWeight:600 }}>THIS MONTH</span>
        </div>
        <div>
          <div style={{ fontSize:28, fontWeight:700, color:T.text, letterSpacing:"-0.5px" }}>{fmtMoney(monthSales)}</div>
          <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>{monthOrders} order{monthOrders!==1?"s":""} this month</div>
        </div>
        <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${T.border}` }}>
          <div style={{ fontSize:22, fontWeight:700, color:T.gold }}>{fmtMoney(commission(monthActiveComm))}</div>
          <div style={{ fontSize:11, color:T.muted, marginTop:1 }}>My Commission (9%)</div>
        </div>
      </Card>
    </div>
  </div>;
}

/* ─── Upload Tab ─── */
function UploadTab({ onOrdersAdded, files, setFiles }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const processOne = useCallback(async (entry) => {
    setFiles(prev => prev.map(e => e.name===entry.name ? {...e, status:"processing"} : e));
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 3000 * attempt));
        const data = await extractFromFile(entry.file);
        const order = { id: Date.now()+Math.random(), fileName:entry.file.name, ...data };
        onOrdersAdded(order);
        setFiles(prev => prev.map(e => e.name===entry.name ? {...e, status:"done"} : e));
        return;
      } catch(err) {
        lastError = err;
      }
    }
    setFiles(prev => prev.map(e => e.name===entry.name ? {...e, status:"error", error:lastError?.message} : e));
  }, [onOrdersAdded]);

  const process = useCallback(async (newFiles) => {
    const entries = newFiles.map(f => ({ file:f, status:"processing", name:f.name }));
    setFiles(prev => {
      const existingNames = new Set(prev.map(e => e.name));
      const fresh = entries.filter(e => !existingNames.has(e.name));
      return [...prev, ...fresh];
    });
    for (const entry of entries) {
      await processOne(entry);
    }
  }, [processOne]);

  const retry = useCallback((entry) => {
    processOne(entry);
  }, [processOne]);

  const onDrop = useCallback(e => {
    e.preventDefault(); setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter(f => /pdf|excel|spreadsheet|csv/.test(f.type) || /\.(pdf|xlsx|xls|csv)$/i.test(f.name));
    if (dropped.length) process(dropped);
  }, [process]);

  const onPick = e => {
    const picked = Array.from(e.target.files);
    if (picked.length) process(picked);
    e.target.value = "";
  };

  const dotStyle = s => ({
    width:10, height:10, borderRadius:"50%",
    background: s==="done" ? T.upcoming : s==="error" ? T.overdue : T.gold,
    animation: s==="processing" ? "pulse 1s infinite" : "none",
    flexShrink:0,
  });

  return <div>
    <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
    <div onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={onDrop}
      style={{ border:`2px dashed ${dragging ? T.gold : T.border}`, borderRadius:16, padding:"60px 40px", textAlign:"center", cursor:"pointer", transition:"border-color .2s", marginBottom:24, background: dragging ? `${T.gold}08` : "transparent" }}
      onClick={()=>inputRef.current.click()}>
      <div style={{ fontSize:40, marginBottom:12 }}>📤</div>
      <div style={{ color:T.text, fontWeight:600, fontSize:16, marginBottom:6 }}>Drop files here or click to browse</div>
      <div style={{ color:T.muted, fontSize:13 }}>Supports PDF, Excel (.xlsx, .xls), CSV</div>
      <input ref={inputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv" onChange={onPick} style={{ display:"none" }}/>
    </div>

    {files.length > 0 && <Card>
      <div style={{ fontWeight:600, color:T.text, marginBottom:14, fontSize:14 }}>Processing Queue</div>
      {files.map((f,i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 0", borderBottom: i<files.length-1 ? `1px solid ${T.border}` : "none" }}>
          <div style={dotStyle(f.status)}/>
          <span style={{ flex:1, color:T.text, fontSize:14, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
          {f.status === "error" ? (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:12, color:T.overdue, fontWeight:600 }}>Failed</span>
                <button onClick={()=>retry(f)}
                  style={{ padding:"3px 12px", borderRadius:20, border:`1px solid ${T.gold}`, background:"transparent", color:T.gold, cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:T.font }}>
                  Retry
                </button>
              </div>
              {f.error && <span style={{ fontSize:11, color:T.overdue, maxWidth:200, textAlign:"right" }}>{f.error}</span>}
            </div>
          ) : (
            <span style={{ fontSize:12, color: f.status==="done"?T.upcoming:T.gold, fontWeight:600 }}>
              {f.status==="done"?"Extracted":"Processing…"}
            </span>
          )}
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

  // orders here = ALL orders (incl. cancelled), so sales totals are complete
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

  const periods = useMemo(() => Object.keys(grouped).sort((a,b)=>b.localeCompare(a)), [grouped]);
  const revenues = periods.map(p=>grouped[p].reduce((s,o)=>s+o.total,0));
  // Commission only on non-cancelled orders within each period
  const commissions = periods.map(p=>grouped[p].filter(o=>!o.cancelled).reduce((s,o)=>s+commission(o.total),0));
  const maxRev = Math.max(...revenues, 1);
  const grandTotal = revenues.reduce((s,v)=>s+v,0);
  const grandComm = commissions.reduce((s,v)=>s+v,0);

  function periodLabel(key) {
    if (mode==="weekly") {
      const [y,w] = key.split("-W");
      return `Week ${parseInt(w)}, ${y}`;
    }
    if (mode==="monthly") {
      const [y,m] = key.split("-");
      const names=["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${names[parseInt(m)]} ${y}`;
    }
    return key;
  }

  function monthBreakdown(yearKey) {
    const yr = grouped[yearKey] || [];
    const map = {};
    yr.forEach(o=>{ const m=o.date.slice(0,7); map[m]=(map[m]||0)+o.total; });
    return Object.keys(map).sort().map(k=>({ key:k, total:map[k] }));
  }

  const selOrders = selected ? (grouped[selected]||[]) : [];
  const selRev = selOrders.reduce((s,o)=>s+o.total,0);
  const selComm = selOrders.filter(o=>!o.cancelled).reduce((s,o)=>s+commission(o.total),0);

  if (!periods.length) return <Empty msg={`No ${mode} data yet.`}/>;

  return <div>
    {periods.map((p,i)=>(
      <PeriodRow key={p} label={periodLabel(p)} revenue={revenues[i]} commissionAmount={commissions[i]} count={grouped[p].length} pct={Math.round(revenues[i]/maxRev*100)} onClick={()=>setSelected(selected===p?null:p)} isSelected={selected===p}/>
    ))}
    <GrandTotal label="All-Time Total" amount={grandTotal} commissionAmount={grandComm}/>

    {selected && <SidePanel title={periodLabel(selected)} onClose={()=>setSelected(null)}>
      {mode==="yearly" && (<div style={{ marginBottom:20 }}>
        <div style={{ fontWeight:600, fontSize:13, color:T.muted, marginBottom:10 }}>Month Breakdown</div>
        {monthBreakdown(selected).map(({key,total})=>{
          const names=["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const [,m]=key.split("-");
          const mRev = monthBreakdown(selected).reduce((s,x)=>Math.max(s,x.total),1);
          return <div key={key} style={{ marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:3 }}>
              <span style={{ color:T.muted }}>{names[parseInt(m)]}</span>
              <span style={{ color:T.gold, fontWeight:600 }}>{fmtMoney(total)}</span>
            </div>
            <div style={{ height:3, borderRadius:2, background:T.border }}>
              <div style={{ width:`${Math.round(total/mRev*100)}%`, height:3, borderRadius:2, background:T.gold }}/>
            </div>
          </div>;
        })}
        <div style={{ height:1, background:T.border, margin:"16px 0" }}/>
      </div>)}

      {selOrders.sort((a,b)=>b.date.localeCompare(a.date)).map(o=>(
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
  const [search, setSearch] = useState("");

  const clients = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      if (!map[o.client]) map[o.client] = { orders:[], total:0 };
      map[o.client].orders.push(o);
      map[o.client].total += o.total;
    });
    const grand = orders.reduce((s,o)=>s+o.total,0)||1;
    return Object.entries(map).map(([name,d])=>({
      name,
      total: d.total,
      count: d.orders.length,
      lastOrder: d.orders.map(o=>o.date).sort().at(-1),
      nextDelivery: d.orders.map(o=>o.deliveryDate).filter(Boolean).filter(dd=>dd>=todayStr()).sort()[0]||null,
      pct: Math.round(d.total/grand*100),
    })).sort((a,b)=>b.total-a.total);
  }, [orders]);

  const maxRev = clients[0]?.total || 1;
  const filtered = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  if (!clients.length) return <Empty msg="No client data yet."/>;

  return <div>
    <div style={{ marginBottom:16 }}>
      <input
        value={search}
        onChange={e=>setSearch(e.target.value)}
        placeholder="Search clients…"
        style={{ width:"100%", padding:"10px 16px", borderRadius:10, border:`1px solid ${T.border}`, background:T.card, color:T.text, fontSize:14, fontFamily:T.font, outline:"none", boxSizing:"border-box" }}
      />
    </div>
    {filtered.length === 0 && <Empty msg="No clients match your search."/>}
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:12 }}>
      {filtered.map((c,i)=>(
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
    </div>
  </div>;
}

/* ─── Deliveries Tab ─── */
function DeliveriesTab({ orders, onToggleDeliveryCancel, onCancel }) {
  const [filter, setFilter] = useState("all");

  const enriched = useMemo(()=>orders.map(o=>({...o, ds:deliveryStatus(o.deliveryDate)})), [orders]);

  const filtered = useMemo(()=>{
    if (filter==="all") return enriched;
    return enriched.filter(o=>o.ds===filter);
  },[enriched,filter]);

  const chips = [
    { key:"all", label:"All" },
    { key:"delivered", label:"Delivered" },
    { key:"today", label:"Today" },
    { key:"upcoming", label:"Upcoming" },
    { key:"no-date", label:"No Date" },
  ];

  const clientGroups = useMemo(()=>{
    const map = {};
    filtered.forEach(o=>{
      if (!map[o.client]) map[o.client]={client:o.client,orders:[]};
      map[o.client].orders.push(o);
    });
    const urgencyScore = ds => ({"delivery-cancelled":0,today:1,upcoming:2,delivered:3,"no-date":4})[ds]??4;
    return Object.values(map).sort((a,b)=>{
      const sa=Math.min(...a.orders.map(o=>urgencyScore(o.ds)));
      const sb=Math.min(...b.orders.map(o=>urgencyScore(o.ds)));
      return sa-sb;
    });
  },[filtered]);

  return <div>
    <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
      {chips.map(c=>(
        <button key={c.key} onClick={()=>setFilter(c.key)}
          style={{ padding:"6px 16px", borderRadius:20, border:`1px solid ${filter===c.key ? T.gold : T.border}`, background: filter===c.key ? `${T.gold}20` : "transparent", color: filter===c.key ? T.gold : T.muted, cursor:"pointer", fontSize:13, fontWeight:filter===c.key?600:400 }}>
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
              {filtered.sort((a,b)=>{
                const s={"delivery-cancelled":0,today:1,upcoming:2,delivered:3,"no-date":4};
                return (s[a.ds]??3)-(s[b.ds]??3) || (a.deliveryDate||"z").localeCompare(b.deliveryDate||"z");
              }).map(o=>(
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
          const urgency = Math.min(...g.orders.map(o=>({today:0,upcoming:1,delivered:2,"no-date":3})[o.ds]??3));
          const urgencyDsMap=["today","upcoming","delivered","no-date"];
          const borderColor = statusColor(urgencyDsMap[urgency]||"no-date");
          return <Card key={g.client} style={{ borderLeft:`3px solid ${borderColor}` }}>
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

/* ─── Login Screen ─── */
function LoginScreen() {
  const [loading, setLoading] = useState(false);

  const signInWithGoogle = () => {
    window.location.href = "https://possible-peacock-8.accounts.dev/sign-in?redirect_url=" + encodeURIComponent(window.location.origin);
  };

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:T.font }}>
      <div style={{ textAlign:"center", padding:40 }}>
        <div style={{ fontSize:32, fontWeight:700, color:T.text, marginBottom:8, letterSpacing:"-0.5px" }}>
          Sales<span style={{ color:T.gold }}>Desk</span>
        </div>
        <div style={{ fontSize:13, color:T.muted, marginBottom:40 }}>AI-Powered Sales File Manager</div>
        <button onClick={signInWithGoogle} disabled={loading}
          style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 28px", borderRadius:12,
            background:"white", border:"none", cursor:loading?"not-allowed":"pointer", fontSize:15,
            fontWeight:600, color:"#333", fontFamily:T.font, opacity:loading?0.7:1, margin:"0 auto",
            boxShadow:"0 2px 12px rgba(0,0,0,0.3)" }}>
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.7 33.3 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-8 20-20 0-1.3-.1-2.7-.4-4z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.2-5.2C29.5 35.5 26.9 36 24 36c-5.2 0-9.7-2.7-11.3-7.1l-6.6 5.1C9.5 39.6 16.3 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.2 5.2C41 35.2 44 30 44 24c0-1.3-.1-2.7-.4-4z"/>
          </svg>
          {loading ? "Signing in…" : "Sign in with Google"}
        </button>
      </div>
    </div>
  );
}

/* ─── Main App ─── */
const TABS = ["Upload","All Orders","Weekly","Monthly","Yearly","Clients","Deliveries","Cancelled"];

export default function SalesDesk() {
  const [user, setUser]               = useState(undefined); // undefined = loading
  const [token, setToken]             = useState(null);
  const [orders, setOrders]           = useState([]);
  const [tab, setTab]                 = useState("Upload");
  const [uploadFiles, setUploadFiles] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [isAdmin, setIsAdmin]         = useState(false);
  const [employees, setEmployees]     = useState([]);
  const [viewingUser, setViewingUser] = useState(null);

  // Init Clerk auth
  useEffect(() => {
    const init = async () => {
      try {
        const clerk = await getClerk();
        const update = async () => {
          const u = clerk.user;
          setUser(u || null);
          if (u) {
            try {
              const t = await clerk.session.getToken();
              setToken(t);
            } catch {}
          } else {
            setToken(null);
          }
        };
        update();
        clerk.addListener(update);
      } catch(err) {
        console.error("Clerk init error:", err);
        setUser(null); // show login screen on error
      }
    };
    init();
  }, []);

  const authFetch = useCallback((url, opts = {}) => {
    return fetch(url, {
      ...opts,
      headers: { "Content-Type":"application/json", "Authorization":`Bearer ${token}`, ...(opts.headers||{}) }
    });
  }, [token]);

  // Check admin status
  useEffect(() => {
    if (!token) return;
    authFetch("/api/me")
      .then(r => r.json())
      .then(d => setIsAdmin(d.isAdmin || false))
      .catch(() => {});
  }, [token]);

  // Load employees (admin only)
  useEffect(() => {
    if (!isAdmin || !token) return;
    authFetch("/api/orders", { method:"PUT" })
      .then(r => r.json())
      .then(d => setEmployees(d.users || []))
      .catch(() => {});
  }, [isAdmin, token]);

  // Load orders when user or viewingUser changes
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const url = isAdmin && viewingUser ? `/api/orders?userId=${viewingUser.id}` : "/api/orders";
    authFetch(url)
      .then(r => r.json())
      .then(d => setOrders(Array.isArray(d.orders) ? d.orders : []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [token, viewingUser]);

  // Save orders
  useEffect(() => {
    if (loading || !token) return;
    const body = isAdmin && viewingUser ? { orders, userId: viewingUser.id } : { orders };
    authFetch("/api/orders", { method:"POST", body: JSON.stringify(body) }).catch(() => {});
  }, [orders, loading, token]);

  const addOrder     = useCallback(o  => setOrders(prev=>[...prev, o]), []);
  const deleteOrder  = useCallback(id => setOrders(prev=>prev.filter(o=>o.id!==id)), []);
  const cancelOrder  = useCallback(id => setOrders(prev=>prev.map(o=>o.id===id ? {...o,cancelled:true}  : o)), []);
  const restoreOrder = useCallback(id => setOrders(prev=>prev.map(o=>o.id===id ? {...o,cancelled:false} : o)), []);

  const activeOrders    = useMemo(()=>orders.filter(o=>!o.cancelled),  [orders]);
  const cancelledOrders = useMemo(()=>orders.filter(o=>o.cancelled),   [orders]);

  const signOut = async () => {
    const clerk = await getClerk();
    await clerk.signOut();
  };

  // Auth loading
  if (user === undefined) return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:T.font }}>
      <div style={{ fontSize:13, color:T.muted }}>Loading…</div>
    </div>
  );

  if (!user) return <LoginScreen/>;

  if (loading) return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:T.font }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:24, fontWeight:700, color:T.text, marginBottom:8 }}>Sales<span style={{ color:T.gold }}>Desk</span></div>
        <div style={{ fontSize:13, color:T.muted }}>Loading orders…</div>
      </div>
    </div>
  );

  const displayName = viewingUser?.name || user.firstName || user.emailAddresses?.[0]?.emailAddress || "You";

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
          {isAdmin && (
            <select value={viewingUser?.id || ""}
              onChange={e => {
                const emp = employees.find(u => u.id === e.target.value);
                setViewingUser(emp || null);
                setOrders([]);
                setTab("Upload");
              }}
              style={{ padding:"6px 12px", borderRadius:8, border:`1px solid ${T.border}`,
                background:T.card, color:T.text, fontSize:13, fontFamily:T.font, cursor:"pointer" }}>
              <option value="">👤 My Orders</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          )}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {user.imageUrl && <img src={user.imageUrl} style={{ width:28, height:28, borderRadius:"50%", border:`1px solid ${T.border}` }} />}
            <span style={{ fontSize:12, color:T.muted }}>{displayName}</span>
          </div>
          <button onClick={signOut}
            style={{ padding:"6px 14px", borderRadius:8, border:`1px solid ${T.border}`,
              background:"none", color:T.muted, cursor:"pointer", fontSize:12, fontFamily:T.font }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Stats */}
      <StatsBar orders={orders} activeOrders={activeOrders}/>

      {/* Tab Switcher */}
      <div style={{ display:"flex", gap:6, marginBottom:24, flexWrap:"wrap" }}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            style={{ padding:"8px 18px", borderRadius:20, border:`1px solid ${tab===t ? T.gold : T.border}`, background: tab===t ? `${T.gold}20` : T.card, color: tab===t ? T.gold : T.muted, cursor:"pointer", fontFamily:T.font, fontSize:13, fontWeight:tab===t?600:400, transition:"all .15s" }}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab==="Upload"     && <UploadTab onOrdersAdded={addOrder} files={uploadFiles} setFiles={setUploadFiles}/>}
      {tab==="All Orders" && <AllOrdersTab orders={activeOrders} onDelete={deleteOrder}/>}
      {tab==="Weekly"     && <PeriodTab orders={orders} mode="weekly"/>}
      {tab==="Monthly"    && <PeriodTab orders={orders} mode="monthly"/>}
      {tab==="Yearly"     && <PeriodTab orders={orders} mode="yearly"/>}
      {tab==="Clients"    && <ClientsTab orders={activeOrders}/>}
      {tab==="Deliveries" && <DeliveriesTab orders={activeOrders} onCancel={cancelOrder}/>}
      {tab==="Cancelled"  && <CancelledTab orders={cancelledOrders} onRestore={restoreOrder} onDelete={deleteOrder}/>}
    </div>
  );
}
