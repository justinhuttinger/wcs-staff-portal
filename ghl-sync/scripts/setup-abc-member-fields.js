// Creates the "ABC Membership" contact-field folder + the fields reconcile
// writes (see src/abc/memberDetailFields.js), and moves the original ABC fields
// into it. Idempotent: existing fields are skipped. Dry run unless --apply.
//
// Usage: node scripts/setup-abc-member-fields.js SALEM [--apply] [--folder=ID]
process.loadEnvFile(require("path").join(__dirname, "..", ".env"));
const B='https://services.leadconnectorhq.com';
const club=process.argv[2], APPLY=process.argv.includes('--apply');
const loc=process.env['GHL_LOCATION_'+club];
const H={Authorization:`Bearer ${process.env['GHL_API_KEY_'+club]}`,Version:'2021-07-28','Content-Type':'application/json'};
const FOLDER='ABC Membership';
const NEW=[
  ['Next Billing Date','DATE','contact.next_billing_date'],
  ['Expiration Date','DATE','contact.expiration_date'],
  ['Past Due','SINGLE_OPTIONS','contact.past_due',['Yes','No']],
  ['Past Due Balance','MONETORY','contact.past_due_balance'],
  ['Next Due Amount','MONETORY','contact.next_due_amount'],
  ['Payment Method','TEXT','contact.payment_method'],
  ['Agreement Term','TEXT','contact.agreement_term'],
  ['Member Relationship','SINGLE_OPTIONS','contact.member_relationship',['Primary','Add-on']],
  ['Last Check-In','DATE','contact.last_checkin'],
  ['Last Check-In Time','TEXT','contact.last_checkin_time'],
  ['Total Check-Ins','NUMERICAL','contact.total_checkins'],
  ['ABC Barcode','TEXT','contact.abc_barcode'],
];
const MOVE=['contact.abc_member_id','contact.membership_type','contact.member_status','contact.member_sign_date','contact.cancel_date','contact.sale_team_member'];
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
