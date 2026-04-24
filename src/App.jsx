import { useState, useEffect, useRef, useCallback } from 'react';
import { useT } from './i18n.js';
import { PRODUCTS, CATEGORIES } from './products.js';

// ââ Constants ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const TPS = 0.05;
const TVQ = 0.09975;
const COMMISSION_RATE = 0.09;
const APP_URL = window.location.origin;
const API = (path) => `${APP_URL}/api/${path}`;

// ââ Helpers ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function calcTotals(items) {
  const subtotal = items.reduce((s, i) => s + (i.price * (i.qty || 1)), 0);
  const tps = subtotal * TPS;
  const tvq = subtotal * TVQ;
  return { subtotal, tps, tvq, total: subtotal + tps + tvq };
}
function fmt$(n) { return n != null ? `${Number(n).toFixed(2)} $` : 'â'; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('fr-CA') : 'â'; }
function statusColor(s) {
  return { draft:'#888', confirmed:'#2563eb', delivered:'#16a34a', cancelled:'#dc2626' }[s] || '#888';
}
function statusLabel(s, t) {
  return { draft: t('statusDraft'), confirmed: t('statusConfirmed'), delivered: t('statusDelivered'), cancelled: t('statusCancelled') }[s] || s;
}

// ââ Styles âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const S = {
  app: { fontFamily:"'DM Sans', sans-serif", background:'#f8f8f8', minHeight:'100vh', color:'#1a1a1a' },
  header: { background:'#C41E1E', color:'#fff', padding:'0 20px', display:'flex', alignItems:'center', justifyContent:'space-between', height:56, boxShadow:'0 2px 8px rgba(0,0,0,.18)', position:'sticky', top:0, zIndex:100 },
  logo: { fontWeight:800, fontSize:18, letterSpacing:'-0.5px', display:'flex', alignItems:'center', gap:8 },
  main: { maxWidth:900, margin:'0 auto', padding:'24px 16px', },
  card: { background:'#fff', borderRadius:10, boxShadow:'0 1px 4px rgba(0,0,0,.09)', padding:24, marginBottom:20 },
  btn: (variant='primary') => ({
    padding:'9px 20px', borderRadius:7, border:'none', cursor:'pointer', fontWeight:600, fontSize:14, fontFamily:"'DM Sans',sans-serif",
    background: variant==='primary'?'#C41E1E': variant==='ghost'?'transparent': variant==='danger'?'#dc2626':'#f0f0f0',
    color: variant==='primary'||variant==='danger'?'#fff': '#333',
    border: variant==='ghost'?'1.5px solid #ddd':'none',
    transition:'opacity .15s', opacity:1,
  }),
  input: { width:'100%', padding:'9px 12px', borderRadius:7, border:'1.5px solid #e0e0e0', fontSize:14, fontFamily:"'DM Sans',sans-serif", background:'#fafafa', boxSizing:'border-box', outline:'none' },
  select: { width:'100%', padding:'9px 12px', borderRadius:7, border:'1.5px solid #e0e0e0', fontSize:14, fontFamily:"'DM Sans',sans-serif", background:'#fafafa', boxSizing:'border-box' },
  label: { fontSize:13, fontWeight:600, color:'#555', marginBottom:4, display:'block' },
  row: { display:'flex', gap:16, flexWrap:'wrap' },
  col: (flex=1) => ({ flex, minWidth:160 }),
  badge: (color) => ({ background:color+'22', color, borderRadius:99, padding:'2px 10px', fontSize:12, fontWeight:700, display:'inline-block' }),
  sectionTitle: { fontSize:17, fontWeight:800, marginBottom:14, color:'#C41E1E', letterSpacing:'-0.3px' },
  table: { width:'100%', borderCollapse:'collapse', fontSize:14 },
  th: { textAlign:'left', padding:'8px 10px', borderBottom:'2px solid #eee', fontWeight:700, color:'#555', fontSize:13 },
  td: { padding:'9px 10px', borderBottom:'1px solid #f0f0f0' },
  toast: { position:'fixed', bottom:24, right:24, background:'#222', color:'#fff', borderRadius:8, padding:'12px 20px', fontSize:14, fontWeight:600, zIndex:999, boxShadow:'0 4px 20px rgba(0,0,0,.3)', maxWidth:320 },
  modal: { position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:500, display:'flex', alignItems:'center', justifyContent:'center', padding:16 },
  modalBox: { background:'#fff', borderRadius:12, padding:28, maxWidth:480, width:'100%', boxShadow:'0 8px 40px rgba(0,0,0,.2)' },
  navBtn: (active) => ({ padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer', fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight: active?700:500, background: active?'rgba(255,255,255,.2)':'transparent', color:'#fff' }),
  signCanvas: { border:'1.5px solid #e0e0e0', borderRadius:8, touchAction:'none', width:'100%', height:180, background:'#fff' },
};

// ââ Toast ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function Toast({ msg, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return <div style={S.toast}>{msg}</div>;
}

