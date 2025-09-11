// background.js — adds scanning of already-open tabs on install/startup and after adding a block

const enc = new TextEncoder();

// ---------- base64 helpers ----------
function b64(bytes){let s="";for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s)}
function b64bytes(b64str){const bin=atob(b64str||"");const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}

// ---------- host utils ----------
function normalizeHost(input){
  try{
    const u=input.includes("://")?new URL(input):new URL("https://"+input);
    if(u.protocol!=="http:"&&u.protocol!=="https:")return "";
    let h=u.hostname.toLowerCase(); if(h.startsWith("www.")) h=h.slice(4);
    return h;
  }catch{
    let h=(input||"").trim().toLowerCase(); if(!h) return "";
    if(h.startsWith("www.")) h=h.slice(4);
    if(h==="newtab"||h==="new tab"||h==="chrome://newtab") return "";
    return h;
  }
}
function hostMatches(blockedHost, actualHost){
  return actualHost===blockedHost || actualHost.endsWith("."+blockedHost);
}
function isReservedHost(host){
  if(!host) return true;
  const r=new Set(["newtab","new-tab","new tab","chrome","chrome-newtab","chrome.google.com","edge","about:blank"]);
  return r.has(host);
}

// ---------- crypto (PBKDF2-SHA256) ----------
function genSalt(len=16){const s=new Uint8Array(len); crypto.getRandomValues(s); return s;}
async function deriveHash(pw,salt,iters=150000){
  const key=await crypto.subtle.importKey("raw",enc.encode(pw),{name:"PBKDF2"},false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:salt,iterations:iters},key,256);
  return new Uint8Array(bits);
}
function ctEqual(a,b){ if(!a||!b||a.length!==b.length) return false; let d=0; for(let i=0;i<a.length;i++) d|=a[i]^b[i]; return d===0; }
async function verifyPassword(input,saltB64,hashB64){ if(!saltB64||!hashB64) return false; const calc=await deriveHash(String(input||""), b64bytes(saltB64)); return ctEqual(calc,b64bytes(hashB64)); }

// ---------- state ----------
async function getState(){
  return await chrome.storage.local.get({
    blockedSites: [],
    tempUnlock: {},          // { host: expiryMs }
    passwordHash: "",
    passwordSalt: "",
    settings: { parentMode:false }
  });
}
async function setState(patch){ return chrome.storage.local.set(patch); }

// ---------- alarms (re-lock after temporary unblock) ----------
async function scheduleNextAlarm(stateOpt){
  const state=stateOpt||await getState();
  const now=Date.now();
  const times=Object.values(state.tempUnlock||{}).filter(t=>t>now);
  if(times.length){
    const next=Math.min(...times);
    chrome.alarms.create("relock",{ when: next+50 });
  }else{
    chrome.alarms.clear("relock");
  }
}

async function enforceRelock(){
  const state=await getState();
  const now=Date.now();
  const expired=Object.entries(state.tempUnlock||{}).filter(([,t])=>t<=now).map(([h])=>h);
  if(!expired.length) return;
  const nextUnlock={...(state.tempUnlock||{})}; for(const h of expired) delete nextUnlock[h];
  await setState({ tempUnlock: nextUnlock });
  await scanAllTabsAndRedirect({ ...state, tempUnlock: nextUnlock }); // re-enforce on open tabs
}
chrome.alarms.onAlarm.addListener(async (a)=>{ if(a.name!=="relock") return; await enforceRelock(); await scheduleNextAlarm(); });

// ---------- NEW: scan and redirect already-open tabs ----------
async function scanAllTabsAndRedirect(stateOpt){
  const state=stateOpt||await getState();
  const blocked=new Set(state.blockedSites||[]);
  if(blocked.size===0) return;

  const tabs=await chrome.tabs.query({});
  for(const tab of tabs){
    const urlStr=tab.url;
    if(!urlStr) continue;
    try{
      const u=new URL(urlStr);
      if(u.protocol!=="http:" && u.protocol!=="https:") continue;
      let host=u.hostname.toLowerCase(); if(host.startsWith("www.")) host=host.slice(4);

      // temp unlock?
      const expiry = state.tempUnlock?.[host] || [...blocked].find(b=>hostMatches(b,host) && state.tempUnlock?.[b]);
      const stillUnlocked = typeof expiry === "number" && Date.now() < expiry;

      const match=[...blocked].find(b=>hostMatches(b,host));
      if(match && !stillUnlocked){
        const redirect = chrome.runtime.getURL(`blocked.html?site=${encodeURIComponent(match)}&url=${encodeURIComponent(urlStr)}`);
        try{ await chrome.tabs.update(tab.id, { url: redirect }); }catch{}
      }
    }catch{/* ignore */}
  }
}

