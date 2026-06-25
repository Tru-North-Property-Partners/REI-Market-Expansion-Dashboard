/*
  Tru North REI Market Expansion Dashboard
  rebuild.js  -  Monthly refresh orchestration (fully runnable in the dashboard browser tab console)

  WHAT THIS DOES
  Pulls the current month of every data feed, re-derives every market row, preserves
  all existing markets, adds net-new markets that pass the gate (state already on the
  board + population >= POP_FLOOR + homes sold > SOLD_FLOOR), enriches with Zillow value/
  rent and CFPB county delinquency, updates the data-current badge, rewrites the RAW / PEND /
  DLQ1 / DLQ2 arrays, validates, and prints a ready-to-paste full index.html into window._FINAL.

  WHAT YOU CHANGE EACH MONTH (only these two lines)
  Download the new Redfin city CSV and upload it to Google Drive, and refresh the Census
  population workbook in Google Sheets, then paste the new IDs below:
*/
const DRIVE_ID = "1B0mZqKMkItyV_mHbEXFaFKz7awOhvKDD";   // Redfin city CSV in Google Drive
const SHEET_ID = "PASTE_CENSUS_SHEET_ID_HERE";          // Census population workbook in Google Sheets

/* Gate (leave as-is to reproduce the v41/v42 board, or adjust to grow/shrink) */
const POP_FLOOR  = 19400;   // minimum population for a NEW market
const SOLD_FLOOR = 50;      // minimum homes sold for a NEW market
const REPO = "Tru-North-Property-Partners/REI-Market-Expansion-Dashboard";

/* ----------------------------------------------------------------------------
   0. Helpers
---------------------------------------------------------------------------- */
const log = (...a) => console.log("[rebuild]", ...a);
function csvRows(text){
  // RFC-4180-ish parser (handles quoted commas/newlines)
  const rows=[]; let row=[], cur="", q=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else { if(c==='"')q=true; else if(c===','){row.push(cur);cur="";}
      else if(c==='\n'){row.push(cur);rows.push(row);row=[];cur="";}
      else if(c==='\r'){} else cur+=c; }
  }
  if(cur.length||row.length){row.push(cur);rows.push(row);}
  return rows;
}
const norm = s => (s||"").toString().trim().toLowerCase()
  .replace(/\b(city|town|village|township|borough|cdp|municipality)\b/g,"").replace(/\s+/g," ").trim();
const STATE_ABBR = {"alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO","connecticut":"CT","delaware":"DE","district of columbia":"DC","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY","puerto rico":"PR"};
const toAbbr = s => { s=(s||"").trim(); if(s.length===2) return s.toUpperCase(); return STATE_ABBR[s.toLowerCase()]||s; };

/* ----------------------------------------------------------------------------
   1. Fetch the existing site and parse its arrays (preserve everything)
---------------------------------------------------------------------------- */
async function loadCurrent(){
  const t = await (await fetch("https://tru-north-property-partners.github.io/REI-Market-Expansion-Dashboard/index.html?x="+Date.now(),{cache:"no-store"})).text();
  function bounds(tokenChar){ // returns [open,close] of the array following the first occurrence of tokenChar
    return tokenChar;
  }
  function arrBounds(declToken){
    const i=t.indexOf(declToken); const j=t.indexOf("[",i); let d=0,k=j;
    for(;k<t.length;k++){ if(t[k]==="[")d++; else if(t[k]==="]"){d--; if(d===0){k++;break;}} }
    return [j,k];
  }
  const b = {
    RAW: arrBounds("var R"+"AW=["),
    PEND: arrBounds("var P"+"END=["),
    DLQ1: arrBounds("var D"+"LQ1=["),
    DLQ2: arrBounds("var D"+"LQ2=[")
  };
  return {
    text:t, bounds:b,
    RAW: JSON.parse(t.slice(b.RAW[0],b.RAW[1])),
    PEND: JSON.parse(t.slice(b.PEND[0],b.PEND[1])),
    DLQ1: JSON.parse(t.slice(b.DLQ1[0],b.DLQ1[1])),
    DLQ2: JSON.parse(t.slice(b.DLQ2[0],b.DLQ2[1]))
  };
}

