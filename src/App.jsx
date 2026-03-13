// ═══════════════════════════════════════════════════════════════════
//  PRINTFLOW — Full Job Management System (Supabase Edition)
// ═══════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { loadAll, syncTable, jobToDb, clientToDb, printToDb, fabToDb } from "./supabase.js";

// ── Constants ──────────────────────────────────────────────────────
const ORDER_TYPES = ["Vinyl Print","LED Board","Flex Banner","Sticker","Standee","Hoarding","Neon Sign","Canvas Print","Metal Sign","Glass Print","ACP Board","Backlit Board"];
const STAGES = ["Order Received","Design In Progress","Awaiting Approval","In Fabrication","Printing","Finishing","Ready for Delivery","Pending Billing","Bill Posted/Given","Delivered"];
const URGENCY = ["Low","Medium","High","Critical"];

const STAGE_COLORS = {
  "Order Received":"#607080","Design In Progress":"#4f8ef7","Awaiting Approval":"#c27ee8",
  "In Fabrication":"#ff8c00","Printing":"#f5a623","Finishing":"#ff8c00","Ready for Delivery":"#27c27c",
  "Pending Billing":"#ff3b3b","Bill Posted/Given":"#00c9a7","Delivered":"#27c27c",
};

// Fabrication constants
const FAB_TYPES  = ["MS Frame","GI Frame","Wooden Frame","ACP Base","Aluminum Frame","SS Frame"];
const PIPE_SIZES = ["3/4\"","1\"","1.25\"","1.5\"","2\"","25×25mm","32×32mm","40×40mm","50×50mm","75×75mm"];
const PIPE_THICK = ["1mm","1.2mm","1.6mm","2mm","2.5mm","3mm","4mm"];
const WOOD_TYPES = ["Pine Wood","Teak Wood","Plywood 12mm","Plywood 18mm","MDF 12mm","MDF 18mm","Hardwood"];
const ACP_THICK  = ["2mm","3mm","4mm","5mm","6mm","8mm"];
const FAB_STAGES = ["Pending","Material Ordered","In Fabrication","Quality Check","Ready","Dispatched"];
const FAB_STAGE_COLORS = {
  "Pending":"#607080","Material Ordered":"#4f8ef7","In Fabrication":"#f5a623",
  "Quality Check":"#c27ee8","Ready":"#27c27c","Dispatched":"#00c9a7",
};