// ââ Signature Pad âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function SignaturePad({ onSave, onClear, existingData, readOnly }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    if (existingData && canvasRef.current) {
      const img = new Image();
      img.onload = () => { const ctx = canvasRef.current?.getContext('2d'); if (ctx) { ctx.clearRect(0,0,canvasRef.current.width,canvasRef.current.height); ctx.drawImage(img,0,0); } };
      img.src = existingData;
      setHasDrawn(true);
    }
  }, [existingData]);

  function getPos(e, canvas) {
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width, scaleY = canvas.height / r.height;
    const src = e.touches ? e.touches[0] : e;
    return { x:(src.clientX - r.left)*scaleX, y:(src.clientY - r.top)*scaleY };
  }

  function onDown(e) {
    if (readOnly) return;
    e.preventDefault();
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    drawing.current = true;
    const p = getPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
  }
  function onMove(e) {
    if (!drawing.current || readOnly) return;
    e.preventDefault();
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.strokeStyle='#1a1a1a';
    const p = getPos(e, canvas);
    ctx.lineTo(p.x, p.y); ctx.stroke();
    setHasDrawn(true);
  }
  function onUp() { drawing.current = false; }
  function clear() { const ctx=canvasRef.current?.getContext('2d'); if(ctx&&canvasRef.current){ctx.clearRect(0,0,canvasRef.current.width,canvasRef.current.height);} setHasDrawn(false); onClear?.(); }
  function save() { if (canvasRef.current) onSave?.(canvasRef.current.toDataURL()); }

  return (
    <div>
      <canvas ref={canvasRef} width={560} height={180} style={S.signCanvas}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp} />
      {!readOnly && (
        <div style={{display:'flex',gap:8,marginTop:8}}>
          <button style={S.btn('ghost')} onClick={clear}>Effacer</button>
          {hasDrawn && <button style={S.btn()} onClick={save}>Enregistrer</button>}
        </div>
      )}
    </div>
  );
}

// ââ useAPI ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function useAPI() {
  const token = () => localStorage.getItem('ap_token') || '';
  const headers = () => ({ 'Authorization':`Bearer ${token()}`, 'Content-Type':'application/json' });
  return {
    get: (path) => fetch(API(path), { headers: headers() }).then(r => r.json()),
    post: (path, body) => fetch(API(path), { method:'POST', headers: headers(), body: JSON.stringify(body) }).then(r => r.json()),
    put: (path, body) => fetch(API(path), { method:'PUT', headers: headers(), body: JSON.stringify(body) }).then(r => r.json()),
    patch: (path, body) => fetch(API(path), { method:'PATCH', headers: headers(), body: JSON.stringify(body) }).then(r => r.json()),
  };
}

