import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(url, key);

// ── Mapping: JS camelCase ↔ DB snake_case ─────────────────────────

export function dbToClient(r) {
  return { custId:r.cust_id, name:r.name, phone:r.phone||"", email:r.email||"", gst:r.gst||"", address:r.address||"", monthlyBilling:!!r.monthly_billing, lastBillDate:r.last_bill_date||null, loyaltyPoints:r.loyalty_points||0 };
}
export function clientToDb(c) {
  return { cust_id:c.custId, name:c.name, phone:c.phone||"", email:c.email||"", gst:c.gst||"", address:c.address||"", monthly_billing:!!c.monthlyBilling, last_bill_date:c.lastBillDate||null, loyalty_points:c.loyaltyPoints||0 };
}

export function dbToJob(r) {
  return { orderId:r.order_id, custId:r.cust_id, clientName:r.client_name, jobDesc:r.job_desc, orderType:r.order_type, deadline:r.deadline, urgency:r.urgency||"Medium", stage:r.stage||"Order Received", amount:parseFloat(r.amount)||0, paid:parseFloat(r.paid)||0, notes:r.notes||"", images:[], needsPrint:!!r.needs_print, needsFabrication:!!r.needs_fabrication, printSpec:r.print_spec||null, fabSpec:r.fab_spec||null, createdAt:r.created_at, deliveredAt:r.delivered_at||null };
}
export function jobToDb(j) {
  return { order_id:j.orderId, cust_id:j.custId, client_name:j.clientName, job_desc:j.jobDesc, order_type:j.orderType, deadline:j.deadline, urgency:j.urgency, stage:j.stage, amount:j.amount, paid:j.paid, notes:j.notes||"", needs_print:!!j.needsPrint, needs_fabrication:!!j.needsFabrication, print_spec:j.printSpec||null, fab_spec:j.fabSpec||null, created_at:j.createdAt, delivered_at:j.deliveredAt||null };
}

export function dbToPrint(r) {
  return { id:r.print_id, orderId:r.order_id, clientName:r.client_name, jobDesc:r.job_desc, type:r.type, material:r.material, width:r.width, height:r.height, qty:r.qty||"1", resolution:r.resolution, notes:r.notes||"", stage:r.stage||"Queued", createdAt:r.created_at };
}
export function printToDb(p) {
  return { print_id:p.id, order_id:p.orderId, client_name:p.clientName, job_desc:p.jobDesc, type:p.type, material:p.material, width:p.width, height:p.height, qty:p.qty||"1", resolution:p.resolution, notes:p.notes||"", stage:p.stage, created_at:p.createdAt };
}

export function dbToFab(r) {
  return { id:r.fab_id, orderId:r.order_id, clientName:r.client_name, jobDesc:r.job_desc, type:r.type, pipeSize:r.pipe_size, pipeThick:r.pipe_thick, woodType:r.wood_type, acpThick:r.acp_thick, width:r.width, height:r.height, notes:r.notes||"", stage:r.stage||"Pending", createdAt:r.created_at };
}
export function fabToDb(f) {
  return { fab_id:f.id, order_id:f.orderId, client_name:f.clientName, job_desc:f.jobDesc, type:f.type, pipe_size:f.pipeSize, pipe_thick:f.pipeThick, wood_type:f.woodType, acp_thick:f.acpThick, width:f.width, height:f.height, notes:f.notes||"", stage:f.stage, created_at:f.createdAt };
}

// ── Load all data ─────────────────────────────────────────────────

export async function loadAll() {
  const [c, j, p, f] = await Promise.all([
    supabase.from("clients").select("*").order("cust_id"),
    supabase.from("jobs").select("*").order("created_at", { ascending: false }),
    supabase.from("print_jobs").select("*").order("created_at", { ascending: false }),
    supabase.from("fab_jobs").select("*").order("created_at", { ascending: false }),
  ]);
  return {
    clients: (c.data || []).map(dbToClient),
    jobs: (j.data || []).map(dbToJob),
    printJobs: (p.data || []).map(dbToPrint),
    fabJobs: (f.data || []).map(dbToFab),
  };
}

// ── Sync helpers (diff local state → Supabase) ───────────────────

export async function syncTable(table, prev, next, keyField, dbKeyField, toDb) {
  const prevMap = {};
  prev.forEach(x => { prevMap[x[keyField]] = x; });
  const nextMap = {};
  next.forEach(x => { nextMap[x[keyField]] = x; });

  // Inserts
  const inserts = next.filter(x => !prevMap[x[keyField]]);
  if (inserts.length > 0) {
    await supabase.from(table).upsert(inserts.map(toDb));
  }

  // Deletes
  const deletes = prev.filter(x => !nextMap[x[keyField]]);
  for (const d of deletes) {
    await supabase.from(table).delete().eq(dbKeyField, d[keyField]);
  }

  // Updates
  for (const n of next) {
    const p = prevMap[n[keyField]];
    if (p && JSON.stringify(p) !== JSON.stringify(n)) {
      await supabase.from(table).update(toDb(n)).eq(dbKeyField, n[keyField]);
    }
  }
}

// ── Settings (key-value store) ────────────────────────────────────

export async function loadSettings(key) {
  try {
    const { data } = await supabase.from("settings").select("value").eq("key", key).single();
    if (data && data.value) return data.value;
  } catch (e) {}
  return null;
}

export async function saveSettings(key, value) {
  await supabase.from("settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
