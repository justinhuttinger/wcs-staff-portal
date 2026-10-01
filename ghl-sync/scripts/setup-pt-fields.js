// Creates the "Personal Training" contact-field folder + the PT fields
// reconcile writes (see src/abc/ptFields.js). Idempotent: existing fields are
// skipped. Dry run unless --apply. Same mechanics as setup-abc-member-fields.js.
//
// Leaves the older hand-filled PT fields (PT Sale Type, PT Sign Date, PT
// Value, PT Deactivate Date, PT Notes) alone: forms/workflows may use them.
//
// Usage: node scripts/setup-pt-fields.js SALEM [--apply] [--folder=ID]
process.loadEnvFile(require("path").join(__dirname, "..", ".env"));
const B='https://services.leadconnectorhq.com';
const club=process.argv[2], APPLY=process.argv.includes('--apply');
const loc=process.env['GHL_LOCATION_'+club];
const H={Authorization:`Bearer ${process.env['GHL_API_KEY_'+club]}`,Version:'2021-07-28','Content-Type':'application/json'};
const FOLDER='Personal Training';
const NEW=[
  ['PT Status','SINGLE_OPTIONS','contact.pt_status',['Active','Past Client','None']],
  ['PT Type','SINGLE_OPTIONS','contact.pt_type',['PIF','Recurring']],
  ['PT Trainer','TEXT','contact.pt_trainer'],
  ['PT Package','TEXT','contact.pt_package'],
  ['PT Price Per Session','MONETORY','contact.pt_price_per_session'],
  ['PT Billing Amount','MONETORY','contact.pt_billing_amount'],
  ['PT Billing Frequency','TEXT','contact.pt_billing_frequency'],
  ['PT Term','TEXT','contact.pt_term'],
  ['PT Payments Made','NUMERICAL','contact.pt_payments_made'],
  ['PT Start Date','DATE','contact.pt_start_date'],
  ['PT Next Billing Date','DATE','contact.pt_next_billing_date'],
  ['PT End Date','DATE','contact.pt_end_date'],
  ['PT Sold By','TEXT','contact.pt_sold_by'],
  ['PT Sessions Purchased','NUMERICAL','contact.pt_sessions_purchased'],
  ['PT Sessions Remaining','NUMERICAL','contact.pt_sessions_remaining'],
];
const MOVE=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,path,body){const r=await fetch(B+path,{method,headers:H,body:body&&JSON.stringify(body)});const t=await r.text();if(!r.ok)throw new Error(`${method} ${path} ${r.status} ${t}`);return t?JSON.parse(t):{};}
(async()=>{
  const fields=(await api('GET',`/locations/${loc}/customFields?model=contact`)).customFields;
  // The list endpoint never returns folders; find ours via its children's parentId,
  // or an explicit --folder=ID (a freshly created, still-empty folder).
  let folder=null;
  const argId=(process.argv.find(a=>a.startsWith('--folder='))||'').slice(9);
  for(const pid of [argId,...new Set(fields.map(f=>f.parentId))].filter(Boolean)){
    const r=await fetch(`${B}/locations/${loc}/customFields/${pid}`,{headers:H});
    if(!r.ok) continue; const cf=(await r.json()).customField;
    if(cf&&cf.documentType==='folder'&&cf.name===FOLDER){folder=cf;break;}
  }
  console.log(`## ${club} (${APPLY?'APPLY':'dry run'}) folder: ${folder?folder.id:'MISSING'}`);
  if(!folder){ if(!APPLY){console.log('would create folder');} else { folder=(await api('POST',`/locations/${loc}/customFields`,{name:FOLDER,model:'contact',documentType:'folder'})).customFieldFolder; console.log('created folder',folder.id);} }
  for(const [name,dataType,key,options] of NEW){
    const ex=fields.find(f=>f.fieldKey===key||f.name===name);
    if(ex){console.log(`skip  ${name} (exists as ${ex.fieldKey})`);continue;}
    if(!APPLY){console.log(`would create ${name} [${dataType}]`);continue;}
    const body={name,dataType,model:'contact',parentId:folder.id}; if(options) body.options=options;
    const res=(await api('POST',`/locations/${loc}/customFields`,body)).customField;
    console.log(`created ${name} -> ${res.fieldKey} parent=${res.parentId}${res.fieldKey!==key?'  !! KEY MISMATCH expected '+key:''}`);
    await sleep(300);
  }
  for(const key of MOVE){
    const f=fields.find(x=>x.fieldKey===key);
    if(!f){console.log(`missing ${key}`);continue;}
    if(folder&&f.parentId===folder.id){console.log(`ok    ${f.name} already in folder`);continue;}
    if(!APPLY){console.log(`would move ${f.name}`);continue;}
    const res=await api('PUT',`/locations/${loc}/customFields/${f.id}`,{name:f.name,parentId:folder.id});
    console.log(`moved ${f.name} -> parent=${res.customField?.parentId}`);
    await sleep(300);
  }
})().catch(e=>{console.error(e.message);process.exit(1);});