/* ----------------------------------------------------------------------------
   2. Redfin city CSV (Google Drive)  ->  price, dom, moi, slr, sold, pending, inventory
   NOTE: large Drive files need the confirm=t param to skip the virus-scan page.
   CORS: fetch this from a drive.usercontent.google.com tab, then hand the text in.
---------------------------------------------------------------------------- */
function parseRedfin(text){
  const rows=csvRows(text); const H=rows[0].map(h=>h.trim());
  const ix=n=>H.indexOf(n);
  const cName=ix("REGION NAME"), cEnd=ix("PERIOD END"),
        cPrice=ix("MEDIAN SALE PRICE NSA ($)"), cDom=ix("MEDIAN DAYS ON MARKET (DAYS)"),
        cMoi=ix("MONTHS OF SUPPLY"), cSlr=ix("AVERAGE SALE TO LIST RATIO (%)"),
        cSold=ix("HOMES SOLD"), cPend=ix("PENDING SALES"), cInv=ix("INVENTORY");
  // latest period only
  let latest=""; for(let i=1;i<rows.length;i++){ const p=rows[i][cEnd]; if(p&&p>latest)latest=p; }
  const m=new Map();
  for(let i=1;i<rows.length;i++){ const r=rows[i]; if(r[cEnd]!==latest) continue;
    const rn=r[cName]||""; const parts=rn.split(","); if(parts.length<2) continue;
    const city=parts[0], st=toAbbr(parts[1]);
    const num=v=>{ v=(v||"").replace(/[$,%]/g,"").trim(); const n=parseFloat(v); return isFinite(n)?n:null; };
    m.set(norm(city)+"|"+st, {
      price:num(r[cPrice]), dom:num(r[cDom]), moi:num(r[cMoi]), slr:num(r[cSlr]),
      sold:num(r[cSold]), pend:num(r[cPend]), inv:num(r[cInv])
    });
  }
  return {latest, map:m};
}

/* ----------------------------------------------------------------------------
   3. Census population workbook (Google Sheets export CSV)  ->  pop, pg
---------------------------------------------------------------------------- */
function parseCensus(text){
  const rows=csvRows(text); const H=rows[0].map(h=>h.trim());
  // header names vary; find columns by pattern
  const cGeo=H.findIndex(h=>/geograph/i.test(h));
  const yrCols=H.map((h,i)=>({i,m:(h.match(/20(2\d)/)||[])[0]})).filter(x=>x.m);
  const c2020=(yrCols.find(x=>x.m==="2020")||{}).i;
  const c2025=(yrCols.length?yrCols[yrCols.length-1]:{}).i; // most recent year present
  const m=new Map();
  for(let i=1;i<rows.length;i++){ const r=rows[i]; const geo=r[cGeo]; if(!geo||!geo.includes(",")) continue;
    const parts=geo.split(","); const st=toAbbr(parts.pop()); const city=parts.join(",");
    const n=v=>{ const x=parseFloat((v||"").replace(/[, ]/g,"")); return isFinite(x)?x:null; };
    const p20=n(r[c2020]), p25=n(r[c2025]);
    if(p25==null) continue;
    const pg = (p20 && p20>0) ? +(((p25-p20)/p20)*100).toFixed(2) : null;
    m.set(norm(city)+"|"+st, {pop:Math.round(p25), pg});
  }
  return m;
}

/* ----------------------------------------------------------------------------
   4. Zillow ZHVI + ZORI (direct fetch, CORS ok)  ->  zhvi, rent, county crosswalk
---------------------------------------------------------------------------- */
async function parseZillow(){
  const zhviT=await (await fetch("https://files.zillowstatic.com/research/public_csvs/zhvi/City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv?x="+Date.now())).text();
  const zoriT=await (await fetch("https://files.zillowstatic.com/research/public_csvs/zori/City_zori_uc_sfrcondomfr_sm_month.csv?x="+Date.now())).text();
  function lastNum(rows,H){ // index of last column that is a YYYY-MM-DD header
    for(let i=H.length-1;i>=0;i--){ if(/^\d{4}-\d{2}-\d{2}$/.test(H[i])) return i; } return -1;
  }
  const zhviR=csvRows(zhviT), zH=zhviR[0];
  const zName=zH.indexOf("RegionName"), zState=zH.indexOf("State"), zCounty=zH.indexOf("CountyName"), zLast=lastNum(zhviR,zH);
  const zhvi=new Map(), county=new Map();
  for(let i=1;i<zhviR.length;i++){ const r=zhviR[i]; const k=norm(r[zName])+"|"+toAbbr(r[zState]);
    const v=parseFloat(r[zLast]); if(isFinite(v)) zhvi.set(k,Math.round(v));
    if(r[zCounty]) county.set(k, r[zCounty].replace(/ County$/i,"").trim()+"|"+toAbbr(r[zState]));
  }
  const zoriR=csvRows(zoriT), oH=zoriR[0];
  const oName=oH.indexOf("RegionName"), oState=oH.indexOf("State"), oLast=lastNum(zoriR,oH);
  const rent=new Map();
  for(let i=1;i<zoriR.length;i++){ const r=zoriR[i]; const v=parseFloat(r[oLast]); if(isFinite(v)) rent.set(norm(r[oName])+"|"+toAbbr(r[oState]), Math.round(v)); }
  return {zhvi, rent, county};
}