// ---------- navigation guard for new navigations ----------
chrome.webNavigation.onBeforeNavigate.addListener(async (details)=>{
  if(!details.url || details.frameId!==0) return;
  let host;
  try{
    const u=new URL(details.url);
    if(u.protocol!=="http:" && u.protocol!=="https:") return;
    host=u.hostname.toLowerCase(); if(host.startsWith("www.")) host=host.slice(4);
  }catch{ return; }

  const { blockedSites, tempUnlock } = await getState();
  const match = blockedSites.find(b=>hostMatches(b,host));
  if(!match) return;
  const expiry = tempUnlock[host] || tempUnlock[match];
  if(expiry && Date.now()<expiry) return;

  const redirect = chrome.runtime.getURL(`blocked.html?site=${encodeURIComponent(match)}&url=${encodeURIComponent(details.url)}`);
  try{ await chrome.tabs.update(details.tabId,{ url: redirect }); }catch{}
}, { url:[{ urlMatches: ".*" }] });

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
  (async ()=>{
    const state=await getState();
    const settings=state.settings||{ parentMode:false };
    const hasPassword=!!state.passwordHash;

    if(msg.action==="getState"){
      sendResponse({ blockedSites:state.blockedSites, tempUnlock:state.tempUnlock, settings, hasPassword }); return;
    }

    if(msg.action==="setPassword"){
      if(settings.parentMode===true){ sendResponse({ok:false,error:"parent_mode_locked"}); return; }
      const pw=String(msg.password??"").trim();
      if(!pw || pw.length<4){ sendResponse({ok:false,error:"weak_password"}); return; }
      const salt=genSalt(16); const hash=await deriveHash(pw,salt);
      await setState({ passwordSalt:b64(salt), passwordHash:b64(hash) });
      sendResponse({ok:true}); return;
    }

    if(msg.action==="toggleParentMode"){
      const enable=!!msg.enableParentMode;
      if(enable){
        if(!hasPassword){ sendResponse({ok:false,error:"no_password_set"}); return; }
        const next={...settings,parentMode:true}; await setState({settings:next});
        sendResponse({ok:true,settings:next}); return;
      }
      const pw=String(msg.password||"").trim();
      if(!hasPassword){ sendResponse({ok:false,error:"no_password_set"}); return; }
      const ok=await verifyPassword(pw,state.passwordSalt,state.passwordHash);
      if(!ok){ sendResponse({ok:false,error:"wrong_password"}); return; }
      const next={...settings,parentMode:false}; await setState({settings:next});
      sendResponse({ok:true,settings:next}); return;
    }

    if(msg.action==="block"){
      const host=normalizeHost(msg.site);
      if(!host || isReservedHost(host)){ sendResponse({ok:false,error:"invalid_host"}); return; }
      const blocked=new Set(state.blockedSites); blocked.add(host);
      const nextState={ ...state, blockedSites: Array.from(blocked) };
      await setState({ blockedSites: Array.from(blocked) });
      // NEW: immediately enforce against already-open tabs
      await scanAllTabsAndRedirect(nextState);
      sendResponse({ok:true,host}); return;
    }

    if(msg.action==="unblockSite"){
      const host=normalizeHost(msg.site);
      if(!host){ sendResponse({ok:false,error:"invalid_host"}); return; }
      if(settings.parentMode===true){
        const pw=String(msg.password||"").trim();
        if(!hasPassword){ sendResponse({ok:false,error:"no_password_set"}); return; }
        const ok=await verifyPassword(pw,state.passwordSalt,state.passwordHash);
        if(!ok){ sendResponse({ok:false,error:"wrong_password"}); return; }
      }
      const nextBlocked=state.blockedSites.filter(h=>h!==host);
      const nextUnlock={ ...(state.tempUnlock||{}) }; delete nextUnlock[host];
      const nextState={ ...state, blockedSites: nextBlocked, tempUnlock: nextUnlock };
      await setState({ blockedSites: nextBlocked, tempUnlock: nextUnlock });
      await scheduleNextAlarm(nextState);
      sendResponse({ok:true,host}); return;
    }

    if(msg.action==="unlock"){
      const host=normalizeHost(msg.site);
      const minutes=Number(msg.minutes);
      if(!host || !minutes){ sendResponse({ok:false,error:"bad_input"}); return; }
      if(settings.parentMode===true){
        const pw=String(msg.password||"").trim();
        if(!hasPassword){ sendResponse({ok:false,error:"no_password_set"}); return; }
        const ok=await verifyPassword(pw,state.passwordSalt,state.passwordHash);
        if(!ok){ sendResponse({ok:false,error:"wrong_password"}); return; }
      }
      const expiry=Date.now() + minutes*60*1000;
      const nextUnlock={ ...(state.tempUnlock||{}) }; nextUnlock[host]=expiry;
      await setState({ tempUnlock: nextUnlock });
      await scheduleNextAlarm({ ...state, tempUnlock: nextUnlock });
      sendResponse({ok:true,host,expiry}); return;
    }

    sendResponse({ok:false,error:"unknown_action"});
  })();
  return true;
});

// Ensure we enforce + schedule on install/start
chrome.runtime.onInstalled.addListener(async ()=>{
  await scheduleNextAlarm();
  await scanAllTabsAndRedirect(); // << NEW: handle tabs already open at install
});
chrome.runtime.onStartup.addListener(async ()=>{
  await scheduleNextAlarm();
  await scanAllTabsAndRedirect(); // << NEW: handle tabs already open at browser start
});