// Print constants
const PRINT_TYPES  = ["Digital Flex","UV Print","Vinyl Cut","Offset Print","Screen Print","Canvas Print","Latex Print","Backlit Print","Eco Solvent"];
const PRINT_MATS   = ["Star Flex","Economy Flex","Vinyl","Canvas","Photo Paper","Sunboard","PVC Sheet","Mesh Flex","Wallpaper","Fabric"];
const PRINT_STAGES = ["Queued","File Prep","RIP Processing","Printing","Lamination/Finishing","Cutting","Quality Check","Done"];
const PRINT_STAGE_COLORS = {
  "Queued":"#607080","File Prep":"#4f8ef7","RIP Processing":"#c27ee8","Printing":"#f5a623",
  "Lamination/Finishing":"#ff8c00","Cutting":"#ff6644","Quality Check":"#c27ee8","Done":"#27c27c",
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WDAYS  = ["Su","Mo","Tu","We","Th","Fr","Sa"];

const DEFAULT_LOYALTY_GIFTS = [
  {points:500,  gift:"Free 10 Visiting Cards",icon:"🎁"},
  {points:1000, gift:"Free A3 Print (5 copies)",icon:"🖨"},
  {points:2500, gift:"Free Roll-up Standee",icon:"🎪"},
  {points:5000, gift:"Free Flex Banner 4×2ft",icon:"🏳"},
  {points:10000,gift:"10% Discount on next order",icon:"💸"},
  {points:20000,gift:"Free LED Board (small)",icon:"💡"},
];

// ── Demo Data ───────────────────────────────────────────────────────
const DEMO_CLIENTS = [];
const DEMO_JOBS = [];

// ── Helpers ────────────────────────────────────────────────────────
function genOrderId(existing) {
  const max = existing.reduce((m,j)=>{const n=parseInt(j.orderId?.replace("ORD-","")||0);return n>m?n:m;},1000);
  return `ORD-${max+1}`;
}
function daysUntil(d) { return Math.ceil((new Date(d)-new Date())/(1000*60*60*24)); }
function daysSince(d) { return d?Math.floor((new Date()-new Date(d))/(1000*60*60*24)):null; }
function urgencyColor(d) { return d<=3?"#ff3b3b":d<=5?"#f5a623":"#27c27c"; }
function urgencyLabel(d) { return d<=3?"URGENT":d<=5?"SOON":"ON TRACK"; }
function autoUrgency(deadline) {
  if(!deadline)return"Medium";
  const d=daysUntil(deadline);
  if(d<=3)return"Critical";if(d<=5)return"High";if(d<=10)return"Medium";return"Low";
}
function getLoyaltyTier(rev) {
  if(rev>=500000)return{tier:"Platinum",color:"#d4b8ff",bg:"#2a1a4a",icon:"💎",next:null};
  if(rev>=200000)return{tier:"Gold",    color:"#ffd700",bg:"#2a2000",icon:"🥇",next:500000};
  if(rev>=50000) return{tier:"Silver",  color:"#c0c8d8",bg:"#1a2535",icon:"🥈",next:200000};
  return              {tier:"Bronze",  color:"#cd7f32",bg:"#1a1000",icon:"🥉",next:50000};
}
function get30DayAlerts(clients,jobs) {
  return clients.filter(c=>c.monthlyBilling&&c.lastBillDate).map(c=>{
    const ds=daysSince(c.lastBillDate);
    if(ds<30)return null;
    const unbilledJobs=jobs.filter(j=>j.custId===c.custId&&j.stage!=="Delivered"&&j.stage!=="Bill Posted/Given");
    const unbilledAmt=unbilledJobs.reduce((s,j)=>s+(j.amount-j.paid),0);
    return{client:c,daysSince:ds,unbilledJobs,unbilledAmt};
  }).filter(Boolean);
}
function getPaymentAlerts(jobs,clients) {
  const mIds=new Set(clients.filter(c=>c.monthlyBilling).map(c=>c.custId));
  return jobs.filter(j=>{
    if(mIds.has(j.custId))return false;
    if(j.amount-j.paid<=0)return false;
    return["Delivered","Pending Billing","Bill Posted/Given"].includes(j.stage);
  }).map(j=>{
    const ds=daysSince(j.deliveredAt||j.deadline)||0;
    const level=ds>10?"red":ds>5?"orange":ds>3?"yellow":"ok";
    return{...j,daysAfterDelivery:ds,payLevel:level};
  }).filter(j=>j.payLevel!=="ok").sort((a,b)=>b.daysAfterDelivery-a.daysAfterDelivery);
}

// State is loaded from Supabase — see App() below

// ── DatePicker ─────────────────────────────────────────────────────
function DatePicker({value,onChange,placeholder="Pick a date"}){
  const[open,setOpen]=useState(false);
  const ref=useRef();
  const today=new Date();
  const[view,setView]=useState(()=>{const d=value?new Date(value):today;return{year:d.getFullYear(),month:d.getMonth()};});
  useEffect(()=>{function h(e){if(ref.current&&!ref.current.contains(e.target))setOpen(false);}document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  const first=new Date(view.year,view.month,1).getDay();
  const total=new Date(view.year,view.month+1,0).getDate();
  const selDate=value?new Date(value):null;
  const isSel=d=>selDate&&selDate.getFullYear()===view.year&&selDate.getMonth()===view.month&&selDate.getDate()===d;
  const isToday=d=>today.getFullYear()===view.year&&today.getMonth()===view.month&&today.getDate()===d;
  function pick(d){const dt=new Date(view.year,view.month,d);onChange(dt.toISOString().slice(0,10));setOpen(false);}
  function quick(days){const dt=new Date();dt.setDate(dt.getDate()+days);onChange(dt.toISOString().slice(0,10));setOpen(false);}
  const display=value?new Date(value).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}):"";
  return(
    <div ref={ref} style={{position:"relative"}}>
      <div onClick={()=>setOpen(!open)} style={{...S.input,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",userSelect:"none"}}>
        <span style={{color:value?"#e0e8f5":"#405060"}}>{display||placeholder}</span>
        <span style={{fontSize:15,color:"#4f8ef7"}}>📅</span>
      </div>
      {open&&(
        <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,zIndex:400,background:"#141f2e",border:"1px solid #2a3545",borderRadius:12,padding:14,boxShadow:"0 8px 32px rgba(0,0,0,0.7)",minWidth:275}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <button onClick={()=>setView(v=>v.month===0?{year:v.year-1,month:11}:{year:v.year,month:v.month-1})} style={S.calBtn}>‹</button>
            <span style={{fontWeight:700,color:"#e0e8f5",fontSize:13}}>{MONTHS[view.month]} {view.year}</span>
            <button onClick={()=>setView(v=>v.month===11?{year:v.year+1,month:0}:{year:v.year,month:v.month+1})} style={S.calBtn}>›</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:3}}>
            {WDAYS.map(d=><div key={d} style={{textAlign:"center",fontSize:9,color:"#607080",fontWeight:700,padding:"3px 0"}}>{d}</div>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
            {Array.from({length:first}).map((_,i)=><div key={"e"+i}/>)}
            {Array.from({length:total}).map((_,i)=>{const d=i+1,sel=isSel(d),tod=isToday(d);return <div key={d} onClick={()=>pick(d)} style={{textAlign:"center",padding:"6px 2px",borderRadius:5,fontSize:12,cursor:"pointer",background:sel?"#4f8ef7":tod?"#1a2a3e":"transparent",color:sel?"#fff":tod?"#4f8ef7":"#c8d8e8",fontWeight:sel||tod?700:400,border:tod&&!sel?"1px solid #4f8ef744":"1px solid transparent"}}>{d}</div>;})}
          </div>
          <div style={{borderTop:"1px solid #1a2535",marginTop:10,paddingTop:8,display:"flex",gap:5,flexWrap:"wrap"}}>
            {[["Today",0],["3d",3],["1wk",7],["2wk",14],["1mo",30]].map(([l,d])=><button key={l} onClick={()=>quick(d)} style={S.quickBtn}>{l}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Image Upload ───────────────────────────────────────────────────
function ImageUpload({images,onChange}){
  const inputRef=useRef();
  function handleFiles(files){Array.from(files).forEach(f=>{if(!f.type.startsWith("image/"))return;const r=new FileReader();r.onload=e=>onChange([...images,{id:Date.now()+Math.random(),name:f.name,data:e.target.result}]);r.readAsDataURL(f);});}
  return(
    <div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:5}}>
        {images.map(img=>(
          <div key={img.id} style={{position:"relative",width:72,height:72,borderRadius:7,overflow:"hidden",border:"1px solid #2a3545",flexShrink:0}}>
            <img src={img.data} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
            <button onClick={()=>onChange(images.filter(x=>x.id!==img.id))} style={{position:"absolute",top:2,right:2,background:"rgba(0,0,0,0.75)",color:"#fff",border:"none",borderRadius:"50%",width:16,height:16,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>✕</button>
          </div>
        ))}
        <div onClick={()=>inputRef.current.click()} style={{width:72,height:72,borderRadius:7,border:"2px dashed #2a3545",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#405060",fontSize:10,gap:3,flexShrink:0}}>
          <span style={{fontSize:20}}>＋</span><span>Photo</span>
        </div>
      </div>
      <div style={{fontSize:10,color:"#405060"}}>Optional — tap + to add job photos</div>
      <input ref={inputRef} type="file" accept="image/*" multiple style={{display:"none"}} onChange={e=>handleFiles(e.target.files)}/>
    </div>
  );
}

// ── Bill Modal ─────────────────────────────────────────────────────
function BillModal({alert,jobs,setJobs,clients,setClients,onClose,showToast}){
  const{client}=alert;
  const billableJobs=useMemo(()=>jobs.filter(j=>j.custId===client.custId&&j.stage!=="Delivered"&&j.stage!=="Bill Posted/Given"),[jobs,client.custId]);
  const[selectedIds,setSelectedIds]=useState(()=>billableJobs.map(j=>j.orderId));
  const[discount,setDiscount]=useState(0);
  const[note,setNote]=useState("");
  const selectedJobs=billableJobs.filter(j=>selectedIds.includes(j.orderId));
  const subtotal=selectedJobs.reduce((s,j)=>s+j.amount,0);
  const advance=selectedJobs.reduce((s,j)=>s+j.paid,0);
  const discAmt=Math.round(subtotal*discount/100);
  const totalDue=subtotal-advance-discAmt;
  function toggle(id){setSelectedIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);}
  function generate(){
    const today=new Date().toISOString().slice(0,10);
    setJobs(prev=>prev.map(j=>selectedIds.includes(j.orderId)?{...j,stage:"Bill Posted/Given"}:j));
    setClients(prev=>prev.map(c=>c.custId===client.custId?{...c,lastBillDate:today}:c));
    showToast(`Bill for ${client.name} — ₹${totalDue.toLocaleString()}`);
    onClose();
  }
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#141f2e",borderRadius:14,padding:22,maxWidth:540,width:"100%",maxHeight:"90vh",overflowY:"auto",border:"1px solid #2a3545",boxShadow:"0 12px 48px rgba(0,0,0,0.8)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
          <div><div style={{fontSize:16,fontWeight:800,color:"#e0e8f5"}}>Generate Bill</div><div style={{fontSize:11,color:"#607080",marginTop:2}}>{client.name} · {alert.daysSince}d since last bill</div></div>
          <button onClick={onClose} style={S.closeBtn}>✕ Close</button>
        </div>
        {billableJobs.length===0?<div style={{textAlign:"center",padding:"24px 0",color:"#607080"}}>No unbilled jobs for this client.</div>:(
          <>
            <div style={{fontSize:10,color:"#607080",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:7}}>Select Jobs to Bill</div>
            {billableJobs.map(j=>{const isSel=selectedIds.includes(j.orderId);return(
              <div key={j.orderId} onClick={()=>toggle(j.orderId)} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:isSel?"#1e3a5f":"#0d1520",borderRadius:8,marginBottom:5,cursor:"pointer",border:`1px solid ${isSel?"#4f8ef755":"#1a2535"}`}}>
                <div style={{width:17,height:17,borderRadius:4,border:`2px solid ${isSel?"#4f8ef7":"#2a3545"}`,background:isSel?"#4f8ef7":"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{isSel&&<span style={{color:"#fff",fontSize:10,fontWeight:700,lineHeight:1}}>✓</span>}</div>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,color:"#e0e8f5",fontWeight:600}}>{j.orderId} — {j.jobDesc}</div><div style={{fontSize:10,color:"#607080"}}>{j.orderType} · <span style={{color:STAGE_COLORS[j.stage]||"#607080"}}>{j.stage}</span></div></div>
                <div style={{textAlign:"right",flexShrink:0}}><div style={{fontSize:12,color:"#4f8ef7",fontWeight:700}}>₹{j.amount.toLocaleString()}</div>{j.paid>0&&<div style={{fontSize:10,color:"#27c27c"}}>₹{j.paid.toLocaleString()} paid</div>}</div>
              </div>
            );})}
            <div style={{background:"#0d1520",borderRadius:9,padding:12,marginTop:12}}>
              {[["Subtotal",`₹${subtotal.toLocaleString()}`,"#a0b8c8"],advance>0?["Advance","− ₹"+advance.toLocaleString(),"#27c27c"]:null].filter(Boolean).map(([l,v,c])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #1a2535"}}><span style={{fontSize:12,color:"#a0b8c8"}}>{l}</span><span style={{fontSize:12,color:c,fontWeight:600}}>{v}</span></div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"1px solid #1a2535"}}>
                <span style={{fontSize:12,color:"#a0b8c8"}}>Discount %</span>
                <input type="number" min="0" max="100" value={discount} onChange={e=>setDiscount(parseFloat(e.target.value)||0)} onClick={e=>e.stopPropagation()} style={{...S.input,maxWidth:75,padding:"3px 8px",fontSize:12,textAlign:"right"}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0"}}><span style={{fontSize:14,color:"#e0e8f5",fontWeight:800}}>Total Due</span><span style={{fontSize:14,color:"#4f8ef7",fontWeight:800}}>₹{totalDue.toLocaleString()}</span></div>
            </div>
            <textarea style={{...S.input,minHeight:44,resize:"vertical",marginTop:10}} value={note} onChange={e=>setNote(e.target.value)} placeholder="Note (optional)"/>
            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button onClick={generate} disabled={selectedIds.length===0} style={{...S.submitBtn,flex:1,opacity:selectedIds.length===0?0.5:1}}>🧾 Generate & Mark Billed</button>
              <button onClick={onClose} style={{...S.submitBtn,background:"none",border:"1px solid #2a3545",color:"#607080"}}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────
function App(){
  const[page,setPage]=useState("dashboard");
  const[jobs,setJobs]           =useState([]);
  const[clients,setClients]     =useState([]);
  const[fabJobs,setFabJobs]     =useState([]);
  const[printJobs,setPrintJobs] =useState([]);
  const[loyaltyGifts,setLoyaltyGifts]=useState(DEFAULT_LOYALTY_GIFTS);
  const[loading,setLoading]     =useState(true);
  const[toast,setToast]         =useState(null);
  const[billAlert,setBillAlert] =useState(null);
  function showToast(msg,type="success"){setToast({msg,type});setTimeout(()=>setToast(null),3200);}
  const[confirmReset,setConfirmReset]=useState(false);
  function resetData(){if(confirmReset){setJobs([]);setClients([]);setFabJobs([]);setPrintJobs([]);showToast("Reset done");setConfirmReset(false);}else{setConfirmReset(true);setTimeout(()=>setConfirmReset(false),3000);}}

  // Refs for tracking previous state (for Supabase diff sync)
  const prevJobs=useRef([]);
  const prevClients=useRef([]);
  const prevPrint=useRef([]);
  const prevFab=useRef([]);
  const syncReady=useRef(false);

  // Load from Supabase on mount
  useEffect(()=>{
    loadAll().then(async (data)=>{
      setJobs(data.jobs); prevJobs.current=data.jobs;
      setClients(data.clients); prevClients.current=data.clients;
      setPrintJobs(data.printJobs); prevPrint.current=data.printJobs;
      setFabJobs(data.fabJobs); prevFab.current=data.fabJobs;
      // Load loyalty gifts from settings
      try{
        const{loadSettings}=await import("./supabase.js");
        const saved=await loadSettings("loyalty_gifts");
        if(saved&&saved.length>0)setLoyaltyGifts(saved);
      }catch(e){}
      setLoading(false);
      setTimeout(()=>{ syncReady.current=true; },500);
    }).catch(()=>{ setLoading(false); showToast("Failed to load data","error"); });
  },[]);

  // Sync jobs to Supabase when changed
  useEffect(()=>{
    if(!syncReady.current) return;
    syncTable("jobs",prevJobs.current,jobs,"orderId","order_id",jobToDb);
    prevJobs.current=jobs;
  },[jobs]);

  // Sync clients
  useEffect(()=>{
    if(!syncReady.current) return;
    syncTable("clients",prevClients.current,clients,"custId","cust_id",clientToDb);
    prevClients.current=clients;
  },[clients]);

  // Sync print jobs
  useEffect(()=>{
    if(!syncReady.current) return;
    syncTable("print_jobs",prevPrint.current,printJobs,"id","print_id",printToDb);
    prevPrint.current=printJobs;
  },[printJobs]);

  // Sync fab jobs
  useEffect(()=>{
    if(!syncReady.current) return;
    syncTable("fab_jobs",prevFab.current,fabJobs,"id","fab_id",fabToDb);
    prevFab.current=fabJobs;
  },[fabJobs]);

  const billingAlerts =useMemo(()=>get30DayAlerts(clients,jobs),[clients,jobs]);
  const paymentAlerts =useMemo(()=>getPaymentAlerts(jobs,clients),[jobs,clients]);

  const sharedProps={jobs,setJobs,clients,setClients,fabJobs,setFabJobs,printJobs,setPrintJobs,showToast,setPage,billingAlerts,paymentAlerts,setBillAlert,loyaltyGifts,setLoyaltyGifts};

  if(loading) return (
    <div style={{...S.root,alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:32,marginBottom:12}}>⬡</div>
        <div style={{fontSize:16,fontWeight:700,color:"#4f8ef7",marginBottom:6}}>PrintFlow</div>
        <div style={{fontSize:12,color:"#607080"}}>Loading from database...</div>
      </div>
    </div>
  );

  return(
    <div style={S.root}>
      <Sidebar page={page} setPage={setPage} resetData={resetData} confirmReset={confirmReset} billingAlerts={billingAlerts} paymentAlerts={paymentAlerts} fabJobs={fabJobs} printJobs={printJobs}/>
      <div style={S.main}>
        <TopBar page={page}/>
        {page==="dashboard"   && <Dashboard   {...sharedProps}/>}
        {page==="add"         && <AddJob       {...sharedProps}/>}
        {page==="pending"     && <PendingJobs  {...sharedProps}/>}
        {page==="print"       && <PrintDept    {...sharedProps}/>}
        {page==="fabrication" && <FabDept       {...sharedProps}/>}
        {page==="clients"     && <Clients       {...sharedProps}/>}
        {page==="billing"     && <Billing       {...sharedProps}/>}
        {page==="payments"    && <Payments      {...sharedProps}/>}
        {page==="reports"     && <Reports       {...sharedProps}/>}
        {page==="settings"    && <Settings      {...sharedProps}/>}
      </div>
      {billAlert&&<BillModal alert={billAlert} jobs={jobs} setJobs={setJobs} clients={clients} setClients={setClients} onClose={()=>setBillAlert(null)} showToast={showToast}/>}
      {toast&&<div style={{...S.toast,background:toast.type==="error"?"#ff3b3b":"#27c27c"}}>{toast.msg}</div>}
    </div>
  );
}
export default App;

// ── Sidebar ────────────────────────────────────────────────────────
function Sidebar({page,setPage,resetData,confirmReset,billingAlerts,paymentAlerts,fabJobs,printJobs}){
  const fabPending=fabJobs.filter(f=>f.stage!=="Dispatched").length;
  const printPending=printJobs.filter(p=>p.stage!=="Done").length;
  const nav=[
    {id:"dashboard",  icon:"▦", label:"Dashboard"},
    {id:"add",        icon:"＋",label:"New Job"},
    {id:"pending",    icon:"⚡",label:"Pending Jobs"},
    {id:"print",      icon:"🖨",label:"Print Dept",   badge:printPending},
    {id:"fabrication",icon:"🔧",label:"Fabrication",  badge:fabPending},
    {id:"clients",    icon:"◉", label:"Clients"},
    {id:"billing",    icon:"₹", label:"Billing",      badge:billingAlerts.length},
    {id:"payments",   icon:"💳",label:"Payments",     badge:paymentAlerts.filter(x=>x.payLevel==="red").length},
    {id:"reports",    icon:"📊",label:"Reports"},
    {id:"settings",   icon:"⚙",label:"Settings"},
  ];
  return(
    <div style={S.sidebar}>
      <div style={S.brand}>
        <span style={{fontSize:24,color:"#4f8ef7"}}>⬡</span>
        <div><div style={{fontSize:16,fontWeight:800,color:"#e0e8f5",letterSpacing:1}}>PrintFlow</div><div style={{fontSize:8,color:"#405060",letterSpacing:1}}>JOB MANAGER</div></div>
      </div>
      {nav.map(n=>(
        <button key={n.id} style={{...S.navBtn,...(page===n.id?S.navActive:{})}} onClick={()=>setPage(n.id)}>
          <span style={{fontSize:13,width:19,textAlign:"center",flexShrink:0}}>{n.icon}</span>
          <span style={{flex:1,textAlign:"left"}}>{n.label}</span>
          {n.badge>0&&<span style={{background:"#ff3b3b",color:"#fff",fontSize:8,fontWeight:800,padding:"1px 5px",borderRadius:9,flexShrink:0}}>{n.badge}</span>}
        </button>
      ))}
      <div style={{marginTop:"auto",padding:"0 10px 10px"}}>
        <div style={{background:"#0d1520",border:"1px solid #1a2535",borderRadius:7,padding:"8px 12px",marginBottom:7}}>
          <div style={{fontSize:9,color:"#27c27c",marginBottom:2}}>🟢 Supabase connected</div>
          <div style={{fontSize:9,color:"#405060"}}>Data saved to cloud</div>
        </div>
        <button onClick={resetData} style={{width:"100%",background:confirmReset?"#ff3b3b22":"none",border:"1px solid "+(confirmReset?"#ff3b3b":"#2a3545"),color:confirmReset?"#ff3b3b":"#405060",borderRadius:5,padding:"5px",fontSize:10,cursor:"pointer"}}>{confirmReset?"⚠ Tap again":"↺ Reset"}</button>
      </div>
    </div>
  );
}

// ── TopBar ─────────────────────────────────────────────────────────
function TopBar({page}){
  const titles={dashboard:"Dashboard",add:"Add New Job",pending:"Pending Jobs",print:"Print Department",fabrication:"Fabrication Department",clients:"Client Database",billing:"Billing",payments:"Payment Tracker",reports:"Reports & Analytics",settings:"Settings"};
  return(
    <div style={S.topBar}>
      <span style={{fontSize:17,fontWeight:700,color:"#e0e8f5"}}>{titles[page]}</span>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:10,color:"#607080"}}>{new Date().toLocaleDateString("en-IN",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</span>
        <span style={{fontSize:9,background:"#27c27c22",color:"#27c27c",padding:"2px 9px",borderRadius:10,fontWeight:700}}>● LIVE</span>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────
function Dashboard({jobs,setJobs,clients,showToast,setPage,billingAlerts,paymentAlerts,setBillAlert,fabJobs,printJobs}){
  const[hideBilling,setHideBilling]=useState(false);
  const[hidePayment,setHidePayment]=useState(false);
  const[hidePending,setHidePending]=useState(false);

  const pending=jobs.filter(j=>j.stage!=="Delivered");
  const urgent=pending.filter(j=>j.urgency==="Critical"||j.urgency==="High");
  const totalRev=jobs.reduce((s,j)=>s+j.amount,0);
  const totalDue=jobs.reduce((s,j)=>s+(j.amount-j.paid),0);
  const pendingBilling=jobs.filter(j=>j.stage==="Pending Billing");
  const stageCount=STAGES.reduce((a,s)=>{a[s]=jobs.filter(j=>j.stage===s).length;return a},{});
  const redPay=paymentAlerts.filter(x=>x.payLevel==="red");

  return(
    <div style={S.content}>
      {/* Billing cycle alert */}
      {billingAlerts.length>0&&!hideBilling&&(
        <div style={{...S.card,borderLeft:"4px solid #f5a623",background:"#130e00",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{fontWeight:700,color:"#f5a623",fontSize:13}}>🔔 Monthly Billing Due — {billingAlerts.length} client{billingAlerts.length>1?"s":""}</span>
            <button onClick={()=>setHideBilling(true)} style={S.closeBtn}>✕ Dismiss</button>
          </div>
          {billingAlerts.map(a=>(
            <div key={a.client.custId} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0d1520",borderRadius:7,padding:"8px 12px",marginBottom:5,border:"1px solid #f5a62322",flexWrap:"wrap",gap:6}}>
              <div><span style={{fontWeight:700,color:"#e0e8f5"}}>{a.client.name}</span><span style={{marginLeft:8,fontSize:10,color:"#ff3b3b",fontWeight:700}}>{a.daysSince}d · {a.unbilledJobs.length} jobs · ₹{a.unbilledAmt.toLocaleString()}</span></div>
              <button onClick={()=>setBillAlert(a)} style={{background:"#f5a62322",color:"#f5a623",border:"1px solid #f5a62344",borderRadius:7,padding:"5px 12px",cursor:"pointer",fontSize:11,fontWeight:700}}>🧾 Bill Now</button>
            </div>
          ))}
        </div>
      )}

      {/* Payment overdue */}
      {paymentAlerts.length>0&&!hidePayment&&(
        <div style={{...S.card,borderLeft:"4px solid #ff3b3b",background:"#1a0808",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontWeight:700,color:"#ff3b3b",fontSize:13}}>💳 Payment Overdue — {paymentAlerts.length} job{paymentAlerts.length>1?"s":""} (₹{paymentAlerts.reduce((s,j)=>s+(j.amount-j.paid),0).toLocaleString()} pending)</span>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setPage("payments")} style={{background:"#ff3b3b22",color:"#ff3b3b",border:"1px solid #ff3b3b44",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontSize:10,fontWeight:700}}>View →</button>
              <button onClick={()=>setHidePayment(true)} style={S.closeBtn}>✕</button>
            </div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {redPay.slice(0,4).map(j=>(
              <div key={j.orderId} style={{background:"#0d1520",borderRadius:6,padding:"5px 10px",border:"1px solid #ff3b3b33",fontSize:11}}>
                <span style={S.orderBadge}>{j.orderId}</span>
                <span style={{marginLeft:5,color:"#c8d8e8"}}>{j.clientName}</span>
                <span style={{marginLeft:5,color:"#ff3b3b",fontWeight:700}}>₹{(j.amount-j.paid).toLocaleString()}</span>
              </div>
            ))}
            {redPay.length>4&&<span style={{fontSize:10,color:"#607080",padding:"5px 8px"}}>+{redPay.length-4} more</span>}
          </div>
        </div>
      )}

      {/* Pending billing jobs */}
      {pendingBilling.length>0&&!hidePending&&(
        <div style={{...S.card,borderLeft:"4px solid #ff3b3b",background:"#1a0808",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
            <span style={{fontWeight:700,color:"#ff3b3b",fontSize:13}}>🧾 {pendingBilling.length} Job{pendingBilling.length>1?"s":""} Awaiting Billing</span>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setPage("billing")} style={{background:"#ff3b3b22",color:"#ff3b3b",border:"1px solid #ff3b3b44",borderRadius:6,padding:"3px 10px",cursor:"pointer",fontSize:10,fontWeight:700}}>Billing →</button>
              <button onClick={()=>setHidePending(true)} style={S.closeBtn}>✕</button>
            </div>
          </div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{pendingBilling.map(j=><div key={j.orderId} style={{background:"#0d1520",borderRadius:6,padding:"4px 10px",border:"1px solid #ff3b3b33",fontSize:11}}><span style={S.orderBadge}>{j.orderId}</span><span style={{marginLeft:5,color:"#c8d8e8"}}>{j.clientName}</span><span style={{marginLeft:5,color:"#ff3b3b",fontWeight:700}}>₹{(j.amount-j.paid).toLocaleString()}</span></div>)}</div>
        </div>
      )}

      {/* KPIs */}
      <div style={S.kpiRow}>
        {[
          {label:"Total Jobs",    val:jobs.length,               color:"#4f8ef7",icon:"◈"},
          {label:"Pending",       val:pending.length,             color:"#f5a623",icon:"⧗"},
          {label:"Urgent",        val:urgent.length,              color:"#ff3b3b",icon:"⚡"},
          {label:"Print Queue",   val:printJobs.filter(p=>p.stage!=="Done").length, color:"#c27ee8",icon:"🖨"},
          {label:"Fab Queue",     val:fabJobs.filter(f=>f.stage!=="Dispatched").length, color:"#ff8c00",icon:"🔧"},
          {label:"Revenue",       val:"₹"+totalRev.toLocaleString(), color:"#27c27c",icon:"₹"},
          {label:"Outstanding",   val:"₹"+totalDue.toLocaleString(), color:"#c27ee8",icon:"⊘"},
        ].map(k=>(
          <div key={k.label} style={{...S.kpiCard,borderTop:`3px solid ${k.color}`}}>
            <span style={{fontSize:17,color:k.color}}>{k.icon}</span>
            <span style={{fontSize:20,fontWeight:800,color:"#e0e8f5"}}>{k.val}</span>
            <span style={{fontSize:10,color:"#607080"}}>{k.label}</span>
          </div>
        ))}
      </div>

      {/* Pipeline */}
      <div style={S.card}>
        <h3 style={S.cardTitle}>Job Pipeline</h3>
        <div style={{display:"flex",overflowX:"auto"}}>
          {STAGES.map((s,i)=>(
            <div key={s} style={{flex:1,minWidth:80,textAlign:"center",padding:"10px 4px",borderRight:i<STAGES.length-1?"1px solid #1a2535":"none"}}>
              <div style={{fontSize:22,fontWeight:800,color:stageCount[s]>0?STAGE_COLORS[s]:"#2a3545"}}>{stageCount[s]||0}</div>
              <div style={{fontSize:8,color:"#607080",marginTop:3,textTransform:"uppercase",letterSpacing:0.3,lineHeight:1.4}}>{s}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick job table */}
      <div style={S.card}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <h3 style={{...S.cardTitle,marginBottom:0}}>All Jobs</h3>
          <button onClick={()=>setPage("add")} style={{background:"#4f8ef7",color:"#fff",border:"none",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>+ New Job</button>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={S.table}>
            <thead><tr>{["Order","Client","Type","Deadline","Priority","Stage","Depts"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>{[...jobs].sort((a,b)=>URGENCY.indexOf(b.urgency)-URGENCY.indexOf(a.urgency)).map(j=><JobRow key={j.orderId} job={j} jobs={jobs} setJobs={setJobs} showToast={showToast}/>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function JobRow({job,jobs,setJobs,showToast}){
  const days=daysUntil(job.deadline);
  const urgColors={"Low":"#27c27c","Medium":"#f5a623","High":"#ff8c00","Critical":"#ff3b3b"};
  return(
    <tr style={S.tr}>
      <td style={S.td}><span style={S.orderBadge}>{job.orderId}</span></td>
      <td style={S.td}>{job.clientName}</td>
      <td style={S.td}><span style={{fontSize:10,background:"#1a2a3e",color:"#a0b8ff",padding:"2px 6px",borderRadius:10}}>{job.orderType}</span></td>
      <td style={S.td}><span style={{color:urgencyColor(days),fontWeight:700,fontSize:11}}>{urgencyLabel(days)} · {days}d</span></td>
      <td style={S.td}>
        <select value={job.urgency} onChange={e=>{setJobs(prev=>prev.map(j=>j.orderId===job.orderId?{...j,urgency:e.target.value}:j));showToast("Priority updated");}} style={{...S.miniSelect,color:urgColors[job.urgency]}}>{URGENCY.map(u=><option key={u}>{u}</option>)}</select>
      </td>
      <td style={S.td}>
        <select value={job.stage} onChange={e=>{setJobs(prev=>prev.map(j=>j.orderId===job.orderId?{...j,stage:e.target.value}:j));showToast("Stage updated");}} style={{...S.miniSelect,color:STAGE_COLORS[job.stage]||"#c8d8e8"}}>{STAGES.map(s=><option key={s}>{s}</option>)}</select>
      </td>
      <td style={S.td}>
        <div style={{display:"flex",gap:3}}>
          {job.needsPrint&&<span style={{fontSize:9,background:"#4f8ef722",color:"#4f8ef7",padding:"1px 5px",borderRadius:8}}>🖨</span>}
          {job.needsFabrication&&<span style={{fontSize:9,background:"#ff8c0022",color:"#ff8c00",padding:"1px 5px",borderRadius:8}}>🔧</span>}
        </div>
      </td>
    </tr>
  );
}

// ── Add Job ────────────────────────────────────────────────────────
function AddJob({jobs,setJobs,clients,setClients,fabJobs,setFabJobs,printJobs,setPrintJobs,showToast,setPage}){
  const blank={custId:"",clientName:"",phone:"",jobDesc:"",orderType:"Vinyl Print",deadline:"",urgency:"Medium",stage:"Order Received",amount:"",paid:"0",notes:"",images:[],needsPrint:false,needsFabrication:false};
  const blankPrint={type:"Digital Flex",material:"Star Flex",width:"",height:"",qty:"1",resolution:"720dpi",notes:""};
  const blankFab={type:"MS Frame",pipeSize:"1\"",pipeThick:"2mm",woodType:"Plywood 18mm",acpThick:"4mm",width:"",height:"",notes:"",stage:"Pending"};
  const[form,setForm]=useState(blank);
  const[printSpec,setPrintSpec]=useState(blankPrint);
  const[fabSpec,setFabSpec]=useState(blankFab);
  const[suggestions,setSuggestions]=useState([]);
  const[newClient,setNewClient]=useState(false);
  const[nc,setNc]=useState({name:"",phone:"",email:"",gst:"",address:"",monthlyBilling:false});

  function handleDeadline(v){setForm(f=>({...f,deadline:v,urgency:autoUrgency(v)}));}
  function search(v){
    setForm(f=>({...f,custId:v,clientName:v}));
    setSuggestions(v.length>=2?clients.filter(c=>(c.custId||"").toLowerCase().includes(v.toLowerCase())||(c.phone||"").includes(v)||(c.name||"").toLowerCase().includes(v.toLowerCase())):[]); 
  }
  function pick(c){setForm(f=>({...f,custId:c.custId,clientName:c.name,phone:c.phone}));setSuggestions([]);}
  function toggleNewClient(){
    if(!newClient){
      setNc(prev=>({...prev,name:prev.name||form.clientName||form.custId,phone:prev.phone||form.phone}));
    }
    setNewClient(!newClient);
  }

  function submit(){
    const cn=form.clientName||form.custId;
    let cid=form.custId;
    // If new client, auto-generate a custId
    if(newClient&&nc.name&&!clients.find(c=>c.custId===cid)){
      const maxN=clients.reduce((m,c)=>{const n=parseInt((c.custId||"").replace("C-","")||"0");return n>m?n:m;},0);
      cid="C-"+String(maxN+1).padStart(3,"0");
    }
    if(!cn||!form.jobDesc||!form.deadline||!form.amount){showToast("Fill all required fields","error");return;}
    const orderId=genOrderId(jobs);
    const newJob={...form,custId:cid,clientName:cn,orderId,amount:parseFloat(form.amount)||0,paid:parseFloat(form.paid)||0,createdAt:new Date().toISOString().slice(0,10),deliveredAt:null,
      printSpec:form.needsPrint?{...printSpec}:null,
      fabSpec:form.needsFabrication?{...fabSpec}:null,
    };
    setJobs(prev=>[...prev,newJob]);
    if(form.needsPrint){
      const pj={id:"PJ-"+orderId,orderId,clientName:cn,jobDesc:form.jobDesc,...printSpec,stage:"Queued",createdAt:new Date().toISOString().slice(0,10)};
      setPrintJobs(prev=>[...prev,pj]);
    }
    if(form.needsFabrication){
      const fj={id:"FAB-"+orderId,orderId,clientName:cn,jobDesc:form.jobDesc,...fabSpec,stage:"Pending",createdAt:new Date().toISOString().slice(0,10)};
      setFabJobs(prev=>[...prev,fj]);
    }
    if(newClient&&(nc.name||cn)){
      const clientName=nc.name||cn;
      const clientPhone=nc.phone||form.phone;
      setClients(prev=>[...prev,{name:clientName,phone:clientPhone,email:nc.email,gst:nc.gst,address:nc.address,monthlyBilling:nc.monthlyBilling,custId:cid,lastBillDate:null,loyaltyPoints:0}]);
    }
    showToast(orderId+" created!"+(form.needsPrint?" Print job queued.":"")+(form.needsFabrication?" Fab job created.":""));
    setForm(blank);setNc({name:"",phone:"",email:"",gst:"",address:"",monthlyBilling:false});setNewClient(false);setPage("pending");
  }

  const fabMaterialFields=()=>{
    if(fabSpec.type==="Wooden Frame")return[["woodType","Wood Type",WOOD_TYPES]];
    if(fabSpec.type==="ACP Base")return[["acpThick","ACP Thickness",ACP_THICK],["pipeSize","Frame Pipe Size",PIPE_SIZES],["pipeThick","Pipe Thickness",PIPE_THICK]];
    return[["pipeSize","Pipe Size",PIPE_SIZES],["pipeThick","Pipe Thickness",PIPE_THICK]];
  };

  return(
    <div style={S.content}>
      <div style={S.formCard}>
        <h3 style={S.cardTitle}>Job Details</h3>
        <div style={S.formGrid}>
          <div style={{...S.fg,position:"relative"}}>
            <label style={S.label}>Client Name / Search *</label>
            <input style={S.input} value={form.custId} onChange={e=>search(e.target.value)} placeholder="Type client name or phone…"/>
            {suggestions.length>0&&<div style={S.dropdown}>{suggestions.map(c=><div key={c.custId} style={S.dropItem} onClick={()=>pick(c)}><strong>{c.custId}</strong> — {c.name} · {c.phone}</div>)}</div>}
          </div>
          <div style={S.fg}><label style={S.label}>Client Name *</label><input style={S.input} value={form.clientName} onChange={e=>setForm({...form,clientName:e.target.value})} placeholder="Full name"/></div>
          <div style={S.fg}><label style={S.label}>Phone</label><input style={S.input} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></div>
          <div style={{...S.fg,gridColumn:"1/-1"}}><label style={S.label}>Job Description *</label><textarea style={{...S.input,minHeight:60,resize:"vertical"}} value={form.jobDesc} onChange={e=>setForm({...form,jobDesc:e.target.value})} placeholder="Describe the job…"/></div>
          <div style={{...S.fg,gridColumn:"1/-1"}}><label style={S.label}>Job Photos <span style={{color:"#405060",fontWeight:400,textTransform:"none"}}>(optional)</span></label><ImageUpload images={form.images||[]} onChange={imgs=>setForm({...form,images:imgs})}/></div>
          <div style={S.fg}><label style={S.label}>Order Type *</label><select style={S.input} value={form.orderType} onChange={e=>setForm({...form,orderType:e.target.value})}>{ORDER_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
          <div style={S.fg}><label style={S.label}>Deadline * <span style={{color:"#27c27c",fontWeight:400,textTransform:"none"}}>(auto-urgency)</span></label><DatePicker value={form.deadline} onChange={handleDeadline} placeholder="Select deadline…"/>{form.deadline&&<div style={{fontSize:9,color:"#27c27c",marginTop:2}}>✓ {form.urgency} ({daysUntil(form.deadline)}d away)</div>}</div>
          <div style={S.fg}><label style={S.label}>Urgency</label><select style={{...S.input,color:{"Low":"#27c27c","Medium":"#f5a623","High":"#ff8c00","Critical":"#ff3b3b"}[form.urgency]}} value={form.urgency} onChange={e=>setForm({...form,urgency:e.target.value})}>{URGENCY.map(u=><option key={u}>{u}</option>)}</select></div>
          <div style={S.fg}><label style={S.label}>Stage</label><select style={S.input} value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}>{STAGES.map(s=><option key={s}>{s}</option>)}</select></div>
          <div style={S.fg}><label style={S.label}>Total Amount ₹ *</label><input type="number" style={S.input} value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} placeholder="0"/></div>
          <div style={S.fg}><label style={S.label}>Advance Paid ₹</label><input type="number" style={S.input} value={form.paid} onChange={e=>setForm({...form,paid:e.target.value})} placeholder="0"/></div>
          <div style={{...S.fg,gridColumn:"1/-1"}}><label style={S.label}>Notes</label><textarea style={{...S.input,minHeight:44,resize:"vertical"}} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Size, material, instructions…"/></div>
        </div>

        {/* Dept toggles */}
        <div style={{display:"flex",gap:10,marginTop:14,flexWrap:"wrap"}}>
          {[["needsPrint","🖨 Requires Print","#4f8ef7"],["needsFabrication","🔧 Requires Fabrication","#ff8c00"]].map(([key,label,color])=>(
            <div key={key} onClick={()=>setForm(f=>({...f,[key]:!f[key]}))} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 14px",background:form[key]?color+"22":"#0d1520",border:`1px solid ${form[key]?color+"66":"#1a2535"}`,borderRadius:8,cursor:"pointer",flex:1}}>
              <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${form[key]?color:"#2a3545"}`,background:form[key]?color:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{form[key]&&<span style={{color:"#fff",fontSize:9,fontWeight:700,lineHeight:1}}>✓</span>}</div>
              <span style={{color:form[key]?color:"#607080",fontWeight:600,fontSize:12}}>{label}</span>
            </div>
          ))}
        </div>

        {/* Print spec */}
        {form.needsPrint&&(
          <div style={{marginTop:12,padding:14,background:"#0d1a2e",borderRadius:9,border:"1px solid #4f8ef733"}}>
            <div style={{fontSize:11,color:"#4f8ef7",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:10}}>🖨 Print Specifications</div>
            <div style={S.formGrid}>
              <div style={S.fg}><label style={S.label}>Print Type</label><select style={S.input} value={printSpec.type} onChange={e=>setPrintSpec({...printSpec,type:e.target.value})}>{PRINT_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
              <div style={S.fg}><label style={S.label}>Material</label><select style={S.input} value={printSpec.material} onChange={e=>setPrintSpec({...printSpec,material:e.target.value})}>{PRINT_MATS.map(m=><option key={m}>{m}</option>)}</select></div>
              <div style={S.fg}><label style={S.label}>Width (ft)</label><input type="number" style={S.input} value={printSpec.width} onChange={e=>setPrintSpec({...printSpec,width:e.target.value})} placeholder="0"/></div>
              <div style={S.fg}><label style={S.label}>Height (ft)</label><input type="number" style={S.input} value={printSpec.height} onChange={e=>setPrintSpec({...printSpec,height:e.target.value})} placeholder="0"/></div>
              <div style={S.fg}><label style={S.label}>Quantity</label><input type="number" style={S.input} value={printSpec.qty} onChange={e=>setPrintSpec({...printSpec,qty:e.target.value})} placeholder="1"/></div>
              <div style={S.fg}><label style={S.label}>Resolution</label><select style={S.input} value={printSpec.resolution} onChange={e=>setPrintSpec({...printSpec,resolution:e.target.value})}>{["360dpi","720dpi","1080dpi","1440dpi","2880dpi"].map(r=><option key={r}>{r}</option>)}</select></div>
              <div style={{...S.fg,gridColumn:"1/-1"}}><label style={S.label}>Print Notes</label><input style={S.input} value={printSpec.notes} onChange={e=>setPrintSpec({...printSpec,notes:e.target.value})} placeholder="Lamination, finishing, etc."/></div>
            </div>
          </div>
        )}

        {/* Fab spec */}
        {form.needsFabrication&&(
          <div style={{marginTop:12,padding:14,background:"#1a0d00",borderRadius:9,border:"1px solid #ff8c0033"}}>
            <div style={{fontSize:11,color:"#ff8c00",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:10}}>🔧 Fabrication Specifications</div>
            <div style={S.formGrid}>
              <div style={S.fg}><label style={S.label}>Frame Type</label><select style={S.input} value={fabSpec.type} onChange={e=>setFabSpec({...fabSpec,type:e.target.value})}>{FAB_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
              {fabMaterialFields().map(([key,label,opts])=>(
                <div key={key} style={S.fg}><label style={S.label}>{label}</label><select style={S.input} value={fabSpec[key]} onChange={e=>setFabSpec({...fabSpec,[key]:e.target.value})}>{opts.map(o=><option key={o}>{o}</option>)}</select></div>
              ))}
              <div style={S.fg}><label style={S.label}>Width (ft)</label><input type="number" style={S.input} value={fabSpec.width} onChange={e=>setFabSpec({...fabSpec,width:e.target.value})} placeholder="0"/></div>
              <div style={S.fg}><label style={S.label}>Height (ft)</label><input type="number" style={S.input} value={fabSpec.height} onChange={e=>setFabSpec({...fabSpec,height:e.target.value})} placeholder="0"/></div>
              <div style={{...S.fg,gridColumn:"1/-1"}}><label style={S.label}>Fabrication Notes</label><input style={S.input} value={fabSpec.notes} onChange={e=>setFabSpec({...fabSpec,notes:e.target.value})} placeholder="Finish, coating, extra details…"/></div>
            </div>
            <div style={{marginTop:10,padding:"9px 12px",background:"#0d1520",borderRadius:7,fontSize:11,color:"#607080"}}>
              <strong style={{color:"#ff8c00"}}>Auto-creates a fabrication job</strong> in the Fabrication Dept tab for your team.
            </div>
          </div>
        )}

        {/* New client */}
        <div style={{marginTop:12,padding:11,background:"#0d1520",borderRadius:7,display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={toggleNewClient}>
          <input type="checkbox" checked={newClient} readOnly style={{cursor:"pointer"}}/>
          <span style={{color:"#a0b0c8",fontSize:12}}>Also save as new / frequent client</span>
        </div>
        {newClient&&<div style={{...S.formGrid,marginTop:10,padding:12,background:"#0d1520",borderRadius:8,border:"1px solid #1a2535"}}>
          {[["name","Name"],["phone","Phone"],["email","Email"],["gst","GST"],["address","Address"]].map(([k,l])=>(
            <div key={k} style={S.fg}><label style={S.label}>{l}</label><input style={S.input} value={nc[k]} onChange={e=>setNc({...nc,[k]:e.target.value})}/></div>
          ))}
          <div style={S.fg}><label style={{...S.label,display:"flex",alignItems:"center",gap:7,marginTop:26,textTransform:"none",fontSize:11}}><input type="checkbox" checked={nc.monthlyBilling} onChange={e=>setNc({...nc,monthlyBilling:e.target.checked})}/>Monthly billing</label></div>
        </div>}

        <div style={{display:"flex",gap:8,marginTop:16}}>
          <button style={S.submitBtn} onClick={submit}>Create Job →</button>
          <button style={{...S.submitBtn,background:"none",border:"1px solid #2a3545",color:"#607080"}} onClick={()=>{setForm(blank);showToast("Form cleared");}}>Clear</button>
        </div>
      </div>
    </div>
  );
}

// ── Pending Jobs ───────────────────────────────────────────────────
function PendingJobs({jobs,setJobs,showToast}){
  const[search,setSearch]=useState("");
  const[filter,setFilter]=useState("All");
  const[expandedId,setExpandedId]=useState(null);
  const pending=useMemo(()=>{
    let j=jobs.filter(j=>j.stage!=="Delivered");
    if(filter!=="All")j=j.filter(x=>x.orderType===filter);
    if(search)j=j.filter(x=>x.clientName.toLowerCase().includes(search.toLowerCase())||x.orderId.toLowerCase().includes(search.toLowerCase())||x.jobDesc.toLowerCase().includes(search.toLowerCase()));
    return j.sort((a,b)=>daysUntil(a.deadline)-daysUntil(b.deadline));
  },[jobs,search,filter]);
  const red=pending.filter(j=>daysUntil(j.deadline)<=3);
  const yellow=pending.filter(j=>daysUntil(j.deadline)>3&&daysUntil(j.deadline)<=5);
  const green=pending.filter(j=>daysUntil(j.deadline)>5);
  function markDelivered(orderId){setJobs(prev=>prev.map(j=>j.orderId===orderId?{...j,stage:"Delivered",deliveredAt:new Date().toISOString().slice(0,10)}:j));showToast("Delivered ✓");}
  function updateStage(orderId,stage){setJobs(prev=>prev.map(j=>j.orderId===orderId?{...j,stage,...(stage==="Delivered"&&!j.deliveredAt?{deliveredAt:new Date().toISOString().slice(0,10)}:{})}:j));showToast("Stage updated");}
  function updatePaid(orderId,paid){setJobs(prev=>prev.map(j=>j.orderId===orderId?{...j,paid:parseFloat(paid)||0}:j));showToast("Payment updated");}
  function updateDeadline(orderId,dl){setJobs(prev=>prev.map(j=>j.orderId===orderId?{...j,deadline:dl,urgency:autoUrgency(dl)}:j));showToast("Deadline updated");}
  return(
    <div style={S.content}>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input style={{...S.input,maxWidth:240}} placeholder="🔍 Search…" value={search} onChange={e=>setSearch(e.target.value)}/>
        <select style={{...S.input,maxWidth:170}} value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option>{ORDER_TYPES.map(t=><option key={t}>{t}</option>)}</select>
        <div style={{display:"flex",gap:6,marginLeft:"auto",flexWrap:"wrap"}}>
          {[["🔴",red.length,"≤3d"],["🟡",yellow.length,"4-5d"],["🟢",green.length,"6+d"]].map(([e,c,l])=>(
            <span key={l} style={{fontSize:11,background:"#141f2e",padding:"3px 10px",borderRadius:18,color:"#a0b8c8"}}>{e} {c} · {l}</span>
          ))}
        </div>
      </div>
      {[{label:"🔴 URGENT — ≤ 3 days",list:red,border:"#ff3b3b"},{label:"🟡 SOON — 4–5 days",list:yellow,border:"#f5a623"},{label:"🟢 ON TRACK — 6+ days",list:green,border:"#27c27c"}].map(sec=>sec.list.length>0&&(
        <div key={sec.label} style={{...S.card,borderLeft:`4px solid ${sec.border}`,marginBottom:16}}>
          <h3 style={{...S.cardTitle,color:sec.border}}>{sec.label}</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:9}}>
            {sec.list.map(j=><PCard key={j.orderId} job={j} border={sec.border} expanded={expandedId===j.orderId} setExpanded={setExpandedId} markDelivered={markDelivered} updateStage={updateStage} updatePaid={updatePaid} updateDeadline={updateDeadline}/>)}
          </div>
        </div>
      ))}
      {pending.length===0&&<div style={S.empty}>No pending jobs 🎉</div>}
    </div>
  );
}

function PCard({job,border,expanded,setExpanded,markDelivered,updateStage,updatePaid,updateDeadline}){
  const days=daysUntil(job.deadline),due=job.amount-job.paid,imgs=job.images||[];
  return(
    <div style={{background:"#0d1520",borderRadius:9,padding:11,border:"1px solid #1a2535",borderTop:`3px solid ${border}`}}>
      <div onClick={()=>setExpanded(expanded?null:job.orderId)} style={{cursor:"pointer"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
          <span style={S.orderBadge}>{job.orderId}</span>
          <span style={{fontSize:10,background:border+"22",color:border,padding:"2px 7px",borderRadius:10,fontWeight:700}}>{days}d</span>
        </div>
        <div style={{fontWeight:700,color:"#e0e8f5",fontSize:13,marginBottom:2}}>{job.clientName}</div>
        <div style={{fontSize:11,color:"#607080",marginBottom:6,lineHeight:1.3}}>{job.jobDesc}</div>
        {imgs.length>0&&<div style={{display:"flex",gap:3,marginBottom:5}}>{imgs.slice(0,3).map(img=><img key={img.id} src={img.data} alt="" style={{width:32,height:32,borderRadius:4,objectFit:"cover",border:"1px solid #2a3545"}}/>)}{imgs.length>3&&<div style={{width:32,height:32,borderRadius:4,background:"#1a2535",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#607080"}}>+{imgs.length-3}</div>}</div>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
          <span style={{fontSize:9,background:"#1a2a3e",color:"#a0b8ff",padding:"2px 6px",borderRadius:10}}>{job.orderType}</span>
          <span style={{color:due>0?"#ff3b3b":"#27c27c",fontSize:11,fontWeight:600}}>{due>0?"₹"+due.toLocaleString()+" due":"Paid ✓"}</span>
        </div>
        <div style={{display:"flex",gap:3,marginBottom:3}}>
          <span style={{fontSize:9,padding:"2px 6px",borderRadius:10,background:(STAGE_COLORS[job.stage]||"#607080")+"22",color:STAGE_COLORS[job.stage]||"#607080"}}>{job.stage}</span>
          {job.needsPrint&&<span style={{fontSize:9,background:"#4f8ef722",color:"#4f8ef7",padding:"2px 5px",borderRadius:9}}>🖨</span>}
          {job.needsFabrication&&<span style={{fontSize:9,background:"#ff8c0022",color:"#ff8c00",padding:"2px 5px",borderRadius:9}}>🔧</span>}
        </div>
        <div style={{fontSize:9,color:"#304050",textAlign:"center",marginTop:4}}>{expanded?"▲ collapse":"▼ expand"}</div>
      </div>
      {expanded&&(
        <div style={{marginTop:9,paddingTop:9,borderTop:"1px solid #1a2535"}}>
          {imgs.length>0&&<div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:7}}>{imgs.map(img=><img key={img.id} src={img.data} alt="" style={{width:60,height:60,borderRadius:6,objectFit:"cover",border:"1px solid #2a3545"}}/>)}</div>}
          {job.notes&&<div style={{fontSize:10,color:"#607080",marginBottom:6,fontStyle:"italic"}}>📝 {job.notes}</div>}
          <div style={{marginBottom:5}}><label style={{...S.label,marginBottom:2,display:"block"}}>Deadline</label><DatePicker value={job.deadline} onChange={v=>updateDeadline(job.orderId,v)}/></div>
          <div style={{marginBottom:5}}><label style={{...S.label,marginBottom:2,display:"block"}}>Stage</label><select value={job.stage} onChange={e=>updateStage(job.orderId,e.target.value)} style={{...S.miniSelect,width:"100%",padding:"6px 9px"}}>{STAGES.map(s=><option key={s}>{s}</option>)}</select></div>
          <div style={{marginBottom:7}}><label style={{...S.label,marginBottom:2,display:"block"}}>Paid ₹ · Total ₹{job.amount.toLocaleString()}</label><input type="number" style={{...S.input,padding:"6px 9px"}} defaultValue={job.paid} onBlur={e=>updatePaid(job.orderId,e.target.value)}/></div>
          {job.stage!=="Delivered"&&<button style={{width:"100%",background:"#27c27c22",color:"#27c27c",border:"1px solid #27c27c55",borderRadius:5,padding:"7px",fontSize:11,cursor:"pointer",fontWeight:700}} onClick={()=>markDelivered(job.orderId)}>✓ Mark Delivered</button>}
        </div>
      )}
    </div>
  );
}

// ── Print Department ───────────────────────────────────────────────
function PrintDept({printJobs,setPrintJobs,jobs,showToast}){
  const[search,setSearch]=useState("");
  const[stageFilter,setStageFilter]=useState("All");
  const[expandedId,setExpandedId]=useState(null);

  const filtered=useMemo(()=>{
    let j=[...printJobs];
    if(stageFilter!=="All")j=j.filter(x=>x.stage===stageFilter);
    if(search)j=j.filter(x=>x.clientName.toLowerCase().includes(search.toLowerCase())||x.id.toLowerCase().includes(search.toLowerCase())||x.jobDesc.toLowerCase().includes(search.toLowerCase()));
    return j;
  },[printJobs,search,stageFilter]);

  function updateStage(id,stage){setPrintJobs(prev=>prev.map(p=>p.id===id?{...p,stage}:p));showToast("Print stage updated");}

  const stageGroups=PRINT_STAGES.map(s=>({stage:s,jobs:filtered.filter(j=>j.stage===s)}));

  return(
    <div style={S.content}>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input style={{...S.input,maxWidth:230}} placeholder="🔍 Search print jobs…" value={search} onChange={e=>setSearch(e.target.value)}/>
        <select style={{...S.input,maxWidth:180}} value={stageFilter} onChange={e=>setStageFilter(e.target.value)}><option>All</option>{PRINT_STAGES.map(s=><option key={s}>{s}</option>)}</select>
        <div style={{marginLeft:"auto",display:"flex",gap:8,flexWrap:"wrap"}}>
          {[["Queued",printJobs.filter(j=>j.stage==="Queued").length,"#607080"],["Printing",printJobs.filter(j=>j.stage==="Printing").length,"#f5a623"],["Done",printJobs.filter(j=>j.stage==="Done").length,"#27c27c"]].map(([l,c,col])=>(
            <span key={l} style={{fontSize:11,background:col+"22",color:col,padding:"3px 10px",borderRadius:16,fontWeight:700}}>{l}: {c}</span>
          ))}
        </div>
      </div>

      {printJobs.length===0&&<div style={S.empty}>No print jobs yet. They auto-create when a job with "Requires Print" is added.</div>}

      {stageGroups.map(g=>g.jobs.length>0&&(
        <div key={g.stage} style={{...S.card,borderLeft:`4px solid ${PRINT_STAGE_COLORS[g.stage]||"#607080"}`,marginBottom:14}}>
          <h3 style={{...S.cardTitle,color:PRINT_STAGE_COLORS[g.stage]||"#607080"}}>{g.stage} ({g.jobs.length})</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:9}}>
            {g.jobs.map(pj=>{
              const parentJob=jobs.find(j=>j.orderId===pj.orderId);
              const exp=expandedId===pj.id;
              return(
                <div key={pj.id} style={{background:"#0d1520",borderRadius:9,padding:12,border:"1px solid #1a2535",borderTop:`3px solid ${PRINT_STAGE_COLORS[pj.stage]||"#607080"}`}}>
                  <div onClick={()=>setExpandedId(exp?null:pj.id)} style={{cursor:"pointer"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                      <span style={{...S.orderBadge,background:"#0a2a0a",color:"#4fc77f"}}>{pj.id}</span>
                      <span style={{fontSize:9,background:"#1a2a3e",color:"#a0b8ff",padding:"2px 6px",borderRadius:9}}>{pj.orderId}</span>
                    </div>
                    <div style={{fontWeight:700,color:"#e0e8f5",fontSize:12,marginBottom:2}}>{pj.clientName}</div>
                    <div style={{fontSize:10,color:"#607080",marginBottom:6,lineHeight:1.3}}>{pj.jobDesc}</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:5}}>
                      {[["Type",pj.type],["Material",pj.material],["Size",`${pj.width||"?"}×${pj.height||"?"}ft`],["Qty",pj.qty||"1"]].map(([l,v])=>(
                        <div key={l} style={{background:"#1a2535",borderRadius:5,padding:"4px 7px"}}>
                          <div style={{fontSize:8,color:"#405060",fontWeight:700,textTransform:"uppercase"}}>{l}</div>
                          <div style={{fontSize:11,color:"#c8d8e8",fontWeight:600}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {pj.resolution&&<div style={{fontSize:9,color:"#607080",marginBottom:4}}>📐 {pj.resolution}{pj.notes?" · "+pj.notes:""}</div>}
                    <div style={{fontSize:9,color:"#304050",textAlign:"center",marginTop:3}}>{exp?"▲ collapse":"▼ update stage"}</div>
                  </div>
                  {exp&&(
                    <div style={{marginTop:9,paddingTop:9,borderTop:"1px solid #1a2535"}}>
                      {parentJob&&<div style={{marginBottom:7,fontSize:10,color:"#607080"}}>Deadline: <span style={{color:urgencyColor(daysUntil(parentJob.deadline)),fontWeight:700}}>{parentJob.deadline} ({daysUntil(parentJob.deadline)}d)</span></div>}
                      <label style={{...S.label,marginBottom:3,display:"block"}}>Update Stage</label>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>
                        {PRINT_STAGES.map(s=>(
                          <button key={s} onClick={()=>updateStage(pj.id,s)} style={{padding:"4px 9px",borderRadius:6,border:"1px solid "+(pj.stage===s?PRINT_STAGE_COLORS[s]:PRINT_STAGE_COLORS[s]+"44"),background:pj.stage===s?PRINT_STAGE_COLORS[s]+"33":"transparent",color:pj.stage===s?PRINT_STAGE_COLORS[s]:"#607080",fontSize:10,cursor:"pointer",fontWeight:pj.stage===s?700:400}}>{s}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Fabrication Department ─────────────────────────────────────────
function FabDept({fabJobs,setFabJobs,jobs,showToast}){
  const[search,setSearch]=useState("");
  const[stageFilter,setStageFilter]=useState("All");
  const[typeFilter,setTypeFilter]=useState("All");
  const[expandedId,setExpandedId]=useState(null);

  const filtered=useMemo(()=>{
    let j=[...fabJobs];
    if(stageFilter!=="All")j=j.filter(x=>x.stage===stageFilter);
    if(typeFilter!=="All")j=j.filter(x=>x.type===typeFilter);
    if(search)j=j.filter(x=>x.clientName.toLowerCase().includes(search.toLowerCase())||x.id.toLowerCase().includes(search.toLowerCase()));
    return j;
  },[fabJobs,search,stageFilter,typeFilter]);

  function updateStage(id,stage){setFabJobs(prev=>prev.map(f=>f.id===id?{...f,stage}:f));showToast("Fab stage updated");}

  const stageGroups=FAB_STAGES.map(s=>({stage:s,jobs:filtered.filter(j=>j.stage===s)}));

  const specBlock=(fj)=>{
    if(fj.type==="Wooden Frame")return[["Wood",fj.woodType]];
    if(fj.type==="ACP Base")return[["Pipe",fj.pipeSize],["Thick",fj.pipeThick],["ACP",fj.acpThick]];
    return[["Pipe",fj.pipeSize],["Thick",fj.pipeThick]];
  };

  return(
    <div style={S.content}>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <input style={{...S.input,maxWidth:220}} placeholder="🔍 Search fab jobs…" value={search} onChange={e=>setSearch(e.target.value)}/>
        <select style={{...S.input,maxWidth:160}} value={stageFilter} onChange={e=>setStageFilter(e.target.value)}><option>All</option>{FAB_STAGES.map(s=><option key={s}>{s}</option>)}</select>
        <select style={{...S.input,maxWidth:160}} value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option>All</option>{FAB_TYPES.map(t=><option key={t}>{t}</option>)}</select>
        <div style={{marginLeft:"auto",display:"flex",gap:7,flexWrap:"wrap"}}>
          {FAB_TYPES.map(t=>{const cnt=fabJobs.filter(f=>f.type===t).length;return cnt>0&&<span key={t} style={{fontSize:10,background:"#1a2535",padding:"2px 8px",borderRadius:12,color:"#a0b8c8"}}>{t}: {cnt}</span>;}).filter(Boolean)}
        </div>
      </div>

      {fabJobs.length===0&&<div style={S.empty}>No fabrication jobs yet. They auto-create when a job with "Requires Fabrication" is added.</div>}

      {stageGroups.map(g=>g.jobs.length>0&&(
        <div key={g.stage} style={{...S.card,borderLeft:`4px solid ${FAB_STAGE_COLORS[g.stage]||"#607080"}`,marginBottom:14}}>
          <h3 style={{...S.cardTitle,color:FAB_STAGE_COLORS[g.stage]||"#607080"}}>{g.stage} ({g.jobs.length})</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:9}}>
            {g.jobs.map(fj=>{
              const parentJob=jobs.find(j=>j.orderId===fj.orderId);
              const exp=expandedId===fj.id;
              const typeColor={"MS Frame":"#607080","GI Frame":"#4f8ef7","Wooden Frame":"#cd7f32","ACP Base":"#c27ee8","Aluminum Frame":"#a0b8c8","SS Frame":"#c0c8d8"}[fj.type]||"#607080";
              return(
                <div key={fj.id} style={{background:"#0d1520",borderRadius:9,padding:12,border:"1px solid #1a2535",borderTop:`3px solid ${typeColor}`}}>
                  <div onClick={()=>setExpandedId(exp?null:fj.id)} style={{cursor:"pointer"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                      <span style={{...S.orderBadge,background:"#1a0d00",color:"#ff8c00"}}>{fj.id}</span>
                      <span style={{fontSize:9,background:typeColor+"22",color:typeColor,padding:"2px 7px",borderRadius:9,fontWeight:700}}>{fj.type}</span>
                    </div>
                    <div style={{fontWeight:700,color:"#e0e8f5",fontSize:12,marginBottom:2}}>{fj.clientName}</div>
                    <div style={{fontSize:10,color:"#607080",marginBottom:6,lineHeight:1.3}}>{fj.jobDesc}</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:3,marginBottom:5}}>
                      {[["Size",`${fj.width||"?"}×${fj.height||"?"}ft`],...specBlock(fj)].map(([l,v])=>(
                        <div key={l} style={{background:"#1a2535",borderRadius:5,padding:"4px 6px"}}>
                          <div style={{fontSize:8,color:"#405060",fontWeight:700,textTransform:"uppercase"}}>{l}</div>
                          <div style={{fontSize:10,color:"#c8d8e8",fontWeight:600}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {fj.notes&&<div style={{fontSize:9,color:"#607080",marginBottom:3}}>📝 {fj.notes}</div>}
                    <div style={{fontSize:9,color:"#304050",textAlign:"center",marginTop:3}}>{exp?"▲ collapse":"▼ update stage"}</div>
                  </div>
                  {exp&&(
                    <div style={{marginTop:9,paddingTop:9,borderTop:"1px solid #1a2535"}}>
                      {parentJob&&<div style={{marginBottom:7,fontSize:10,color:"#607080"}}>Order: <span style={{color:"#4f8ef7"}}>{fj.orderId}</span> · Deadline: <span style={{color:urgencyColor(daysUntil(parentJob.deadline)),fontWeight:700}}>{parentJob.deadline} ({daysUntil(parentJob.deadline)}d)</span></div>}
                      <label style={{...S.label,marginBottom:3,display:"block"}}>Update Stage</label>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {FAB_STAGES.map(s=>(
                          <button key={s} onClick={()=>updateStage(fj.id,s)} style={{padding:"4px 9px",borderRadius:6,border:"1px solid "+(fj.stage===s?FAB_STAGE_COLORS[s]:FAB_STAGE_COLORS[s]+"44"),background:fj.stage===s?FAB_STAGE_COLORS[s]+"33":"transparent",color:fj.stage===s?FAB_STAGE_COLORS[s]:"#607080",fontSize:10,cursor:"pointer",fontWeight:fj.stage===s?700:400}}>{s}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Clients ────────────────────────────────────────────────────────
function Clients({clients,setClients,jobs,showToast,setBillAlert,billingAlerts,loyaltyGifts}){
  const[search,setSearch]=useState("");
  const[sel,setSel]=useState(null);
  const[editMode,setEditMode]=useState(false);
  const[ef,setEf]=useState({});

  const filtered=clients.filter(c=>(c.name||"").toLowerCase().includes(search.toLowerCase())||(c.custId||"").toLowerCase().includes(search.toLowerCase())||(c.phone||"").includes(search));

  function select(c){setSel({...c});setEf({...c});setEditMode(false);}
  function save(){
    setClients(prev=>prev.map(c=>c.custId===ef.custId?{...ef}:c));
    setSel({...ef});
    setEditMode(false);
    showToast("Client updated");
  }
  const[confirmDel,setConfirmDel]=useState(null);
  function deleteClient(custId){
    if(confirmDel===custId){setClients(prev=>prev.filter(c=>c.custId!==custId));setSel(null);setEf({});setConfirmDel(null);showToast("Client deleted");}
    else{setConfirmDel(custId);setTimeout(()=>setConfirmDel(null),3000);}
  }

  const cjobs=sel?jobs.filter(j=>j.custId===sel.custId):[];
  const totalBiz=cjobs.reduce((s,j)=>s+j.amount,0);
  const totalDue=cjobs.reduce((s,j)=>s+(j.amount-j.paid),0);
  const selAlert=sel?billingAlerts.find(a=>a.client.custId===sel.custId):null;
  const loyalty=sel?getLoyaltyTier(totalBiz):null;
  const loyaltyPoints=sel?(sel.loyaltyPoints||0):0;
  const lastGift=loyaltyGifts.filter(g=>g.points<=loyaltyPoints).pop()||null;
  const nextGift=loyaltyGifts.filter(g=>g.points>loyaltyPoints)[0]||null;

  return(
    <div style={{...S.content,display:"flex",gap:12,flexWrap:"wrap"}}>
      <div style={{width:248,flexShrink:0}}>
        <input style={{...S.input,marginBottom:9}} placeholder="🔍 Search clients…" value={search} onChange={e=>setSearch(e.target.value)}/>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {filtered.map(c=>{
            const alert=billingAlerts.find(a=>a.client.custId===c.custId);
            const t=getLoyaltyTier(jobs.filter(j=>j.custId===c.custId).reduce((s,j)=>s+j.amount,0));
            return(
              <div key={c.custId} onClick={()=>select(c)} style={{background:sel?.custId===c.custId?"#1e3a5f":"#141f2e",border:`1px solid ${alert?"#f5a62344":"#1a2535"}`,borderRadius:7,padding:"10px 12px",cursor:"pointer"}}>
                <div style={{display:"flex",alignItems:"center",gap:5}}><span>{t.icon}</span><span style={{fontWeight:700,color:"#e0e8f5",fontSize:12}}>{c.name}</span></div>
                <div style={{fontSize:10,color:"#607080",marginTop:1}}>{c.custId} · {c.phone}</div>
                <div style={{display:"flex",gap:3,marginTop:4,flexWrap:"wrap"}}>
                  {c.monthlyBilling&&<span style={{fontSize:8,background:"#4f8ef722",color:"#4f8ef7",padding:"1px 5px",borderRadius:7,fontWeight:700}}>Monthly</span>}
                  {alert&&<span style={{fontSize:8,background:"#f5a62322",color:"#f5a623",padding:"1px 5px",borderRadius:7,fontWeight:700}}>🔔 Bill Due</span>}
                  <span style={{fontSize:8,background:t.bg,color:t.color,padding:"1px 5px",borderRadius:7,fontWeight:700}}>{t.tier}</span>
                </div>
              </div>
            );
          })}
          {filtered.length===0&&<div style={{color:"#405060",fontSize:12,padding:8}}>No clients found</div>}
        </div>
      </div>

      <div style={{flex:1,minWidth:280}}>
        {sel?(
          <>
            {selAlert&&(
              <div style={{background:"#130e00",border:"1px solid #f5a62344",borderRadius:8,padding:"9px 12px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:7}}>
                <div><div style={{color:"#f5a623",fontWeight:700,fontSize:12}}>🔔 {selAlert.daysSince} days since last bill</div><div style={{fontSize:10,color:"#607080",marginTop:1}}>{selAlert.unbilledJobs.length} jobs · ₹{selAlert.unbilledAmt.toLocaleString()}</div></div>
                <button onClick={()=>setBillAlert(selAlert)} style={{background:"#f5a62322",color:"#f5a623",border:"1px solid #f5a62344",borderRadius:7,padding:"5px 12px",cursor:"pointer",fontSize:11,fontWeight:700}}>🧾 Make Bill</button>
              </div>
            )}
            <div style={S.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <h3 style={{...S.cardTitle,marginBottom:0}}>{sel.name}</h3>
                <div style={{display:"flex",gap:7}}>
                  <button style={{background:"none",border:"1px solid #4f8ef7",color:"#4f8ef7",borderRadius:6,padding:"4px 11px",cursor:"pointer",fontSize:11}} onClick={()=>setEditMode(!editMode)}>{editMode?"Cancel":"Edit"}</button>
                  <button style={{background:confirmDel===sel.custId?"#ff3b3b22":"none",border:"1px solid "+(confirmDel===sel.custId?"#ff3b3b":"#ff3b3b55"),color:"#ff3b3b",borderRadius:6,padding:"4px 11px",cursor:"pointer",fontSize:11}} onClick={()=>deleteClient(sel.custId)}>{confirmDel===sel.custId?"⚠ Confirm":"Delete"}</button>
                </div>
              </div>

              {!editMode?(
                <>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:12}}>
                    {[["ID",sel.custId],["Phone",sel.phone],["Email",sel.email||"—"],["GST",sel.gst||"—"],["Address",sel.address||"—"],["Last Bill",sel.lastBillDate||"Not set"],["Billing",sel.monthlyBilling?"Monthly":"Per Job"]].map(([l,v])=>(
                      <div key={l} style={{background:"#0d1520",borderRadius:6,padding:"7px 10px"}}>
                        <div style={{fontSize:9,color:"#607080",fontWeight:700,textTransform:"uppercase",letterSpacing:0.4,marginBottom:2}}>{l}</div>
                        <div style={{fontSize:11,color:"#c8d8e8"}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap"}}>
                    {[["Total Biz","₹"+totalBiz.toLocaleString(),"#4f8ef7"],["Outstanding","₹"+totalDue.toLocaleString(),totalDue>0?"#ff3b3b":"#27c27c"],["Orders",cjobs.length,"#f5a623"],["Pending",cjobs.filter(j=>j.stage!=="Delivered").length,"#c27ee8"]].map(([l,v,c])=>(
                      <div key={l} style={{flex:1,minWidth:70,background:"#0d1520",borderRadius:7,padding:"9px",textAlign:"center",borderTop:`2px solid ${c}`}}>
                        <div style={{color:c,fontSize:17,fontWeight:800}}>{v}</div>
                        <div style={{color:"#607080",fontSize:9,marginTop:2}}>{l}</div>
                      </div>
                    ))}
                  </div>
                  {/* Loyalty */}
                  <div style={{background:loyalty.bg,border:`1px solid ${loyalty.color}44`,borderRadius:9,padding:"12px 14px",marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                      <div style={{display:"flex",alignItems:"center",gap:7}}>
                        <span style={{fontSize:20}}>{loyalty.icon}</span>
                        <div>
                          <div style={{color:loyalty.color,fontWeight:800,fontSize:14}}>{loyalty.tier} Member</div>
                          <div style={{color:"#607080",fontSize:10}}>{loyaltyPoints.toLocaleString()} pts · ₹{totalBiz.toLocaleString()} business</div>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}><div style={{fontSize:9,color:"#607080"}}>Points</div><div style={{fontSize:19,fontWeight:800,color:loyalty.color}}>{loyaltyPoints.toLocaleString()}</div></div>
                    </div>
                    {loyalty.next&&<div style={{marginBottom:7}}><div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#607080",marginBottom:2}}><span>Next tier</span><span>₹{totalBiz.toLocaleString()} / ₹{loyalty.next.toLocaleString()}</span></div><div style={{height:5,background:"#1a2535",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min((totalBiz/loyalty.next)*100,100)}%`,background:loyalty.color,borderRadius:3}}/></div></div>}
                    {lastGift&&<div style={{fontSize:10,color:"#27c27c",marginBottom:3}}>{lastGift.icon} Earned: {lastGift.gift}</div>}
                    {nextGift&&<div style={{fontSize:10,color:"#607080"}}>Next: <span style={{color:loyalty.color,fontWeight:600}}>{nextGift.gift}</span> at {nextGift.points.toLocaleString()} pts</div>}
                    <div style={{marginTop:9,display:"flex",gap:7,alignItems:"center"}}>
                      <span style={{fontSize:10,color:"#607080"}}>Points:</span>
                      <input type="number" defaultValue={loyaltyPoints} onBlur={e=>{const p=parseInt(e.target.value)||0;setClients(prev=>prev.map(c=>c.custId===sel.custId?{...c,loyaltyPoints:p}:c));setSel(s=>({...s,loyaltyPoints:p}));showToast("Points updated");}} style={{...S.input,maxWidth:85,padding:"3px 7px",fontSize:11}}/>
                    </div>
                  </div>
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:10,color:"#607080",fontWeight:700,textTransform:"uppercase",marginBottom:5}}>Rewards Chart</div>
                    {loyaltyGifts.map(g=>{const earned=loyaltyPoints>=g.points;return <div key={g.points} style={{display:"flex",alignItems:"center",gap:7,padding:"4px 7px",borderRadius:5,background:earned?"#0a1f0a":"transparent",marginBottom:2}}><span style={{fontSize:12}}>{earned?"✅":"⬜"}</span><span style={{fontSize:11,color:earned?"#27c27c":"#607080",flex:1}}>{g.gift}</span><span style={{fontSize:10,color:earned?"#27c27c":"#405060",fontWeight:700}}>{g.points.toLocaleString()}</span></div>;})}
                  </div>
                </>
              ):(
                <div style={{...S.formGrid,marginBottom:12}}>
                  {[["name","Name"],["phone","Phone"],["email","Email"],["gst","GST"],["address","Address"]].map(([k,l])=>(
                    <div key={k} style={S.fg}><label style={S.label}>{l}</label><input style={S.input} value={ef[k]||""} onChange={e=>setEf(prev=>({...prev,[k]:e.target.value}))}/></div>
                  ))}
                  <div style={S.fg}><label style={S.label}>Last Bill Date</label><DatePicker value={ef.lastBillDate||""} onChange={v=>setEf(prev=>({...prev,lastBillDate:v}))} placeholder="Select date…"/></div>
                  <div style={S.fg}><label style={{...S.label,display:"flex",alignItems:"center",gap:7,marginTop:24,textTransform:"none",fontSize:11}}><input type="checkbox" checked={ef.monthlyBilling||false} onChange={e=>setEf(prev=>({...prev,monthlyBilling:e.target.checked}))}/>Monthly billing</label></div>
                  <div style={{gridColumn:"1/-1"}}><button style={S.submitBtn} onClick={save}>Save Changes</button></div>
                </div>
              )}

              <h4 style={{fontSize:12,fontWeight:700,color:"#e0e8f5",marginBottom:9}}>Job History ({cjobs.length})</h4>
              <div style={{overflowX:"auto"}}>
                <table style={S.table}>
                  <thead><tr>{["Order","Desc","Type","Stage","Amount","Due"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>{cjobs.map(j=>{const due=j.amount-j.paid;return <tr key={j.orderId} style={S.tr}>
                    <td style={S.td}><span style={S.orderBadge}>{j.orderId}</span></td>
                    <td style={S.td}>{j.jobDesc}</td>
                    <td style={S.td}><span style={{fontSize:10,background:"#1a2a3e",color:"#a0b8ff",padding:"2px 6px",borderRadius:10}}>{j.orderType}</span></td>
                    <td style={S.td}><span style={{fontSize:10,padding:"2px 6px",borderRadius:10,background:(STAGE_COLORS[j.stage]||"#607080")+"22",color:STAGE_COLORS[j.stage]||"#607080"}}>{j.stage}</span></td>
                    <td style={S.td}>₹{j.amount.toLocaleString()}</td>
                    <td style={{...S.td,color:due>0?"#ff3b3b":"#27c27c",fontWeight:700}}>{due>0?"₹"+due.toLocaleString():"Paid ✓"}</td>
                  </tr>;})}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ):(
          <div style={S.empty}>← Select a client to view details</div>
        )}
      </div>
    </div>
  );
}

// ── Billing ────────────────────────────────────────────────────────
function Billing({jobs,clients,billingAlerts,setBillAlert}){
  const bNow=new Date();
  const[bMo,setBMo]=useState(String(bNow.getMonth()+1).padStart(2,"0"));
  const[bYr,setBYr]=useState(String(bNow.getFullYear()));
  const month=bYr+"-"+bMo;
  const[clientFilter,setClientFilter]=useState("All");
  const filtered=useMemo(()=>{let j=jobs.filter(j=>(j.createdAt||"").slice(0,7)===month);if(clientFilter!=="All")j=j.filter(x=>x.custId===clientFilter);return j;},[jobs,month,clientFilter]);
  const totAmt=filtered.reduce((s,j)=>s+j.amount,0),totPaid=filtered.reduce((s,j)=>s+j.paid,0);
  const bYears=["2024","2025","2026","2027","2028","2029","2030"];
  function exportCSV(){try{const rows=[["Order","Client","Desc","Type","Date","Amount","Paid","Due","Stage"],...filtered.map(j=>[j.orderId,j.clientName,j.jobDesc,j.orderType,j.createdAt,j.amount,j.paid,j.amount-j.paid,j.stage])];const text=rows.map(r=>r.join(",")).join("\n");const blob=new Blob([text],{type:"text/csv"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="billing.csv";document.body.appendChild(a);a.click();document.body.removeChild(a);}catch(e){}}
  return(
    <div style={S.content}>
      {billingAlerts.length>0&&<div style={{...S.card,borderLeft:"4px solid #f5a623",background:"#130e00",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8}}><span>🔔</span><span style={{fontWeight:700,color:"#f5a623",fontSize:12}}>Clients Due for Monthly Bill</span></div>
        {billingAlerts.map(a=><div key={a.client.custId} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#0d1520",borderRadius:7,padding:"7px 11px",marginBottom:4,flexWrap:"wrap",gap:6}}>
          <span style={{fontWeight:600,color:"#e0e8f5",fontSize:12}}>{a.client.name} <span style={{color:"#ff3b3b",fontSize:10}}>· {a.daysSince}d</span> · {a.unbilledJobs.length} jobs · ₹{a.unbilledAmt.toLocaleString()}</span>
          <button onClick={()=>setBillAlert(a)} style={{background:"#f5a62322",color:"#f5a623",border:"1px solid #f5a62344",borderRadius:6,padding:"4px 11px",cursor:"pointer",fontSize:11,fontWeight:700}}>🧾 Bill</button>
        </div>)}
      </div>}
      <div style={S.card}>
        <div style={{display:"flex",gap:9,flexWrap:"wrap",marginBottom:16,alignItems:"flex-end"}}>
          <div style={S.fg}><label style={S.label}>Month</label><div style={{display:"flex",gap:4}}><select style={{...S.input,flex:1}} value={bMo} onChange={e=>setBMo(e.target.value)}>{MONTHS.map((mn,i)=><option key={mn} value={String(i+1).padStart(2,"0")}>{mn.slice(0,3)}</option>)}</select><select style={{...S.input,width:80}} value={bYr} onChange={e=>setBYr(e.target.value)}>{bYears.map(yr=><option key={yr} value={yr}>{yr}</option>)}</select></div></div>
          <div style={S.fg}><label style={S.label}>Client</label><select style={{...S.input,maxWidth:200}} value={clientFilter} onChange={e=>setClientFilter(e.target.value)}><option value="All">All Clients</option>{clients.map(c=><option key={c.custId} value={c.custId}>{c.name}</option>)}</select></div>
          <button onClick={exportCSV} style={{...S.submitBtn,background:"#1a2a3e",color:"#4f8ef7",border:"1px solid #4f8ef744"}}>⬇ CSV</button>
        </div>
        <div style={S.kpiRow}>
          {[["Invoiced","₹"+totAmt.toLocaleString(),"#4f8ef7"],["Collected","₹"+totPaid.toLocaleString(),"#27c27c"],["Outstanding","₹"+(totAmt-totPaid).toLocaleString(),(totAmt-totPaid)>0?"#ff3b3b":"#27c27c"],["Jobs",filtered.length,"#f5a623"]].map(([l,v,c])=>(
            <div key={l} style={{...S.kpiCard,borderTop:`3px solid ${c}`}}><span style={{fontSize:18,fontWeight:800,color:c}}>{v}</span><span style={{fontSize:10,color:"#607080"}}>{l}</span></div>
          ))}
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={S.table}><thead><tr>{["Order","Client","Description","Type","Amount","Paid","Due","Stage"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{filtered.map(j=>{const due=j.amount-j.paid;return <tr key={j.orderId} style={S.tr}><td style={S.td}><span style={S.orderBadge}>{j.orderId}</span></td><td style={S.td}>{j.clientName}</td><td style={S.td}>{j.jobDesc}</td><td style={S.td}><span style={{fontSize:10,background:"#1a2a3e",color:"#a0b8ff",padding:"2px 6px",borderRadius:10}}>{j.orderType}</span></td><td style={S.td}>₹{j.amount.toLocaleString()}</td><td style={{...S.td,color:"#27c27c"}}>₹{j.paid.toLocaleString()}</td><td style={{...S.td,color:due>0?"#ff3b3b":"#27c27c",fontWeight:700}}>{due>0?"₹"+due.toLocaleString():"Paid ✓"}</td><td style={S.td}><span style={{fontSize:10,padding:"2px 6px",borderRadius:10,background:(STAGE_COLORS[j.stage]||"#607080")+"22",color:STAGE_COLORS[j.stage]||"#607080"}}>{j.stage}</span></td></tr>;})}
          </tbody></table>
        </div>
        {filtered.length===0&&<div style={S.empty}>No jobs this period.</div>}
      </div>
    </div>
  );
}

// ── Payments ───────────────────────────────────────────────────────
function Payments({jobs,setJobs,clients,paymentAlerts,showToast}){
  const[expandedId,setExpandedId]=useState(null);
  function updatePaid(orderId,paid){setJobs(prev=>prev.map(j=>j.orderId===orderId?{...j,paid:parseFloat(paid)||0}:j));showToast("Payment updated");}
  const red=paymentAlerts.filter(x=>x.payLevel==="red");
  const orange=paymentAlerts.filter(x=>x.payLevel==="orange");
  const yellow=paymentAlerts.filter(x=>x.payLevel==="yellow");
  const levelConfig=[{label:"🔴 Critical — 10+ days",list:red,color:"#ff3b3b"},{label:"🟠 Overdue — 5–10 days",list:orange,color:"#ff8c00"},{label:"🟡 Due — 3–5 days",list:yellow,color:"#f5a623"}];
  if(paymentAlerts.length===0)return <div style={S.content}><div style={S.empty}>🎉 No overdue payments!</div></div>;
  return(
    <div style={S.content}>
      <div style={S.kpiRow}>
        {[["Critical",red.length,"#ff3b3b"],["Overdue",orange.length,"#ff8c00"],["Due",yellow.length,"#f5a623"],["Outstanding","₹"+paymentAlerts.reduce((s,j)=>s+(j.amount-j.paid),0).toLocaleString(),"#c27ee8"]].map(([l,v,c])=>(
          <div key={l} style={{...S.kpiCard,borderTop:`3px solid ${c}`}}><span style={{fontSize:18,fontWeight:800,color:c}}>{v}</span><span style={{fontSize:10,color:"#607080"}}>{l}</span></div>
        ))}
      </div>
      {levelConfig.map(sec=>sec.list.length>0&&(
        <div key={sec.label} style={{...S.card,borderLeft:`4px solid ${sec.color}`,marginBottom:14}}>
          <h3 style={{...S.cardTitle,color:sec.color}}>{sec.label}</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))",gap:9}}>
            {sec.list.map(j=>{const due=j.amount-j.paid,exp=expandedId===j.orderId;return(
              <div key={j.orderId} style={{background:"#0d1520",borderRadius:9,padding:11,border:"1px solid #1a2535",borderTop:`3px solid ${sec.color}`}}>
                <div onClick={()=>setExpandedId(exp?null:j.orderId)} style={{cursor:"pointer"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={S.orderBadge}>{j.orderId}</span>
                    <span style={{fontSize:9,background:sec.color+"22",color:sec.color,padding:"2px 7px",borderRadius:9,fontWeight:700}}>{j.daysAfterDelivery}d overdue</span>
                  </div>
                  <div style={{fontWeight:700,color:"#e0e8f5",fontSize:12,marginBottom:2}}>{j.clientName}</div>
                  <div style={{fontSize:10,color:"#607080",marginBottom:5}}>{j.jobDesc}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:9,background:"#1a2a3e",color:"#a0b8ff",padding:"2px 6px",borderRadius:10}}>{j.orderType}</span><span style={{color:"#ff3b3b",fontSize:12,fontWeight:800}}>₹{due.toLocaleString()}</span></div>
                  <div style={{fontSize:9,color:"#304050",textAlign:"center",marginTop:4}}>{exp?"▲":"▼ update payment"}</div>
                </div>
                {exp&&<div style={{marginTop:8,paddingTop:8,borderTop:"1px solid #1a2535"}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#607080",marginBottom:3}}><span>Total: ₹{j.amount.toLocaleString()}</span><span>Paid: ₹{j.paid.toLocaleString()}</span></div>
                  <input type="number" style={{...S.input,padding:"6px 9px",marginBottom:6}} defaultValue={j.paid} onBlur={e=>updatePaid(j.orderId,e.target.value)}/>
                  <div style={{fontSize:9,color:"#405060"}}>Delivered: {j.deliveredAt||j.deadline}</div>
                </div>}
              </div>
            );})}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Reports ────────────────────────────────────────────────────────
function Reports({jobs,clients,fabJobs,printJobs}){
  const[reportTab,setReportTab]=useState("overview");
  const[period,setPeriod]=useState("month");
  const rNow=new Date();
  const[rMo,setRMo]=useState(String(rNow.getMonth()+1).padStart(2,"0"));
  const[rYr,setRYr]=useState(String(rNow.getFullYear()));
  const month=rYr+"-"+rMo;
  const[clientFilter,setClientFilter]=useState("All");
  const[customStart,setCustomStart]=useState("");
  const[customEnd,setCustomEnd]=useState("");
  const rYears=["2024","2025","2026","2027","2028","2029","2030"];

  const filtered=useMemo(()=>{
    let j=jobs;
    if(clientFilter!=="All")j=j.filter(x=>x.custId===clientFilter);
    const now=new Date();
    if(period==="month")j=j.filter(x=>(x.createdAt||"").slice(0,7)===month);
    else if(period==="quarter"){const q=new Date(now);q.setMonth(q.getMonth()-3);j=j.filter(x=>new Date(x.createdAt)>=q);}
    else if(period==="year"){const y=new Date(now);y.setFullYear(y.getFullYear()-1);j=j.filter(x=>new Date(x.createdAt)>=y);}
    else if(period==="custom"&&customStart&&customEnd)j=j.filter(x=>x.createdAt>=customStart&&x.createdAt<=customEnd);
    return j;
  },[jobs,period,month,clientFilter,customStart,customEnd]);

  const totalRev=filtered.reduce((s,j)=>s+j.amount,0);
  const totalCollected=filtered.reduce((s,j)=>s+j.paid,0);
  const totalDue=totalRev-totalCollected;
  const collRate=totalRev>0?Math.round((totalCollected/totalRev)*100):0;

  const byType=ORDER_TYPES.map(t=>({type:t,count:filtered.filter(j=>j.orderType===t).length,rev:filtered.filter(j=>j.orderType===t).reduce((s,j)=>s+j.amount,0)})).filter(x=>x.count>0).sort((a,b)=>b.rev-a.rev);
  const byStage=STAGES.map(s=>({stage:s,count:filtered.filter(j=>j.stage===s).length,color:STAGE_COLORS[s]})).filter(x=>x.count>0);
  const byClient=clients.map(c=>{const cj=filtered.filter(j=>j.custId===c.custId);return{name:c.name,custId:c.custId,jobs:cj.length,rev:cj.reduce((s,j)=>s+j.amount,0),due:cj.reduce((s,j)=>s+(j.amount-j.paid),0)};}).filter(x=>x.jobs>0).sort((a,b)=>b.rev-a.rev);
  const maxRev=Math.max(...byClient.map(x=>x.rev),1);
  const maxTypeRev=Math.max(...byType.map(x=>x.rev),1);

  // Department-specific data
  const byPrintType=PRINT_TYPES.map(t=>({type:t,count:printJobs.filter(p=>p.type===t).length})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count);
  const byPrintMat=PRINT_MATS.map(m=>({mat:m,count:printJobs.filter(p=>p.material===m).length})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count);
  const maxPrint=Math.max(...byPrintType.map(x=>x.count),1);
  const maxMat=Math.max(...byPrintMat.map(x=>x.count),1);
  const byFabType=FAB_TYPES.map(t=>({type:t,count:fabJobs.filter(f=>f.type===t).length})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count);
  const maxFab=Math.max(...byFabType.map(x=>x.count),1);
  const byFabStage=FAB_STAGES.map(s=>({stage:s,count:fabJobs.filter(f=>f.stage===s).length,color:FAB_STAGE_COLORS[s]})).filter(x=>x.count>0);
  const maxFabStage=Math.max(...byFabStage.map(x=>x.count),1);

  function exportReport(){
    try{const rows=[["PrintFlow Report"],["Period: "+period],["Client: "+clientFilter],[""],["SUMMARY"],["Revenue",totalRev],["Collected",totalCollected],["Outstanding",totalDue],["Collection %",collRate+"%"],[""],["BY TYPE"],["Type","Jobs","Revenue"],...byType.map(x=>[x.type,x.count,x.rev]),[""],["CLIENTS"],["Client","Jobs","Revenue","Due"],...byClient.map(x=>[x.name,x.jobs,x.rev,x.due])];const text=rows.map(r=>r.join(",")).join("\n");const blob=new Blob([text],{type:"text/csv"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="report.csv";document.body.appendChild(a);a.click();document.body.removeChild(a);}catch(e){}
  }

  const reportTabs=[{id:"overview",label:"📊 Overview"},{id:"product",label:"🏷 Product"},{id:"print",label:"🖨 Print Dept"},{id:"fab",label:"🔧 Fabrication"},{id:"client",label:"👤 Client View"}];

  return(
    <div style={S.content}>
      {/* Sub-tabs */}
      <div style={{display:"flex",gap:5,marginBottom:16,flexWrap:"wrap"}}>
        {reportTabs.map(t=><button key={t.id} onClick={()=>setReportTab(t.id)} style={{padding:"7px 14px",borderRadius:8,border:"1px solid "+(reportTab===t.id?"#4f8ef7":"#1a2535"),background:reportTab===t.id?"#1e3a5f":"#0d1520",color:reportTab===t.id?"#4f8ef7":"#607080",fontSize:12,cursor:"pointer",fontWeight:reportTab===t.id?700:400}}>{t.label}</button>)}
      </div>

      {/* Filters (for overview / product / client tabs) */}
      {reportTab!=="print"&&reportTab!=="fab"&&(
        <div style={{...S.card,marginBottom:14}}>
          <div style={{display:"flex",gap:9,flexWrap:"wrap",alignItems:"flex-end"}}>
            <div style={S.fg}><label style={S.label}>Period</label><select style={{...S.input,maxWidth:150}} value={period} onChange={e=>setPeriod(e.target.value)}><option value="month">By Month</option><option value="quarter">Last 3 Months</option><option value="year">Last 12 Months</option><option value="all">All Time</option><option value="custom">Custom Range</option></select></div>
            {period==="month"&&<div style={S.fg}><label style={S.label}>Month</label><div style={{display:"flex",gap:4}}><select style={{...S.input,flex:1}} value={rMo} onChange={e=>setRMo(e.target.value)}>{MONTHS.map((mn,i)=><option key={mn} value={String(i+1).padStart(2,"0")}>{mn.slice(0,3)}</option>)}</select><select style={{...S.input,width:80}} value={rYr} onChange={e=>setRYr(e.target.value)}>{rYears.map(yr=><option key={yr} value={yr}>{yr}</option>)}</select></div></div>}
            {period==="custom"&&<><div style={S.fg}><label style={S.label}>From</label><DatePicker value={customStart} onChange={setCustomStart}/></div><div style={S.fg}><label style={S.label}>To</label><DatePicker value={customEnd} onChange={setCustomEnd}/></div></>}
            {reportTab==="client"&&<div style={S.fg}><label style={S.label}>Client</label><select style={{...S.input,maxWidth:190}} value={clientFilter} onChange={e=>setClientFilter(e.target.value)}><option value="All">All Clients</option>{clients.map(c=><option key={c.custId} value={c.custId}>{c.name}</option>)}</select></div>}
            <button onClick={exportReport} style={{...S.submitBtn,background:"#1a2a3e",color:"#4f8ef7",border:"1px solid #4f8ef744"}}>⬇ Export</button>
          </div>
        </div>
      )}

      {/* ── Overview ── */}
      {reportTab==="overview"&&(
        <>
          <div style={S.kpiRow}>
            {[{l:"Jobs",v:filtered.length,c:"#4f8ef7"},{l:"Delivered",v:filtered.filter(j=>j.stage==="Delivered").length,c:"#27c27c"},{l:"Revenue",v:"₹"+totalRev.toLocaleString(),c:"#4f8ef7"},{l:"Collected",v:"₹"+totalCollected.toLocaleString(),c:"#27c27c"},{l:"Outstanding",v:"₹"+totalDue.toLocaleString(),c:totalDue>0?"#ff3b3b":"#27c27c"},{l:"Collection %",v:collRate+"%",c:collRate>=80?"#27c27c":collRate>=50?"#f5a623":"#ff3b3b"}].map(k=>(
              <div key={k.l} style={{...S.kpiCard,borderTop:`3px solid ${k.c}`,flex:"1 1 110px"}}><span style={{fontSize:18,fontWeight:800,color:k.c}}>{k.v}</span><span style={{fontSize:9,color:"#607080"}}>{k.l}</span></div>
            ))}
          </div>
          <div style={{...S.card,marginBottom:12}}>
            <h3 style={S.cardTitle}>Collection Rate</h3>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:12,color:"#c8d8e8"}}>Payment Collection</span><span style={{fontSize:12,fontWeight:700,color:collRate>=80?"#27c27c":collRate>=50?"#f5a623":"#ff3b3b"}}>{collRate}%</span></div>
            <div style={{height:11,background:"#1a2535",borderRadius:5,overflow:"hidden"}}><div style={{height:"100%",width:`${collRate}%`,background:collRate>=80?"#27c27c":collRate>=50?"#f5a623":"#ff3b3b",borderRadius:5}}/></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={S.card}><h3 style={S.cardTitle}>Jobs by Stage</h3>{byStage.map(x=><div key={x.stage} style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:11,color:"#c8d8e8"}}>{x.stage}</span><span style={{fontSize:10,color:x.color,fontWeight:700}}>{x.count}</span></div><div style={{height:6,background:"#1a2535",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${(x.count/Math.max(...byStage.map(s=>s.count),1))*100}%`,background:x.color,borderRadius:3}}/></div></div>)}</div>
            <div style={S.card}><h3 style={S.cardTitle}>Urgency</h3>{["Low","Medium","High","Critical"].map(u=>{const cnt=filtered.filter(j=>j.urgency===u).length;const c={"Low":"#27c27c","Medium":"#f5a623","High":"#ff8c00","Critical":"#ff3b3b"}[u];return <div key={u} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #1a2535"}}><span style={{fontSize:12,color:"#c8d8e8"}}>{u}</span><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:60,height:6,background:"#1a2535",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${cnt?Math.max((cnt/filtered.length)*100,5):0}%`,background:c,borderRadius:3}}/></div><span style={{fontSize:12,fontWeight:700,color:c,minWidth:16,textAlign:"right"}}>{cnt}</span></div></div>;})}</div>
          </div>
        </>
      )}

      {/* ── Product Report ── */}
      {reportTab==="product"&&(
        <>
          <div style={S.card}>
            <h3 style={S.cardTitle}>Revenue by Product Type</h3>
            {byType.map(x=>(
              <div key={x.type} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:12,color:"#c8d8e8"}}>{x.type}</span>
                  <div style={{display:"flex",gap:10}}><span style={{fontSize:11,color:"#607080"}}>{x.count} jobs</span><span style={{fontSize:11,color:"#4f8ef7",fontWeight:700}}>₹{x.rev.toLocaleString()}</span></div>
                </div>
                <div style={{height:8,background:"#1a2535",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:`${(x.rev/maxTypeRev)*100}%`,background:"#4f8ef7",borderRadius:4}}/></div>
              </div>
            ))}
          </div>
          <div style={S.card}>
            <h3 style={S.cardTitle}>Product Volume (Jobs Count)</h3>
            {byType.map(x=>(
              <div key={x.type} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:12,color:"#c8d8e8"}}>{x.type}</span>
                  <span style={{fontSize:11,color:"#f5a623",fontWeight:700}}>{x.count} orders</span>
                </div>
                <div style={{height:8,background:"#1a2535",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:`${(x.count/Math.max(...byType.map(t=>t.count),1))*100}%`,background:"#f5a623",borderRadius:4}}/></div>
              </div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={S.card}><h3 style={S.cardTitle}>Top by Revenue</h3>{byType.slice(0,5).map((x,i)=><div key={x.type} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #1a2535"}}><div style={{display:"flex",alignItems:"center",gap:7}}><span style={{fontSize:10,background:"#1a2a3e",color:"#4f8ef7",padding:"1px 6px",borderRadius:9,fontWeight:700}}>#{i+1}</span><span style={{fontSize:11,color:"#e0e8f5"}}>{x.type}</span></div><span style={{fontSize:11,color:"#4f8ef7",fontWeight:700}}>₹{x.rev.toLocaleString()}</span></div>)}</div>
            <div style={S.card}><h3 style={S.cardTitle}>Top by Volume</h3>{[...byType].sort((a,b)=>b.count-a.count).slice(0,5).map((x,i)=><div key={x.type} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #1a2535"}}><div style={{display:"flex",alignItems:"center",gap:7}}><span style={{fontSize:10,background:"#1a2a3e",color:"#f5a623",padding:"1px 6px",borderRadius:9,fontWeight:700}}>#{i+1}</span><span style={{fontSize:11,color:"#e0e8f5"}}>{x.type}</span></div><span style={{fontSize:11,color:"#f5a623",fontWeight:700}}>{x.count} orders</span></div>)}</div>
          </div>
        </>
      )}

      {/* ── Print Dept Report ── */}
      {reportTab==="print"&&(
        <>
          <div style={S.kpiRow}>
            {[["Total Print Jobs",(printJobs||[]).length,"#4f8ef7"],["In Queue",(printJobs||[]).filter(p=>p.stage==="Queued").length,"#607080"],["Printing",(printJobs||[]).filter(p=>p.stage==="Printing").length,"#f5a623"],["Done",(printJobs||[]).filter(p=>p.stage==="Done").length,"#27c27c"]].map(([l,v,c])=>(
              <div key={l} style={{...S.kpiCard,borderTop:`3px solid ${c}`}}><span style={{fontSize:18,fontWeight:800,color:c}}>{v}</span><span style={{fontSize:9,color:"#607080"}}>{l}</span></div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={S.card}><h3 style={S.cardTitle}>By Print Type</h3>{byPrintType.map(x=><div key={x.type} style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:11,color:"#c8d8e8"}}>{x.type}</span><span style={{fontSize:10,color:"#4f8ef7",fontWeight:700}}>{x.count}</span></div><div style={{height:6,background:"#1a2535",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${(x.count/maxPrint)*100}%`,background:"#4f8ef7",borderRadius:3}}/></div></div>)}{byPrintType.length===0&&<div style={{color:"#405060",fontSize:12}}>No print jobs yet</div>}</div>
            <div style={S.card}><h3 style={S.cardTitle}>By Material</h3>{byPrintMat.map(x=><div key={x.mat} style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:11,color:"#c8d8e8"}}>{x.mat}</span><span style={{fontSize:10,color:"#c27ee8",fontWeight:700}}>{x.count}</span></div><div style={{height:6,background:"#1a2535",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${(x.count/maxMat)*100}%`,background:"#c27ee8",borderRadius:3}}/></div></div>)}{byPrintMat.length===0&&<div style={{color:"#405060",fontSize:12}}>No data</div>}</div>
          </div>
          <div style={S.card}><h3 style={S.cardTitle}>Print Queue Status</h3><div style={{display:"flex",gap:9,flexWrap:"wrap"}}>{PRINT_STAGES.map(s=>{const cnt=(printJobs||[]).filter(p=>p.stage===s).length;return <div key={s} style={{flex:1,minWidth:80,background:"#0d1520",borderRadius:8,padding:"10px",textAlign:"center",borderTop:`2px solid ${PRINT_STAGE_COLORS[s]||"#607080"}`}}><div style={{fontSize:20,fontWeight:800,color:PRINT_STAGE_COLORS[s]||"#607080"}}>{cnt}</div><div style={{fontSize:9,color:"#607080",marginTop:2,lineHeight:1.3}}>{s}</div></div>;})}</div></div>
        </>
      )}

      {/* ── Fabrication Dept Report ── */}
      {reportTab==="fab"&&(
        <>
          <div style={S.kpiRow}>
            {[["Total Fab Jobs",(fabJobs||[]).length,"#ff8c00"],["Pending",(fabJobs||[]).filter(f=>f.stage==="Pending").length,"#607080"],["In Fabrication",(fabJobs||[]).filter(f=>f.stage==="In Fabrication").length,"#f5a623"],["Ready",(fabJobs||[]).filter(f=>f.stage==="Ready").length,"#27c27c"]].map(([l,v,c])=>(
              <div key={l} style={{...S.kpiCard,borderTop:`3px solid ${c}`}}><span style={{fontSize:18,fontWeight:800,color:c}}>{v}</span><span style={{fontSize:9,color:"#607080"}}>{l}</span></div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={S.card}><h3 style={S.cardTitle}>By Frame Type</h3>{byFabType.map(x=><div key={x.type} style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:11,color:"#c8d8e8"}}>{x.type}</span><span style={{fontSize:10,color:"#ff8c00",fontWeight:700}}>{x.count}</span></div><div style={{height:6,background:"#1a2535",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${(x.count/maxFab)*100}%`,background:"#ff8c00",borderRadius:3}}/></div></div>)}{byFabType.length===0&&<div style={{color:"#405060",fontSize:12}}>No fab jobs yet</div>}</div>
            <div style={S.card}><h3 style={S.cardTitle}>By Stage</h3>{byFabStage.map(x=><div key={x.stage} style={{marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}><span style={{fontSize:11,color:"#c8d8e8"}}>{x.stage}</span><span style={{fontSize:10,color:x.color,fontWeight:700}}>{x.count}</span></div><div style={{height:6,background:"#1a2535",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${(x.count/maxFabStage)*100}%`,background:x.color,borderRadius:3}}/></div></div>)}{byFabStage.length===0&&<div style={{color:"#405060",fontSize:12}}>No data</div>}</div>
          </div>
          <div style={S.card}><h3 style={S.cardTitle}>Fabrication Stage Overview</h3><div style={{display:"flex",gap:9,flexWrap:"wrap"}}>{FAB_STAGES.map(s=>{const cnt=(fabJobs||[]).filter(f=>f.stage===s).length;return <div key={s} style={{flex:1,minWidth:80,background:"#0d1520",borderRadius:8,padding:"10px",textAlign:"center",borderTop:`2px solid ${FAB_STAGE_COLORS[s]||"#607080"}`}}><div style={{fontSize:20,fontWeight:800,color:FAB_STAGE_COLORS[s]||"#607080"}}>{cnt}</div><div style={{fontSize:9,color:"#607080",marginTop:2,lineHeight:1.3}}>{s}</div></div>;})}</div></div>
          {/* Pipe size usage */}
          <div style={S.card}><h3 style={S.cardTitle}>Pipe / Material Usage</h3>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div><div style={{fontSize:11,color:"#607080",fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Pipe Sizes Used</div>{PIPE_SIZES.map(p=>{const cnt=(fabJobs||[]).filter(f=>f.pipeSize===p).length;return cnt>0&&<div key={p} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #1a2535"}}><span style={{fontSize:11,color:"#c8d8e8"}}>{p}</span><span style={{fontSize:11,color:"#ff8c00",fontWeight:700}}>{cnt}×</span></div>;}).filter(Boolean)}</div>
              <div><div style={{fontSize:11,color:"#607080",fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Pipe Thickness</div>{PIPE_THICK.map(t=>{const cnt=(fabJobs||[]).filter(f=>f.pipeThick===t).length;return cnt>0&&<div key={t} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #1a2535"}}><span style={{fontSize:11,color:"#c8d8e8"}}>{t}</span><span style={{fontSize:11,color:"#c27ee8",fontWeight:700}}>{cnt}×</span></div>;}).filter(Boolean)}</div>
            </div>
          </div>
        </>
      )}

      {/* ── Client View ── */}
      {reportTab==="client"&&(
        <>
          {clientFilter!=="All"&&<ClientReportCard clients={clients} filtered={filtered} clientFilter={clientFilter}/>}
          {clientFilter==="All"&&(
            <div style={S.card}>
              <h3 style={S.cardTitle}>All Clients — Revenue Ranking</h3>
              {byClient.map((x,i)=>(
                <div key={x.custId} style={{marginBottom:11}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,alignItems:"center",flexWrap:"wrap",gap:5}}>
                    <div style={{display:"flex",alignItems:"center",gap:7}}><span style={{fontSize:10,background:"#1a2a3e",color:"#4f8ef7",padding:"1px 7px",borderRadius:10,fontWeight:700}}>#{i+1}</span><span style={{fontSize:12,color:"#e0e8f5",fontWeight:600}}>{x.name}</span><span style={{fontSize:10,color:"#607080"}}>{x.jobs} job{x.jobs>1?"s":""}</span></div>
                    <div style={{display:"flex",gap:10}}><span style={{fontSize:11,color:"#4f8ef7",fontWeight:700}}>₹{x.rev.toLocaleString()}</span>{x.due>0?<span style={{fontSize:11,color:"#ff3b3b",fontWeight:700}}>₹{x.due.toLocaleString()} due</span>:<span style={{fontSize:11,color:"#27c27c"}}>Paid ✓</span>}</div>
                  </div>
                  <div style={{height:7,background:"#1a2535",borderRadius:3,overflow:"hidden",display:"flex"}}>
                    <div style={{width:`${(x.rev-x.due)/maxRev*100}%`,background:"#27c27c"}}/><div style={{width:`${x.due/maxRev*100}%`,background:"#ff3b3b55"}}/>
                  </div>
                </div>
              ))}
              {byClient.length===0&&<div style={{color:"#405060",fontSize:12}}>No data for this period</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────
function Settings({loyaltyGifts,setLoyaltyGifts,showToast}){
  const[gifts,setGifts]=useState(()=>loyaltyGifts.map(g=>({...g})));
  const[saving,setSaving]=useState(false);
  const icons=["🎁","🖨","🎪","🏳","💸","💡","🎯","🏆","⭐","💎","🎉","🛍"];

  const updateGift=(idx,field,val)=>{
    setGifts(prev=>prev.map((g,i)=>i===idx?{...g,[field]:field==="points"?parseInt(val)||0:val}:g));
  };
  const addGift=()=>{
    setGifts(prev=>[...prev,{points:0,gift:"",icon:"🎁"}].sort((a,b)=>a.points-b.points));
  };
  const removeGift=(idx)=>{
    if(gifts.length<=1) return;
    setGifts(prev=>prev.filter((_,i)=>i!==idx));
  };
  const saveGifts=async ()=>{
    const sorted=[...gifts].filter(g=>g.points>0&&g.gift).sort((a,b)=>a.points-b.points);
    if(sorted.length===0){showToast("Add at least one reward","error"); return;}
    setSaving(true);
    try{
      const{saveSettings}=await import("./supabase.js");
      await saveSettings("loyalty_gifts",sorted);
      setLoyaltyGifts(sorted);
      setGifts(sorted.map(g=>({...g})));
      showToast("Rewards saved!");
    }catch(e){showToast("Save failed","error");}
    setSaving(false);
  };
  const resetDefaults=()=>{
    setGifts(DEFAULT_LOYALTY_GIFTS.map(g=>({...g})));
    showToast("Reset to defaults — click Save to apply");
  };

  return (
    <div style={S.content}>
      <div style={S.card}>
        <h3 style={S.cardTitle}>🎁 Loyalty Rewards Editor</h3>
        <div style={{fontSize:11,color:"#607080",marginBottom:14}}>Configure what gifts clients receive at each points threshold. Changes apply to all client profiles.</div>
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          <button onClick={addGift} style={{...S.submitBtn,background:"#1a2a3e",color:"#4f8ef7",border:"1px solid #4f8ef744",padding:"7px 14px",fontSize:11}}>+ Add Reward Tier</button>
          <button onClick={resetDefaults} style={{...S.submitBtn,background:"none",border:"1px solid #2a3545",color:"#607080",padding:"7px 14px",fontSize:11}}>↺ Reset Defaults</button>
        </div>
        {gifts.map((g,idx)=> (
          <div key={idx} style={{display:"flex",gap:8,alignItems:"center",padding:"10px 12px",background:"#0d1520",borderRadius:8,marginBottom:6,border:"1px solid #1a2535",flexWrap:"wrap"}}>
            <div style={{display:"flex",flexDirection:"column",gap:3,minWidth:60}}>
              <label style={{fontSize:8,color:"#607080",fontWeight:700,textTransform:"uppercase"}}>Points</label>
              <input type="number" value={g.points} onChange={e=>updateGift(idx,"points",e.target.value)} style={{...S.input,width:80,padding:"5px 8px",fontSize:12,textAlign:"center"}}/>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3,flex:1,minWidth:140}}>
              <label style={{fontSize:8,color:"#607080",fontWeight:700,textTransform:"uppercase"}}>Gift / Reward</label>
              <input value={g.gift} onChange={e=>updateGift(idx,"gift",e.target.value)} placeholder="e.g. Free 10 Visiting Cards" style={{...S.input,padding:"5px 8px",fontSize:12}}/>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3,minWidth:50}}>
              <label style={{fontSize:8,color:"#607080",fontWeight:700,textTransform:"uppercase"}}>Icon</label>
              <select value={g.icon} onChange={e=>updateGift(idx,"icon",e.target.value)} style={{...S.input,padding:"5px 4px",fontSize:14,textAlign:"center",width:50}}>
                {icons.map(ic=> <option key={ic} value={ic}>{ic}</option>)}
              </select>
            </div>
            <button onClick={()=>removeGift(idx)} style={{background:"none",border:"1px solid #ff3b3b44",color:"#ff3b3b",borderRadius:5,padding:"4px 8px",cursor:"pointer",fontSize:10,marginTop:14,flexShrink:0}}>✕</button>
          </div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <button onClick={saveGifts} disabled={saving} style={{...S.submitBtn,opacity:saving?0.6:1}}>{saving?"Saving...":"💾 Save Rewards"}</button>
        </div>
      </div>

      <div style={S.card}>
        <h3 style={S.cardTitle}>📋 Preview</h3>
        <div style={{fontSize:11,color:"#607080",marginBottom:10}}>This is how the rewards chart will appear on client profiles:</div>
        {gifts.filter(g=>g.points>0&&g.gift).sort((a,b)=>a.points-b.points).map(g=> (
          <div key={g.points} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 9px",borderRadius:5,background:"#0d1520",marginBottom:3}}>
            <span style={{fontSize:14}}>{g.icon}</span>
            <span style={{fontSize:11,color:"#c8d8e8",flex:1}}>{g.gift}</span>
            <span style={{fontSize:10,color:"#4f8ef7",fontWeight:700}}>{g.points.toLocaleString()} pts</span>
          </div>
        ))}
        {gifts.filter(g=>g.points>0&&g.gift).length===0&&<div style={{color:"#405060",fontSize:12}}>No valid rewards — add points and gift names above</div>}
      </div>
    </div>
  );
}

// ── Client Report Card ─────────────────────────────────────────────
function ClientReportCard({clients,filtered,clientFilter}){
  const sc=clients.find(c=>c.custId===clientFilter);
  if(!sc) return null;
  const cjobs=filtered;
  const cRev=cjobs.reduce((s,j)=>s+j.amount,0);
  const cColl=cjobs.reduce((s,j)=>s+j.paid,0);
  const cDue=cRev-cColl;
  const cRate=cRev>0?Math.round((cColl/cRev)*100):0;
  const kpis=[{l:"Jobs",v:cjobs.length,c:"#4f8ef7"},{l:"Revenue",v:"₹"+cRev.toLocaleString(),c:"#4f8ef7"},{l:"Collected",v:"₹"+cColl.toLocaleString(),c:"#27c27c"},{l:"Outstanding",v:"₹"+cDue.toLocaleString(),c:cDue>0?"#ff3b3b":"#27c27c"},{l:"Collection",v:cRate+"%",c:cRate>=80?"#27c27c":cRate>=50?"#f5a623":"#ff3b3b"}];
  const cols=["Order","Description","Type","Date","Amount","Paid","Due","Stage"];
  return (
    <div style={{...S.card,borderLeft:"4px solid #4f8ef7",marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <span style={{fontSize:22}}>{getLoyaltyTier(cRev).icon}</span>
        <div><div style={{fontWeight:800,color:"#e0e8f5",fontSize:15}}>{sc.name}</div><div style={{fontSize:10,color:"#607080"}}>{sc.custId} · {sc.phone} · {sc.monthlyBilling?"Monthly":"Per Job"}</div></div>
      </div>
      <div style={{display:"flex",gap:9,flexWrap:"wrap",marginBottom:12}}>
        {kpis.map(k=> <div key={k.l} style={{flex:1,minWidth:75,background:"#0d1520",borderRadius:7,padding:"9px",textAlign:"center",borderTop:"2px solid "+k.c}}><div style={{color:k.c,fontSize:15,fontWeight:800}}>{k.v}</div><div style={{color:"#607080",fontSize:9,marginTop:2}}>{k.l}</div></div>)}
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={S.table}><thead><tr>{cols.map(h=> <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>{cjobs.map(j=>{const due=j.amount-j.paid; return (<tr key={j.orderId} style={S.tr}><td style={S.td}><span style={S.orderBadge}>{j.orderId}</span></td><td style={S.td}>{j.jobDesc}</td><td style={S.td}><span style={{fontSize:10,background:"#1a2a3e",color:"#a0b8ff",padding:"2px 6px",borderRadius:10}}>{j.orderType}</span></td><td style={S.td}>{j.createdAt}</td><td style={S.td}>₹{j.amount.toLocaleString()}</td><td style={{...S.td,color:"#27c27c"}}>₹{j.paid.toLocaleString()}</td><td style={{...S.td,color:due>0?"#ff3b3b":"#27c27c",fontWeight:700}}>{due>0?"₹"+due.toLocaleString():"Paid ✓"}</td><td style={S.td}><span style={{fontSize:10,padding:"2px 6px",borderRadius:10,background:(STAGE_COLORS[j.stage]||"#607080")+"22",color:STAGE_COLORS[j.stage]||"#607080"}}>{j.stage}</span></td></tr>);})}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────
const S={
  root:{display:"flex",minHeight:"100vh",background:"#0d1520",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#c8d8e8"},
  sidebar:{width:216,background:"#0a1018",display:"flex",flexDirection:"column",padding:"0 0 14px",borderRight:"1px solid #1a2535",flexShrink:0},
  brand:{display:"flex",alignItems:"center",gap:9,padding:"18px 14px 14px",borderBottom:"1px solid #1a2535",marginBottom:9},
  navBtn:{display:"flex",alignItems:"center",gap:9,padding:"9px 16px",background:"none",border:"none",color:"#607080",cursor:"pointer",fontSize:12,fontWeight:500,textAlign:"left",width:"100%"},
  navActive:{color:"#4f8ef7",background:"#1a2a3e",borderRight:"3px solid #4f8ef7"},
  main:{flex:1,display:"flex",flexDirection:"column",minWidth:0},
  topBar:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 20px",background:"#0a1018",borderBottom:"1px solid #1a2535"},
  content:{flex:1,padding:"16px 20px",overflowY:"auto"},
  kpiRow:{display:"flex",gap:9,flexWrap:"wrap",marginBottom:16},
  kpiCard:{flex:"1 1 120px",background:"#141f2e",borderRadius:9,padding:"11px 13px",display:"flex",flexDirection:"column",gap:2},
  card:{background:"#141f2e",borderRadius:9,padding:"14px 16px",marginBottom:14},
  cardTitle:{fontSize:13,fontWeight:700,color:"#e0e8f5",marginBottom:10,marginTop:0},
  table:{width:"100%",borderCollapse:"collapse"},
  th:{textAlign:"left",padding:"7px 9px",fontSize:9,color:"#607080",textTransform:"uppercase",letterSpacing:0.5,borderBottom:"1px solid #1a2535",whiteSpace:"nowrap"},
  tr:{borderBottom:"1px solid #1a2535"},
  td:{padding:"7px 9px",fontSize:11,color:"#a0b8c8",verticalAlign:"middle"},
  orderBadge:{fontSize:9,background:"#1a2a3e",color:"#4f8ef7",padding:"2px 7px",borderRadius:10,fontWeight:700,fontFamily:"monospace",whiteSpace:"nowrap"},
  miniSelect:{background:"#0d1520",color:"#c8d8e8",border:"1px solid #1a2535",borderRadius:5,padding:"3px 7px",fontSize:11,cursor:"pointer"},
  formCard:{background:"#141f2e",borderRadius:9,padding:"18px"},
  formGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:11},
  fg:{display:"flex",flexDirection:"column",gap:4,position:"relative"},
  label:{fontSize:10,color:"#607080",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5},
  input:{background:"#0d1520",border:"1px solid #1a2535",borderRadius:7,padding:"8px 10px",color:"#e0e8f5",fontSize:12,outline:"none",width:"100%",boxSizing:"border-box"},
  dropdown:{position:"absolute",top:"100%",left:0,right:0,background:"#1a2535",border:"1px solid #2a3545",borderRadius:7,zIndex:100,overflow:"hidden",marginTop:2},
  dropItem:{padding:"8px 11px",cursor:"pointer",fontSize:11,color:"#c8d8e8",borderBottom:"1px solid #1e2a3a"},
  submitBtn:{background:"#4f8ef7",color:"#fff",border:"none",borderRadius:7,padding:"9px 20px",fontSize:12,fontWeight:700,cursor:"pointer"},
  empty:{textAlign:"center",color:"#405060",padding:"60px 20px",fontSize:14},
  toast:{position:"fixed",bottom:22,right:22,padding:"11px 20px",borderRadius:9,color:"#fff",fontWeight:700,fontSize:12,zIndex:1000,boxShadow:"0 4px 20px rgba(0,0,0,0.5)"},
  calBtn:{background:"#1a2535",border:"none",color:"#c8d8e8",borderRadius:5,padding:"2px 10px",cursor:"pointer",fontSize:17,fontWeight:700},
  quickBtn:{background:"#1a2535",border:"1px solid #2a3545",color:"#a0b8c8",borderRadius:5,padding:"2px 8px",cursor:"pointer",fontSize:10},
  closeBtn:{background:"none",border:"1px solid #2a3545",color:"#607080",borderRadius:5,padding:"2px 9px",cursor:"pointer",fontSize:10,flexShrink:0,whiteSpace:"nowrap"},
};