/* ----------------------------------------------------------------------------
   5. CFPB delinquency (gist raw)  ->  serious (DLQ1) + early (DLQ2) by county
---------------------------------------------------------------------------- */
async function parseCFPB(){
  async function one(url){
    const t=await (await fetch(url+"?x="+Date.now())).text();
    const rows=csvRows(t); const H=rows[0];
    const cN=H.findIndex(h=>/name|county/i.test(h)), cS=H.findIndex(h=>/^state$|state code|abbr/i.test(h));
    let cLast=-1; for(let i=H.length-1;i>=0;i--){ if(/\d{4}|month/i.test(H[i])){cLast=i;break;} }
    const m=new Map();
    for(let i=1;i<rows.length;i++){ const r=rows[i]; const v=parseFloat(r[cLast]);
      if(isFinite(v)) m.set(norm((r[cN]||"").replace(/ County$/i,""))+"|"+toAbbr(r[cS]), v); }
    return m;
  }
  const serious=await one("https://gist.githubusercontent.com/raw/3c0553f5a9a86dab92c6695f4059caeb");
  const early  =await one("https://gist.githubusercontent.com/raw/4c605d6baff8844aa38e3634f02fb2f9");
  return {serious, early};
}

/* ----------------------------------------------------------------------------
   6. Orchestrate: preserve existing, add net-new, enrich, rewrite, validate
   redfinText + censusText are passed in (fetched cross-origin, see runbook).
---------------------------------------------------------------------------- */
async function rebuild(redfinText, censusText){
  log("loading current site...");
  const cur = await loadCurrent();
  const RAW=cur.RAW.map(r=>r.slice()), PEND=cur.PEND.slice(), DLQ1=cur.DLQ1.slice(), DLQ2=cur.DLQ2.slice();
  const onBoard = new Set(RAW.map(r=>toAbbr(r[1])));
  const existing = new Set(RAW.map(r=>norm(r[0])+"|"+toAbbr(r[1])));

  log("parsing redfin...");
  const red = parseRedfin(redfinText);
  log("redfin latest period:", red.latest, "cities:", red.map.size);
  log("parsing census...");
  const cen = parseCensus(censusText);
  log("census places:", cen.size);
  log("parsing zillow...");
  const zil = await parseZillow();
  log("zhvi:", zil.zhvi.size, "rent:", zil.rent.size);
  log("parsing cfpb...");
  const cfpb = await parseCFPB();
  log("cfpb serious:", cfpb.serious.size, "early:", cfpb.early.size);

  // 6a. Refresh existing rows' Redfin + Census + Zillow + CFPB where we have a confirmed match
  function enrichRow(i){
    const r=RAW[i]; const key=norm(r[0])+"|"+toAbbr(r[1]);
    const rf=red.map.get(key);
    if(rf){ if(rf.price!=null)r[4]=rf.price; if(rf.dom!=null)r[5]=rf.dom; if(rf.moi!=null)r[6]=rf.moi;
            if(rf.slr!=null)r[7]=rf.slr; if(rf.sold!=null)r[12]=rf.sold;
            if(rf.pend!=null && rf.inv>0) PEND[i]=+((rf.pend/(rf.pend+rf.inv))*100).toFixed(1); }
    const cs=cen.get(key); if(cs){ if(cs.pop!=null)r[2]=cs.pop; if(cs.pg!=null)r[8]=cs.pg; }
    if(zil.zhvi.has(key))r[13]=zil.zhvi.get(key);
    if(zil.rent.has(key))r[14]=zil.rent.get(key);
    const ck=zil.county.get(key);
    if(ck){ if(cfpb.serious.has(ck))DLQ1[i]=cfpb.serious.get(ck); if(cfpb.early.has(ck))DLQ2[i]=cfpb.early.get(ck); }
  }
  for(let i=0;i<RAW.length;i++) enrichRow(i);

  // 6b. Add net-new markets (state on board + pop floor + sold floor + full Redfin+Census data)
  let added=0;
  for(const [key, rf] of red.map){
    if(existing.has(key)) continue;
    const st=key.split("|")[1]; if(!onBoard.has(st)) continue;
    const cs=cen.get(key); if(!cs || cs.pop==null || cs.pg==null) continue;
    if(cs.pop < POP_FLOOR) continue;
    if(rf.sold==null || rf.sold <= SOLD_FLOOR) continue;
    if(rf.price==null||rf.dom==null||rf.moi==null||rf.slr==null) continue; // require full core set
    const cityDisplay = key.split("|")[0].replace(/\b\w/g,c=>c.toUpperCase());
    const row=[cityDisplay, st, cs.pop, null, rf.price, rf.dom, rf.moi, rf.slr, cs.pg, null, null, null, rf.sold,
               zil.zhvi.get(key) ?? null, zil.rent.get(key) ?? null, null];
    const idx=RAW.length; RAW.push(row);
    PEND.push(rf.pend!=null && rf.inv>0 ? +((rf.pend/(rf.pend+rf.inv))*100).toFixed(1) : null);
    const ck=zil.county.get(key);
    DLQ1.push(ck && cfpb.serious.has(ck) ? cfpb.serious.get(ck) : null);
    DLQ2.push(ck && cfpb.early.has(ck) ? cfpb.early.get(ck) : null);
    added++;
  }
  log("net-new added:", added, "-> total markets:", RAW.length);

  // 6c. Update data-current badge from Redfin latest period (e.g. 2026-05-31 -> "May 2026")
  const MN=["January","February","March","April","May","June","July","August","September","October","November","December"];
  let badge=null;
  const mp=red.latest.match(/^(\d{4})-(\d{2})/);
  if(mp) badge = MN[+mp[2]-1]+" "+mp[1];

  // 6d. Rewrite arrays into the page text
  let t=cur.text;
  function put(declToken, arr){
    const i=t.indexOf(declToken); const j=t.indexOf("[",i); let d=0,k=j;
    for(;k<t.length;k++){ if(t[k]==="[")d++; else if(t[k]==="]"){d--; if(d===0){k++;break;}} }
    t = t.slice(0,j) + JSON.stringify(arr) + t.slice(k);
  }
  // order matters: replace later offsets first to keep indices valid, but put() re-finds each token, so order is fine
  put("var R"+"AW=[", RAW);
  put("var P"+"END=[", PEND);
  put("var D"+"LQ1=[", DLQ1);
  put("var D"+"LQ2=[", DLQ2);
  if(badge) t = t.replace(/(current as of:\s*<span id="refresh-date">)[^<]*/i, "$1"+badge);

  // 6e. Validate
  const checks={
    emdash: /[\u2014\u2013]/.test(t),
    mojibakeC: /[\u00c2\u00c3]/.test(t),
    mojibakeE: /\u00e2[\u0080-\u00bf]/.test(t),
    startsOk: t.startsWith("<!DOCTYPE html>"),
    endsOk: /<\/html>\s*$/.test(t),
    counts: {RAW:RAW.length,PEND:PEND.length,DLQ1:DLQ1.length,DLQ2:DLQ2.length},
    countsEqual: (new Set([RAW.length,PEND.length,DLQ1.length,DLQ2.length])).size===1
  };
  log("validation:", JSON.stringify(checks));
  if(checks.emdash||checks.mojibakeC||checks.mojibakeE||!checks.startsOk||!checks.endsOk||!checks.countsEqual)
    throw new Error("VALIDATION FAILED -> do not commit. See checks above.");

  window._FINAL = t;
  log("SUCCESS. window._FINAL is ready ("+t.length+" chars, "+RAW.length+" markets). Copy it into index.html and commit.");
  return {ok:true, markets:RAW.length, added, badge, len:t.length};
}

/*
  HOW TO RUN (in the dashboard browser tab, https://tru-north-property-partners.github.io/...):
  1) Open a drive.usercontent.google.com tab and fetch the Redfin CSV there:
       fetch("https://drive.usercontent.google.com/download?id="+DRIVE_ID+"&export=download&confirm=t").then(r=>r.text())
     and the Census CSV:
       fetch("https://docs.google.com/spreadsheets/d/"+SHEET_ID+"/export?format=csv").then(r=>r.text())
     (CORS allows these from the drive.usercontent origin.) Move the text back via window.name.
  2) In the dashboard tab:  await rebuild(redfinText, censusText)
  3) Copy window._FINAL into index.html on GitHub and commit. Verify the live market count.
*/