// ââ ProductPicker âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function ProductPicker({ items, onChange, t }) {
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const [showing, setShowing] = useState(false);

  const filtered = PRODUCTS.filter(p =>
    (!cat || p.category === cat) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase()))
  );

  function addProduct(p) {
    const exists = items.find(i => i.code === p.code);
    if (exists) onChange(items.map(i => i.code === p.code ? {...i, qty: i.qty+1} : i));
    else onChange([...items, { ...p, qty: 1 }]);
    setShowing(false); setSearch('');
  }
  function remove(code) { onChange(items.filter(i => i.code !== code)); }
  function setQty(code, qty) { if(qty<1)return; onChange(items.map(i=>i.code===code?{...i,qty}:i)); }

  return (
    <div>
      <button style={{...S.btn('ghost'),marginBottom:12}} onClick={()=>setShowing(!showing)}>+ {t('addProduct')}</button>
      {showing && (
        <div style={{border:'1.5px solid #eee',borderRadius:8,padding:12,marginBottom:12,background:'#fafafa'}}>
          <div style={S.row}>
            <select style={{...S.select,flex:1}} value={cat} onChange={e=>setCat(e.target.value)}>
              <option value="">{t('all')} ({t('category')})</option>
              {CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            <input style={{...S.input,flex:2}} placeholder={t('search')} value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <div style={{maxHeight:260,overflowY:'auto',marginTop:8}}>
            {filtered.slice(0,80).map(p=>(
              <div key={p.code} onClick={()=>addProduct(p)} style={{padding:'8px 10px',borderBottom:'1px solid #eee',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',borderRadius:6,transition:'background .1s'}}
                onMouseOver={e=>e.currentTarget.style.background='#fff3f3'}
                onMouseOut={e=>e.currentTarget.style.background='transparent'}>
                <div>
                  <div style={{fontWeight:600,fontSize:13}}>{p.name}</div>
                  <div style={{fontSize:11,color:'#888'}}>{p.format} Â· {p.origin} Â· #{p.code}</div>
                </div>
                <div style={{fontWeight:700,color:'#C41E1E',whiteSpace:'nowrap'}}>{fmt$(p.price)}</div>
              </div>
            ))}
            {filtered.length === 0 && <div style={{color:'#aaa',padding:12}}>{t('noResults')}</div>}
          </div>
        </div>
      )}
      {items.length > 0 && (
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>{t('products')}</th>
            <th style={S.th}>{t('format')}</th>
            <th style={S.th}>{t('unitPrice')}</th>
            <th style={S.th}>{t('quantity')}</th>
            <th style={S.th}>{t('lineTotal')}</th>
            <th style={S.th}></th>
          </tr></thead>
          <tbody>
            {items.map(i=>(
              <tr key={i.code}>
                <td style={S.td}><div style={{fontWeight:600}}>{i.name}</div><div style={{fontSize:11,color:'#999'}}>#{i.code}</div></td>
                <td style={S.td}>{i.format}</td>
                <td style={S.td}>{fmt$(i.price)}</td>
                <td style={S.td}><input type="number" min={1} value={i.qty} onChange={e=>setQty(i.code,parseInt(e.target.value)||1)} style={{...S.input,width:60}} /></td>
                <td style={S.td} style={{fontWeight:700}}>{fmt$(i.price*i.qty)}</td>
                <td style={S.td}><button style={S.btn('danger')} onClick={()=>remove(i.code)}>â</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ââ DeliveryDatePicker ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function DeliveryDatePicker({ dates, onChange, t, api }) {
  const [slots, setSlots] = useState({});

  useEffect(() => {
    const ds = dates.map(d=>d.date).filter(Boolean);
    if (!ds.length) return;
    api.get(`delivery?dates=${ds.join(',')}`).then(r=>{ if(!r.error) setSlots(r); }).catch(()=>{});
  }, [JSON.stringify(dates)]);

  function addDate() { onChange([...dates, { date:'', slot:'morning' }]); }
  function removeDate(i) { onChange(dates.filter((_,idx)=>idx!==i)); }
  function update(i, field, val) { onChange(dates.map((d,idx)=>idx===i?{...d,[field]:val}:d)); }

  const slotLabel = { morning:t('morning'), afternoon:t('afternoon'), evening:t('evening') };

  return (
    <div>
      {dates.map((d,i)=>(
        <div key={i} style={{...S.card,padding:14,marginBottom:10,display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap'}}>
          <div style={S.col()}>
            <label style={S.label}>{t('deliveryDate')} {i+1}</label>
            <input type="date" style={S.input} value={d.date} onChange={e=>update(i,'date',e.target.value)} min={new Date().toISOString().slice(0,10)} />
          </div>
          <div style={S.col()}>
            <label style={S.label}>{t('timeSlot')}</label>
            <select style={S.select} value={d.slot} onChange={e=>update(i,'slot',e.target.value)}>
              {['morning','afternoon','evening'].map(s=>{
                const info = slots[`${d.date}:${s}`];
                const rem = info?.remaining ?? 'â';
                const full = info?.remaining === 0;
                return <option key={s} value={s} disabled={full}>{slotLabel[s]} â {full ? t('slotFull') : `${rem} ${t('slotsRemaining')}`}</option>;
              })}
            </select>
          </div>
          <button style={S.btn('danger')} onClick={()=>removeDate(i)}>â</button>
        </div>
      ))}
      {dates.length < 4 && <button style={S.btn('ghost')} onClick={addDate}>+ {t('addDeliveryDate')}</button>}
    </div>
  );
}

// ââ OrderForm âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function OrderForm({ t, api, me, onSaved, onCancel, existing }) {
  const blank = { client1:{name:'',phone:'',email:''}, client2:{name:'',phone:'',email:''}, address:'', city:'', postalCode:'', repName:`${me.firstName} ${me.lastName}`.trim(), repOfficePhone:'', repEmail:me.email, referredBy:'', items:[], deliveryDates:[], paymentMethod:'cash', notes:'' };
  const [form, setForm] = useState(existing ? { ...blank, ...existing } : blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [clientSigMode, setClientSigMode] = useState('inperson'); // inperson|remote|docusign
  const [repSig, setRepSig] = useState(me.savedSignature || null);
  const [clientSig, setClientSig] = useState(existing?.signatures?.client?.data || null);

  const totals = calcTotals(form.items);

  function setField(path, val) {
    setForm(prev => {
      const next = { ...prev };
      const parts = path.split('.');
      let obj = next;
      for (let i=0; i<parts.length-1; i++) { obj[parts[i]] = {...obj[parts[i]]}; obj = obj[parts[i]]; }
      obj[parts[parts.length-1]] = val;
      return next;
    });
  }

  async function save(status = 'draft') {
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        status,
        totals,
        signatures: { rep: repSig ? { data: repSig } : null, client: clientSig ? { data: clientSig } : null },
        clientSignatureMode: clientSigMode,
      };
      let order;
      if (existing?.id) {
        order = await api.put(`orders?id=${existing.id}`, payload);
      } else {
        order = await api.post('orders', payload);
      }
      if (order.error) { setError(order.error); return; }

      // If both signed â send invite/confirmation email
      if (repSig && (clientSig || clientSigMode === 'docusign') && order.id) {
        const firstDate = form.deliveryDates[0];
        await api.post('invite', {
          orderId: order.id,
          clientEmail: form.client1.email,
          clientName: form.client1.name,
          orderTotal: totals.total,
          firstDeliveryDate: firstDate ? `${firstDate.date} (${t(firstDate.slot)})` : '',
        });
      }

      onSaved(order);
    } catch(e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <h2 style={S.sectionTitle}>{existing ? t('editOrder') : t('newOrder')}</h2>

      {/* Clients */}
      <div style={S.card}>
        <div style={S.sectionTitle}>{t('client1')}</div>
        <div style={S.row}>
          <div style={S.col()}><label style={S.label}>{t('clientName')}</label><input style={S.input} value={form.client1.name} onChange={e=>setField('client1.name',e.target.value)} /></div>
          <div style={S.col()}><label style={S.label}>{t('clientPhone')}</label><input style={S.input} value={form.client1.phone} onChange={e=>setField('client1.phone',e.target.value)} /></div>
          <div style={S.col()}><label style={S.label}>{t('clientEmail')}</label><input type="email" style={S.input} value={form.client1.email} onChange={e=>setField('client1.email',e.target.value)} /></div>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.sectionTitle}>{t('client2')}</div>
        <div style={S.row}>
          <div style={S.col()}><label style={S.label}>{t('clientName')}</label><input style={S.input} value={form.client2.name} onChange={e=>setField('client2.name',e.target.value)} placeholder={t('optional')} /></div>
          <div style={S.col()}><label style={S.label}>{t('clientPhone')}</label><input style={S.input} value={form.client2.phone} onChange={e=>setField('client2.phone',e.target.value)} /></div>
          <div style={S.col()}><label style={S.label}>{t('clientEmail')}</label><input type="email" style={S.input} value={form.client2.email} onChange={e=>setField('client2.email',e.target.value)} /></div>
        </div>
      </div>

      {/* Address */}
      <div style={S.card}>
        <div style={S.sectionTitle}>{t('address')}</div>
        <div style={S.row}>
          <div style={{flex:3}}><label style={S.label}>{t('address')}</label><input style={S.input} value={form.address} onChange={e=>setField('address',e.target.value)} /></div>
          <div style={S.col()}><label style={S.label}>{t('city')}</label><input style={S.input} value={form.city} onChange={e=>setField('city',e.target.value)} /></div>
          <div style={{flex:0.7}}><label style={S.label}>{t('postalCode')}</label><input style={S.input} value={form.postalCode} onChange={e=>setField('postalCode',e.target.value)} /></div>
        </div>
      </div>

      {/* Rep info */}
      <div style={S.card}>
        <div style={S.sectionTitle}>{t('repName')}</div>
        <div style={S.row}>
          <div style={S.col()}><label style={S.label}>{t('repName')}</label><input style={S.input} value={form.repName} onChange={e=>setField('repName',e.target.value)} /></div>
          <div style={S.col()}><label style={S.label}>{t('repOfficePhone')}</label><input style={S.input} value={form.repOfficePhone} onChange={e=>setField('repOfficePhone',e.target.value)} /></div>
          <div style={S.col()}><label style={S.label}>{t('repEmail')}</label><input type="email" style={S.input} value={form.repEmail} onChange={e=>setField('repEmail',e.target.value)} /></div>
          <div style={S.col()}><label style={S.label}>{t('referredBy')}</label><input style={S.input} value={form.referredBy} onChange={e=>setField('referredBy',e.target.value)} /></div>
        </div>
      </div>

      {/* Products */}
      <div style={S.card}>
        <div style={S.sectionTitle}>{t('products')}</div>
        <ProductPicker items={form.items} onChange={items=>setField('items',items)} t={t} />
        {form.items.length > 0 && (
          <div style={{marginTop:16,borderTop:'2px solid #eee',paddingTop:14,textAlign:'right'}}>
            <div style={{marginBottom:4,color:'#555'}}>{t('subtotal')}: <strong>{fmt$(totals.subtotal)}</strong></div>
            <div style={{marginBottom:4,color:'#555'}}>{t('tps')}: <strong>{fmt$(totals.tps)}</strong></div>
            <div style={{marginBottom:8,color:'#555'}}>{t('tvq')}: <strong>{fmt$(totals.tvq)}</strong></div>
            <div style={{fontSize:18,fontWeight:800,color:'#C41E1E'}}>{t('totalTaxes')}: {fmt$(totals.total)}</div>
          </div>
        )}
      </div>

      {/* Delivery dates */}
      <div style={S.card}>
        <div style={S.sectionTitle}>{t('deliveryDates')}</div>
        <DeliveryDatePicker dates={form.deliveryDates} onChange={v=>setField('deliveryDates',v)} t={t} api={api} />
      </div>

      {/* Payment */}
      <div style={S.card}>
        <div style={S.sectionTitle}>{t('paymentMethod')}</div>
        <div style={S.row}>
          {['cash','lendcare'].map(m=>(
            <label key={m} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'10px 16px',borderRadius:8,border:`2px solid ${form.paymentMethod===m?'#C41E1E':'#eee'}`,flex:1}}>
              <input type="radio" name="payment" value={m} checked={form.paymentMethod===m} onChange={()=>setField('paymentMethod',m)} />
              {m==='cash'?t('cashDoor'):t('lendcare')}
            </label>
          ))}
        </div>
      </div>

      {/* Signatures */}
      <div style={S.card}>
        <div style={S.sectionTitle}>{t('signatures')}</div>
        <div style={S.row}>
          {/* Rep signature */}
          <div style={S.col()}>
            <label style={S.label}>{t('repSignature')}</label>
            {repSig
              ? <div><img src={repSig} style={{width:'100%',maxHeight:150,objectFit:'contain',border:'1.5px solid #eee',borderRadius:8}} /><button style={{...S.btn('ghost'),marginTop:8,fontSize:12}} onClick={()=>setRepSig(null)}>Changer</button></div>
              : <SignaturePad onSave={setRepSig} onClear={()=>setRepSig(null)} />
            }
          </div>
          {/* Client signature */}
          <div style={S.col()}>
            <label style={S.label}>{t('clientSignature')}</label>
            <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
              {['inperson','remote','docusign'].map(m=>(
                <button key={m} style={{...S.btn(clientSigMode===m?'primary':'ghost'),fontSize:12,padding:'5px 10px'}} onClick={()=>setClientSigMode(m)}>
                  {m==='inperson'?t('signInPerson'):m==='remote'?t('signRemote'):t('signDocuSign')}
                </button>
              ))}
            </div>
            {clientSigMode==='inperson' && <SignaturePad onSave={setClientSig} onClear={()=>setClientSig(null)} existingData={clientSig} />}
            {clientSigMode==='remote' && <div style={{color:'#555',fontSize:13,padding:'12px 0'}}>{t('sendSignatureEmail')} â {t('signatureLinkSent')}</div>}
            {clientSigMode==='docusign' && <div style={{...S.badge('#2563eb'),fontSize:13,padding:'8px 14px'}}>{t('docuSignSent')}</div>}
          </div>
        </div>
        <div style={{marginTop:10,fontSize:13,color: repSig && (clientSig||clientSigMode==='docusign') ? '#16a34a':'#888'}}>
          {repSig && (clientSig||clientSigMode==='docusign') ? 'â '+t('bothSigned') : t('awaitingClientSign')}
        </div>
      </div>

      {error && <div style={{color:'#dc2626',marginBottom:12}}>{error}</div>}
      <div style={{display:'flex',gap:12,justifyContent:'flex-end',flexWrap:'wrap'}}>
        <button style={S.btn('ghost')} onClick={onCancel} disabled={saving}>{t('cancel')}</button>
        <button style={S.btn('ghost')} onClick={()=>save('draft')} disabled={saving}>{saving?t('loading'):t('statusDraft')}</button>
        <button style={S.btn()} onClick={()=>save('confirmed')} disabled={saving}>{saving?t('loading'):t('confirm')}</button>
      </div>
    </div>
  );
}

// ââ OrderDetail âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function OrderDetail({ order, t, me, api, onBack, onUpdated }) {
  const [loading, setLoading] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [dateModal, setDateModal] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [toast, setToast] = useState('');

  async function doAction(action, extra={}) {
    setLoading(true);
    const res = await api.patch(`orders?id=${order.id}`, { action, ...extra });
    setLoading(false);
    if (!res.error) { onUpdated(res); setToast(action==='markDelivered'?t('markDelivered'):'OK'); }
  }

  const { subtotal, tps, tvq, total } = order.totals || calcTotals(order.items||[]);

  return (
    <div>
      <button style={{...S.btn('ghost'),marginBottom:16}} onClick={onBack}>â {t('back')}</button>
      <div style={S.card}>
        <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:8,marginBottom:16}}>
          <div>
            <div style={{fontWeight:800,fontSize:20}}>#{order.id}</div>
            <div style={{color:'#888',fontSize:13}}>{fmtDate(order.createdAt)}</div>
          </div>
          <span style={S.badge(statusColor(order.status))}>{statusLabel(order.status,t)}</span>
        </div>

        {/* Clients */}
        <div style={S.row}>
          <div style={S.col()}><strong>{t('client1')}</strong><br/>{order.client1?.name}<br/>{order.client1?.phone}<br/>{order.client1?.email}</div>
          {order.client2?.name && <div style={S.col()}><strong>{t('client2')}</strong><br/>{order.client2.name}<br/>{order.client2.phone}</div>}
          <div style={S.col()}><strong>{t('address')}</strong><br/>{order.address}<br/>{order.city} {order.postalCode}</div>
          <div style={S.col()}><strong>{t('repName')}</strong><br/>{order.repName}<br/>{order.repEmail}</div>
        </div>

        {/* Products */}
        <div style={{marginTop:20}}>
          <div style={S.sectionTitle}>{t('products')}</div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>{t('products')}</th><th style={S.th}>{t('format')}</th><th style={S.th}>{t('quantity')}</th><th style={S.th}>{t('unitPrice')}</th><th style={S.th}>{t('lineTotal')}</th></tr></thead>
            <tbody>{(order.items||[]).map(i=><tr key={i.code}><td style={S.td}>{i.name}</td><td style={S.td}>{i.format}</td><td style={S.td}>{i.qty}</td><td style={S.td}>{fmt$(i.price)}</td><td style={S.td}><strong>{fmt$(i.price*i.qty)}</strong></td></tr>)}</tbody>
          </table>
          <div style={{textAlign:'right',marginTop:12}}>
            <div style={{color:'#555'}}>{t('subtotal')}: {fmt$(subtotal)}</div>
            <div style={{color:'#555'}}>{t('tps')}: {fmt$(tps)}</div>
            <div style={{color:'#555'}}>{t('tvq')}: {fmt$(tvq)}</div>
            <div style={{fontSize:17,fontWeight:800,color:'#C41E1E'}}>{t('totalTaxes')}: {fmt$(total)}</div>
          </div>
        </div>

        {/* Delivery dates */}
        {order.deliveryDates?.length > 0 && (
          <div style={{marginTop:16}}>
            <div style={S.sectionTitle}>{t('deliveryDates')}</div>
            {order.deliveryDates.map((d,i)=><div key={i} style={{padding:'6px 0',borderBottom:'1px solid #f0f0f0'}}>{d.date} â {t(d.slot)}</div>)}
          </div>
        )}

        {/* Payment */}
        <div style={{marginTop:12}}><strong>{t('paymentMethod')}:</strong> {order.paymentMethod==='lendcare'?t('lendcare'):t('cashDoor')}</div>

        {/* Signatures */}
        {(order.signatures?.rep || order.signatures?.client) && (
          <div style={{marginTop:16}}>
            <div style={S.sectionTitle}>{t('signatures')}</div>
            <div style={S.row}>
              {order.signatures.rep?.data && <div style={S.col()}><label style={S.label}>{t('repSignature')}</label><img src={order.signatures.rep.data} style={{width:'100%',maxHeight:100,objectFit:'contain',border:'1px solid #eee',borderRadius:6}} /></div>}
              {order.signatures.client?.data && <div style={S.col()}><label style={S.label}>{t('clientSignature')}</label><img src={order.signatures.client.data} style={{width:'100%',maxHeight:100,objectFit:'contain',border:'1px solid #eee',borderRadius:6}} /></div>}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{display:'flex',gap:10,marginTop:20,flexWrap:'wrap'}}>
          {me.role==='delivery' && order.status==='confirmed' && <button style={S.btn()} onClick={()=>doAction('markDelivered')} disabled={loading}>{t('markAsDelivered')}</button>}
          {['client_service','manager'].includes(me.role) && order.status==='confirmed' && <button style={S.btn()} onClick={()=>doAction('markDelivered')} disabled={loading}>{t('markAsDelivered')}</button>}
          {['rep','client_service','manager'].includes(me.role) && order.status!=='cancelled' && order.status!=='delivered' && <button style={S.btn('danger')} onClick={()=>setCancelModal(true)} disabled={loading}>{t('cancelOrder')}</button>}
          {me.role==='client' && order.status==='confirmed' && <button style={S.btn('ghost')} onClick={()=>setDateModal(true)}>{t('requestDateChange')}</button>}
        </div>
      </div>

      {/* Cancel modal */}
      {cancelModal && (
        <div style={S.modal} onClick={()=>setCancelModal(false)}>
          <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
            <h3 style={{marginTop:0}}>{t('confirmCancel')}</h3>
            <label style={S.label}>{t('cancelReason')}</label>
            <input style={S.input} value={cancelReason} onChange={e=>setCancelReason(e.target.value)} />
            <div style={{display:'flex',gap:10,marginTop:16,justifyContent:'flex-end'}}>
              <button style={S.btn('ghost')} onClick={()=>setCancelModal(false)}>{t('cancel')}</button>
              <button style={S.btn('danger')} onClick={()=>{doAction('cancel',{reason:cancelReason});setCancelModal(false);}}>{t('confirm')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Date change modal */}
      {dateModal && (
        <div style={S.modal} onClick={()=>setDateModal(false)}>
          <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
            <h3 style={{marginTop:0}}>{t('dateChangeRequest')}</h3>
            <label style={S.label}>{t('preferredNewDate')}</label>
            <input type="date" style={S.input} value={newDate} onChange={e=>setNewDate(e.target.value)} />
            <div style={{display:'flex',gap:10,marginTop:16,justifyContent:'flex-end'}}>
              <button style={S.btn('ghost')} onClick={()=>setDateModal(false)}>{t('cancel')}</button>
              <button style={S.btn()} onClick={()=>{doAction('requestDateChange',{newDate});setDateModal(false);setToast(t('dateChangeSubmitted'));}}>{t('submit')}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast msg={toast} onClose={()=>setToast('')} />}
    </div>
  );
}

// ââ OrdersList ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function OrdersList({ t, api, me, onSelectOrder, onNewOrder }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(()=>{
    api.get('orders').then(r=>{ if(Array.isArray(r)) setOrders(r); setLoading(false); }).catch(()=>setLoading(false));
  },[]);

  const filtered = orders.filter(o => filter==='all' || o.status===filter);

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <h2 style={{margin:0,fontWeight:800}}>{me.role==='rep'?t('myOrders'):t('allOrders')}</h2>
        {['rep','client_service','manager'].includes(me.role) && <button style={S.btn()} onClick={onNewOrder}>+ {t('newOrder')}</button>}
      </div>

      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        {['all','draft','confirmed','delivered','cancelled'].map(s=>(
          <button key={s} style={{...S.btn(filter===s?'primary':'ghost'),padding:'6px 14px'}} onClick={()=>setFilter(s)}>
            {s==='all'?t('all'):statusLabel(s,t)} ({orders.filter(o=>s==='all'||o.status===s).length})
          </button>
        ))}
      </div>

      {loading && <div style={{color:'#aaa',padding:24}}>{t('loading')}</div>}
      {!loading && filtered.length===0 && <div style={{color:'#aaa',padding:24}}>{t('noResults')}</div>}

      {filtered.map(o=>(
        <div key={o.id} style={{...S.card,cursor:'pointer',transition:'box-shadow .15s'}}
          onClick={()=>onSelectOrder(o)}
          onMouseOver={e=>e.currentTarget.style.boxShadow='0 3px 14px rgba(196,30,30,.12)'}
          onMouseOut={e=>e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,.09)'}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{fontWeight:700,fontSize:15}}>#{o.id}</div>
              <div style={{fontSize:13,color:'#777',marginTop:2}}>{o.client1?.name} Â· {o.city}</div>
              <div style={{fontSize:12,color:'#aaa',marginTop:2}}>{fmtDate(o.createdAt)} Â· {o.repName}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <span style={S.badge(statusColor(o.status))}>{statusLabel(o.status,t)}</span>
              <div style={{fontWeight:700,fontSize:15,marginTop:6,color:'#C41E1E'}}>{fmt$(o.totals?.total || calcTotals(o.items||[]).total)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ââ Dashboard âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function Dashboard({ t, api, me }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    api.get('orders').then(r=>{ if(Array.isArray(r)) setOrders(r); setLoading(false); }).catch(()=>setLoading(false));
  },[]);

  const delivered = orders.filter(o=>o.status==='delivered');
  const cancelled = orders.filter(o=>o.status==='cancelled');
  const confirmed = orders.filter(o=>o.status==='confirmed');

  const deliveredSales = delivered.reduce((s,o)=>s+(o.totals?.total||calcTotals(o.items||[]).total),0);
  const totalCommission = deliveredSales * COMMISSION_RATE;
  const cancelRate = orders.length ? ((cancelled.length/orders.length)*100).toFixed(1) : 0;

  // Group by rep for manager
  const byRep = {};
  orders.forEach(o=>{
    const k = o.repName || o.repEmail || 'Inconnu';
    if (!byRep[k]) byRep[k] = { name:k, orders:[], delivered:0, sales:0 };
    byRep[k].orders.push(o);
    if (o.status==='delivered') { byRep[k].delivered++; byRep[k].sales += o.totals?.total || 0; }
  });

  const statBox = (label, value, color='#C41E1E') => (
    <div style={{...S.card,flex:1,minWidth:140,textAlign:'center'}}>
      <div style={{fontSize:28,fontWeight:800,color}}>{value}</div>
      <div style={{fontSize:12,color:'#888',marginTop:4}}>{label}</div>
    </div>
  );

  if (loading) return <div style={{color:'#aaa',padding:24}}>{t('loading')}</div>;

  return (
    <div>
      <h2 style={{fontWeight:800,marginBottom:20}}>{t('dashboard')}</h2>
      <div style={S.row}>
        {statBox(t('ordersCount'), orders.length, '#2563eb')}
        {statBox(t('delivered'), delivered.length, '#16a34a')}
        {statBox(t('cancelled'), cancelled.length, '#dc2626')}
        {statBox(t('totalSales'), fmt$(deliveredSales))}
        {me.role==='rep' && statBox(t('totalCommission'), fmt$(totalCommission), '#d97706')}
        {me.role==='rep' && statBox(t('cancellationRate'), `${cancelRate}%`, '#dc2626')}
      </div>

      {me.role==='manager' && (
        <div style={S.card}>
          <div style={S.sectionTitle}>{t('teamPerformance')}</div>
          <table style={S.table}>
            <thead><tr>
              <th style={S.th}>{t('repName')}</th>
              <th style={S.th}>{t('ordersCount')}</th>
              <th style={S.th}>{t('delivered')}</th>
              <th style={S.th}>{t('totalSales')}</th>
              <th style={S.th}>{t('totalCommission')}</th>
            </tr></thead>
            <tbody>
              {Object.values(byRep).sort((a,b)=>b.sales-a.sales).map(rep=>(
                <tr key={rep.name}>
                  <td style={S.td}><strong>{rep.name}</strong></td>
                  <td style={S.td}>{rep.orders.length}</td>
                  <td style={S.td}>{rep.delivered}</td>
                  <td style={S.td}>{fmt$(rep.sales)}</td>
                  <td style={S.td} style={{color:'#d97706',fontWeight:700}}>{fmt$(rep.sales*COMMISSION_RATE)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ââ DeliveryView ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function DeliveryView({ t, api, onSelectOrder }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));

  useEffect(()=>{
    api.get('orders').then(r=>{ if(Array.isArray(r)) setOrders(r); setLoading(false); }).catch(()=>setLoading(false));
  },[]);

  const forDate = orders
    .filter(o=>o.status==='confirmed' && o.deliveryDates?.some(d=>d.date===date))
    .sort((a,b)=>{
      const slotOrder = {morning:0,afternoon:1,evening:2};
      const aSlot = a.deliveryDates.find(d=>d.date===date)?.slot||'morning';
      const bSlot = b.deliveryDates.find(d=>d.date===date)?.slot||'morning';
      return slotOrder[aSlot]-slotOrder[bSlot];
    });

  return (
    <div>
      <h2 style={{fontWeight:800,marginBottom:20}}>{t('deliverySchedule')}</h2>
      <div style={{marginBottom:16}}>
        <label style={S.label}>{t('date')}</label>
        <input type="date" style={{...S.input,maxWidth:200}} value={date} onChange={e=>setDate(e.target.value)} />
      </div>
      {loading && <div style={{color:'#aaa',padding:24}}>{t('loading')}</div>}
      {!loading && forDate.length===0 && <div style={{color:'#aaa',padding:24}}>{t('noResults')}</div>}
      {forDate.map(o=>{
        const slot = o.deliveryDates.find(d=>d.date===date);
        return (
          <div key={o.id} style={{...S.card,cursor:'pointer'}} onClick={()=>onSelectOrder(o)}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
              <div>
                <div style={{fontWeight:700}}>{o.client1?.name}</div>
                <div style={{fontSize:13,color:'#555'}}>{o.address}, {o.city} {o.postalCode}</div>
                <div style={{fontSize:12,color:'#888'}}>{o.client1?.phone}</div>
                <div style={{marginTop:6}}><span style={S.badge('#2563eb')}>{t(slot?.slot||'morning')}</span></div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontWeight:700,color:'#C41E1E'}}>{fmt$(o.totals?.total||0)}</div>
                <div style={{fontSize:12,color:'#888',marginTop:4}}>{t('paymentMethod')}: {o.paymentMethod==='lendcare'?t('lendcare'):t('cashDoor')}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ââ Profile âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function Profile({ t, api, me, onUpdated }) {
  const [sig, setSig] = useState(me.savedSignature);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  async function saveSig(data) {
    setSaving(true);
    await api.post('signature', { signatureData: data });
    setSig(data); setSaving(false);
    setToast(t('savedSignature')+' â');
    onUpdated({ ...me, savedSignature: data });
  }

  return (
    <div>
      <h2 style={{fontWeight:800,marginBottom:20}}>{t('profile')}</h2>
      <div style={S.card}>
        <div style={{marginBottom:12}}>
          <strong>{me.firstName} {me.lastName}</strong><br/>
          <span style={{color:'#888'}}>{me.email}</span><br/>
          <span style={S.badge('#C41E1E')}>{t('role'+me.role?.charAt(0).toUpperCase()+me.role?.slice(1)||'')}</span>
        </div>
        <div style={S.sectionTitle}>{t('savedSignature')}</div>
        {sig
          ? <div><img src={sig} style={{width:'100%',maxWidth:400,maxHeight:150,objectFit:'contain',border:'1.5px solid #eee',borderRadius:8,marginBottom:10}} /><button style={S.btn('ghost')} onClick={()=>setSig(null)}>{t('updateSignature')}</button></div>
          : <SignaturePad onSave={saveSig} onClear={()=>setSig(null)} />
        }
        {saving && <div style={{color:'#888',marginTop:8}}>{t('loading')}</div>}
      </div>
      {toast && <Toast msg={toast} onClose={()=>setToast('')} />}
    </div>
  );
}

// ââ Auth / Clerk integration ââââââââââââââââââââââââââââââââââââââââââââââââââ
// We use Clerk's hosted sign-in page and capture the token from the URL/__clerk_db_jwt
function useClerk() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const api = useAPI();

  useEffect(()=>{
    // Check for token in URL params (magic link)
    const params = new URLSearchParams(window.location.search);
    const ticket = params.get('__clerk_ticket');
    if (ticket) {
      // Exchange ticket for session â redirect to Clerk hosted
      window.location.href = `https://possible-peacock-8.accounts.dev/sign-in?__clerk_ticket=${ticket}&redirect_url=${encodeURIComponent(APP_URL)}`;
      return;
    }

    // Try to get existing session token from Clerk's JS
    loadClerkAndGetToken();
  },[]);

  async function loadClerkAndGetToken() {
    if (!window.Clerk) {
      // Load Clerk JS
      const script = document.createElement('script');
      script.src = `https://possible-peacock-8.accounts.dev/npm/@clerk/clerk-js@latest/dist/clerk.browser.js`;
      script.setAttribute('data-clerk-publishable-key', import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
      document.head.appendChild(script);
      script.onload = async () => { await initClerk(); };
      script.onerror = () => setLoading(false);
    } else {
      await initClerk();
    }
  }

  async function initClerk() {
    try {
      await window.Clerk.load({ appearance: { variables: { colorPrimary: '#C41E1E' } } });
      const session = window.Clerk.session;
      if (!session) { setLoading(false); return; }
      const token = await session.getToken();
      if (token) {
        localStorage.setItem('ap_token', token);
        const meData = await api.get('me');
        if (!meData.error) setMe(meData);
      }
    } catch(e) { console.error('Clerk init error', e); }
    finally { setLoading(false); }
  }

  async function signOut() {
    await window.Clerk?.signOut?.();
    localStorage.removeItem('ap_token');
    setMe(null);
  }

  return { me, setMe, loading, signOut };
}

// ââ App âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
export default function App() {
  const [lang, setLang] = useState('fr');
  const t = useT(lang);
  const { me, setMe, loading, signOut } = useClerk();
  const api = useAPI();
  const [view, setView] = useState('orders'); // orders|form|detail|dashboard|delivery|profile
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editOrder, setEditOrder] = useState(null);
  const [toast, setToast] = useState('');

  // Redirect to sign-in if not authenticated
  function goSignIn() {
    const redirect = encodeURIComponent(APP_URL);
    window.location.href = `https://possible-peacock-8.accounts.dev/sign-in?redirect_url=${redirect}`;
  }

  function selectOrder(order) { setSelectedOrder(order); setView('detail'); }

  function handleOrderSaved(order) {
    setToast(t('save') + ' â');
    setView('orders');
  }

  // Determine default view per role
  useEffect(()=>{
    if (!me) return;
    if (me.role==='delivery') setView('delivery');
    else if (me.role==='manager') setView('dashboard');
    else if (me.role==='client') setView('orders');
    else setView('orders');
  },[me?.userId]);

  // Nav items per role
  function navItems() {
    if (!me) return [];
    const items = [];
    if (['rep','client_service','manager','client'].includes(me.role)) items.push({key:'orders',label:t('myOrders')});
    if (['manager','rep'].includes(me.role)) items.push({key:'dashboard',label:t('dashboard')});
    if (me.role==='delivery') items.push({key:'delivery',label:t('deliverySchedule')});
    items.push({key:'profile',label:t('profile')});
    return items;
  }

  if (loading) return (
    <div style={{...S.app,display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:32,marginBottom:8}}>ð¥©</div>
        <div style={{fontWeight:700,color:'#C41E1E',fontSize:18}}>Alimentation PremiÃ¨re</div>
        <div style={{color:'#aaa',marginTop:8}}>{t('loading')}</div>
      </div>
    </div>
  );

  return (
    <div style={S.app}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Header */}
      <header style={S.header}>
        <div style={S.logo}>ð¥© Alimentation PremiÃ¨re</div>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          {me && navItems().map(n=>(
            <button key={n.key} style={S.navBtn(view===n.key)} onClick={()=>{setView(n.key);setSelectedOrder(null);}}>
              {n.label}
            </button>
          ))}
          <button style={{...S.btn('ghost'),background:'rgba(255,255,255,.15)',color:'#fff',border:'1.5px solid rgba(255,255,255,.3)',fontSize:12,padding:'4px 10px'}} onClick={()=>setLang(lang==='fr'?'en':'fr')}>
            {lang==='fr'?'EN':'FR'}
          </button>
          {me
            ? <button style={{...S.btn('ghost'),background:'rgba(255,255,255,.15)',color:'#fff',border:'1.5px solid rgba(255,255,255,.3)',fontSize:12,padding:'4px 10px'}} onClick={signOut}>{t('signOut')}</button>
            : <button style={{...S.btn('ghost'),background:'rgba(255,255,255,.15)',color:'#fff',border:'1.5px solid rgba(255,255,255,.3)',fontSize:12,padding:'4px 10px'}} onClick={goSignIn}>{t('signIn')}</button>
          }
        </div>
      </header>

      <main style={S.main}>
        {!me && (
          <div style={{...S.card,textAlign:'center',padding:48}}>
            <div style={{fontSize:48,marginBottom:12}}>ð¥©</div>
            <h2 style={{color:'#C41E1E',fontWeight:800}}>Alimentation PremiÃ¨re</h2>
            <p style={{color:'#555',marginBottom:24}}>Plateforme de gestion des ventes</p>
            <button style={{...S.btn(),fontSize:16,padding:'12px 32px'}} onClick={goSignIn}>{t('signIn')} â</button>
          </div>
        )}

        {me && view==='orders' && (
          <OrdersList t={t} api={api} me={me}
            onSelectOrder={selectOrder}
            onNewOrder={()=>{setEditOrder(null);setView('form');}} />
        )}

        {me && view==='form' && (
          <OrderForm t={t} api={api} me={me} existing={editOrder}
            onSaved={handleOrderSaved}
            onCancel={()=>setView('orders')} />
        )}

        {me && view==='detail' && selectedOrder && (
          <OrderDetail order={selectedOrder} t={t} me={me} api={api}
            onBack={()=>setView('orders')}
            onUpdated={(updated)=>{
              setSelectedOrder(updated);
              setToast('Mis Ã  jour â');
            }} />
        )}

        {me && view==='dashboard' && <Dashboard t={t} api={api} me={me} />}
        {me && view==='delivery' && <DeliveryView t={t} api={api} onSelectOrder={selectOrder} />}
        {me && view==='profile' && <Profile t={t} api={api} me={me} onUpdated={setMe} />}
      </main>

      {toast && <Toast msg={toast} onClose={()=>setToast('')} />}
    </div>
  );
}
