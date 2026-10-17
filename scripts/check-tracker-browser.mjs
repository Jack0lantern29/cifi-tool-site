// Optional real-browser smoke test. Uses an isolated profile and notification stub.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve, extname, join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const base = resolve(import.meta.dirname, "..");
const profile = await mkdtemp(join(tmpdir(), "cifi-tracker-check-"));
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = resolve(base, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(base + "/") && !file.startsWith(base + "\\")) throw new Error("Invalid path");
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".wasm": "application/wasm" })[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch (error) { res.writeHead(404); res.end(error.message); }
});
await new Promise(done => server.listen(0, "localhost", done));
const browser = spawn(process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--no-proxy-server", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
try {
  let port;
  for (let tries = 0; tries < 100; tries++) {
    try { port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; } catch { await delay(100); }
  }
  assert.ok(port, "Headless Chrome must start");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(pages.find(page => page.type === "page" && page.url === "about:blank").webSocketDebuggerUrl);
  await new Promise(done => socket.addEventListener("open", done, { once: true }));
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  const network = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (["Network.responseReceived", "Network.loadingFailed", "Page.downloadWillBegin"].includes(message.method)) network.push(message);
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let tries = 0; tries < 100; tries++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error(`Timed out: ${expression}\n${JSON.stringify(exceptions)}\n${await evaluate("document.querySelector('#shortsTracker')?.innerText || document.body.innerText.slice(0, 400)")}\n${await evaluate("document.activeElement.outerHTML.slice(0, 500)")}`);
  };
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === ${JSON.stringify(text)} && !button.disabled && button.getClientRects().length)?.click()`);
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  // Advance the page clock at result delivery to reproduce a slow search deterministically.
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    const realNow = Date.now;
    Date.now = () => window.testNow ?? realNow();
    const addWorkerListener = Worker.prototype.addEventListener;
    Worker.prototype.addEventListener = function(type, listener, options) {
      if (type !== 'message') return addWorkerListener.call(this, type, listener, options);
      return addWorkerListener.call(this, type, function(event) {
        if (event.data.type === 'result' && window.optimizerTimeAdvance) {
          window.testNow += window.optimizerTimeAdvance;
          window.optimizerTimeAdvance = 0;
        }
        return listener.call(this, event);
      }, options);
    };
  ` });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.alerts=[]; window.permissionRequests=0; window.Notification=class { static permission='default'; static async requestPermission(){ window.permissionRequests++; return this.permission='granted'; } constructor(title,options){ window.alerts.push({title,options}); } close(){} };` });
  const url = `http://localhost:${server.address().port}/`;
  const response = await fetch(url);
  assert.equal(response.status, 200, "local site is served");
  assert.equal(response.headers.get("content-type"), "text/html");
  await delay(1000);
  const navigation = await send("Page.navigate", { url });
  assert.equal(navigation.errorText, undefined, JSON.stringify(network));
  await waitFor(`document.documentElement.dataset.appVersion`);
  const savedSettings = await evaluate(`(async()=>{
    const {createDefaultInput}=await import('./src/validation.js');
    const {saveState}=await import('./src/state.js');
    const {TYPE_ORDER}=await import('./src/data.js');
    const input=createDefaultInput();
    input.ouroUnlocked=input.campaignEnabled=input.shortsEnabled=true;
    input.selectedCampaignFarmMissions=[];
    input.workers=Object.fromEntries(TYPE_ORDER.map((type,i)=>[type,{count:i===0?1000:0,power:10000}]));
    input.shortsProgress.C1.target=2; input.shortsProgress.C4.target=1;
    saveState(input);
    return localStorage.getItem('cifi-farm-mission-optimizer-state-v3');
  })()`);
  const seedScript = await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('cifi-farm-mission-optimizer-state-v3',${JSON.stringify(savedSettings)});` });
  await send("Page.reload");
  await waitFor(`document.documentElement.dataset.appVersion && document.querySelector('#shorts-target-C1').value==='2'`);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seedScript.identifier });
  assert.equal(await evaluate(`document.querySelector('#shorts-hours-C1').placeholder`), "00:00:00");
  assert.equal(await evaluate(`document.querySelector('#shorts-hours-C1').value`), "");
  assert.equal(await evaluate(`document.querySelector('label[for="shorts-hours-C1"]').textContent`), "Time remaining");
  assert.equal(await evaluate(`document.querySelector('#campaignTarget')`), null);
  assert.equal(await evaluate(`document.querySelector('#shortsEnabled')`), null);
  await click("Run Optimizer");
  await waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Track this plan'&&!b.disabled&&!b.closest('[hidden]'))`);
  await click("Track this plan");
  await waitFor(`document.querySelectorAll('.tracker-lane').length===4`);
  assert.equal(await evaluate("window.permissionRequests"), 0);
  assert.equal(await evaluate(`document.querySelectorAll('.tracker-lane[data-status="running"]').length`), 0);
  // Keyboard activation must start exactly the focused mission.
  await evaluate(`Array.from(document.querySelectorAll('#shortsTracker button')).find(b=>b.textContent==='Start mission').focus()`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await waitFor(`document.querySelectorAll('.tracker-lane[data-status="running"]').length===1`);
  // Correct the timer through the real form; no auto-completion at zero.
  assert.equal(await evaluate(`document.querySelector('.tracker-timer-form input').placeholder`), "00:00:00");
  assert.equal(await evaluate(`(()=>{ const input=document.querySelector('.tracker-timer-form input'); input.value='00:60:00'; return input.checkValidity(); })()`), false);
  await evaluate(`document.querySelector('.tracker-timer-form input').value='01:00:00'; document.querySelector('.tracker-timer-form').requestSubmit()`);
  assert.equal(await evaluate(`(()=>{const state=JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')); const job=Object.values(state.missions).find(j=>j.status==='running'); return Math.round((job.endsAt-Date.now())/1000);})()`), 3600);
  await click("Notify me");
  await waitFor(`window.permissionRequests===1`);
  assert.equal(await evaluate("Notification.permission"), "granted");
  await evaluate(`document.querySelector('.tracker-timer-form input').value='00:00:00'; document.querySelector('.tracker-timer-form').requestSubmit()`);
  await waitFor(`window.alerts.length===1`);
  assert.match(await evaluate("window.alerts[0].title"), /ready to confirm/);
  assert.equal(await evaluate("window.alerts[0].options.silent"), true);
  assert.equal(await evaluate(`document.querySelectorAll('.tracker-lane[data-status="due"]').length`), 1);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).completed.C1`), 0);
  await send("Page.reload");
  await waitFor(`document.querySelectorAll('.tracker-lane[data-status="due"]').length===1`);
  await delay(1100);
  assert.equal(await evaluate("window.alerts.length"), 0, "restored notification is not repeated");
  await click("Confirm finished");
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).completed.C1`), 1);
  await click("Start mission");
  await evaluate(`document.querySelector('.tracker-timer-form input').value='01:00:00'; document.querySelector('.tracker-timer-form').requestSubmit()`);
  const timersBefore = await evaluate(`Object.values(JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).missions).filter(j=>j.status==='running').map(j=>[j.name,j.endsAt,j.workers])`);
  await click("Update remaining plan");
  await waitFor(`Array.from(document.querySelectorAll('#shortsTracker button')).some(b=>b.textContent==='Update remaining plan'&&!b.disabled)&&!JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).needsUpdate`);
  const timersAfter = await evaluate(`Object.values(JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).missions).filter(j=>j.status==='running').map(j=>[j.name,j.endsAt,j.workers])`);
  assert.deepEqual(timersAfter, timersBefore);
  const snapshot = await evaluate(`localStorage.getItem('cifi-shorts-tracker-v1')`);
  await evaluate(`document.querySelector('#count-mining-pod').value='0'; document.querySelector('#count-mining-pod').dispatchEvent(new Event('change',{bubbles:true}))`);
  await click("Update remaining plan");
  assert.equal(await evaluate(`localStorage.getItem('cifi-shorts-tracker-v1')`), snapshot, "failed updates retain the tracker");
  await evaluate(`document.querySelector('#count-mining-pod').value='1000'; document.querySelector('#shorts-target-C1').value='12'; document.querySelector('#searchEffort').checked=true; document.querySelector('#count-mining-pod').dispatchEvent(new Event('change',{bubbles:true}))`);
  await evaluate(`document.querySelector('#runOptimizerBtn').click(); document.querySelector('#cancelOptimizerBtn').click()`);
  await waitFor(`!document.querySelector('#runOptimizerBtn').disabled`);
  assert.equal(await evaluate(`localStorage.getItem('cifi-shorts-tracker-v1')`), snapshot, "cancelled updates retain the tracker");
  await evaluate(`document.querySelector('#shorts-target-C1').value='2'; document.querySelector('#searchEffort').checked=false; document.querySelector('#count-mining-pod').dispatchEvent(new Event('change',{bubbles:true}))`);
  const screenshot = async (name, selector = '#shortsTracker') => {
    if (!process.env.CIFI_TRACKER_SCREENSHOTS && !process.argv.includes('--screenshots')) return;
    const clip = await evaluate(`(()=>{ const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}; })()`);
    const capture = await send("Page.captureScreenshot", { clip, captureBeyondViewport: true });
    const path = join(tmpdir(), `cifi-tracker-${name}.png`);
    await writeFile(path, Buffer.from(capture.data, "base64"));
    console.log(path);
  };
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await screenshot("desktop");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.tracker-grid')).gridTemplateColumns.split(' ').length`), 1);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.tracker-progress-fill')).animationName`), "none");
  assert.equal(await evaluate(`document.querySelector('#shortsTracker').scrollWidth <= document.querySelector('#shortsTracker').clientWidth`), true);
  assert.doesNotMatch(await evaluate(`document.querySelector('#shortsTracker').textContent`), /GMT|UTC/);
  await screenshot("mobile");
  assert.equal(await evaluate(`document.querySelector('#shorts-completed-C1').disabled`), false, "campaign progress remains editable while tracking");
  await evaluate(`document.querySelector('#shorts-completed-C1').value='0'; document.querySelector('#shorts-completed-C1').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await evaluate(`localStorage.getItem('cifi-shorts-tracker-v1')`), null, "manual progress replaces the old tracking session");
  await click("Run Optimizer");
  await waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Track this plan'&&!b.disabled&&!b.closest('[hidden]'))`);
  await click("Track this plan");
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).completed.C1`), 0);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).missions['C1-1'].status`), "queued");
  await click("Start a fresh plan");
  assert.equal(await evaluate(`localStorage.getItem('cifi-shorts-tracker-v1')`), null);
  assert.equal(await evaluate(`['C1','C2','C3','C4'].every(key=>document.querySelector('#shorts-completed-'+key).value==='0'&&!document.querySelector('#shorts-running-'+key).checked)`), true);
  assert.equal(await evaluate(`document.querySelector('#count-mining-pod').value`), "1000", "fresh plans preserve personnel");
  await click("Run Optimizer");
  await waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Track this plan'&&!b.disabled&&!b.closest('[hidden]'))`);
  await click("Track this plan");
  await evaluate(`window.confirm=()=>true; document.querySelector('#resetInputsBtn').click()`);
  assert.equal(await evaluate(`localStorage.getItem('cifi-shorts-tracker-v1')`), null);
  assert.equal(await evaluate(`document.querySelector('#shortsTracker').hidden`), true);
  assert.equal(await evaluate(`document.querySelector('#plannerModeLabel').textContent`), "Campaign Planner");
  assert.equal(await evaluate(`document.querySelector('#shortsBeta').hidden`), false);
  await evaluate(`document.querySelector('#campaignEnabled').click();
    document.querySelector('#count-mining-pod').value='1000'; document.querySelector('#power-mining-pod').value='10000';
    document.querySelector('#shorts-target-C1').value='2'; document.querySelector('#campaignFarmClearAllBtn').click();`);
  assert.equal(await evaluate(`document.querySelector('#shorts-target-C4').closest('fieldset').hidden`), true);
  assert.equal(await evaluate(`document.querySelector('#shorts-target-C1').options.length`), 9);
  assert.equal(await evaluate(`document.querySelectorAll('.future-farm-input').length`), 9);
  await click("Run Optimizer");
  await waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Track this plan'&&!b.disabled&&!b.closest('[hidden]'))`);
  assert.match(await evaluate(`document.querySelector('#modeUsedText').textContent`), /Campaign Planner/);
  await click("Track this plan");
  await waitFor(`document.querySelectorAll('.tracker-lane').length===3`);
  await click("Start mission");
  const normalTimer = await evaluate(`JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).missions['C1-1'].endsAt`);
  await send("Page.reload");
  await waitFor(`document.querySelectorAll('.tracker-lane').length===3`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).missions['C1-1'].endsAt`), normalTimer);
  assert.equal(await evaluate(`document.querySelector('#shortsBeta').hidden`), false);
  await evaluate(`document.querySelector('#ouroToggle').click()`);
  assert.equal(await evaluate(`localStorage.getItem('cifi-shorts-tracker-v1')`), null);
  assert.equal(await evaluate(`document.querySelector('#plannerModeLabel').textContent`), "Shorts Mode");
  assert.equal(await evaluate(`document.querySelector('#shortsBeta').hidden`), false);
  assert.equal(await evaluate(`document.querySelector('#shorts-target-C4').closest('fieldset').hidden`), false);
  assert.equal(await evaluate(`document.querySelector('#shorts-target-C1').options.length`), 13);
  assert.equal(await evaluate(`document.querySelectorAll('.future-farm-input').length`), 16);
  await evaluate(`document.querySelector('#shorts-target-C4').value='12'; document.querySelector('#shorts-target-C1').value='12'; document.querySelector('#ouroToggle').click()`);
  assert.equal(await evaluate(`document.querySelector('#shorts-target-C4').value`), "0");
  assert.equal(await evaluate(`document.querySelector('#shorts-target-C1').value`), "8");
  assert.equal(await evaluate(`document.querySelector('#shortsOutput').classList.contains('hidden')`), true);
  assert.equal(await evaluate(`document.querySelector('#faq h2').textContent`), "FAQ");
  for (const seconds of [3600, 30]) {
    const startedAt = Date.now();
    await evaluate(`window.confirm=()=>true; document.querySelector('#resetInputsBtn').click();
      document.querySelector('#campaignEnabled').click();
      document.querySelector('#count-mining-pod').value='1000'; document.querySelector('#power-mining-pod').value='10000';
      document.querySelector('#shorts-target-C1').value='2'; document.querySelector('#campaignFarmClearAllBtn').click();
      document.querySelector('#shorts-running-C1').checked=true;
      document.querySelector('#shorts-active-C1-0').value='1';
      document.querySelector('#shorts-hours-C1').value='${seconds === 3600 ? "01:00:00" : "00:00:30"}';
      window.testNow=${startedAt}; window.optimizerTimeAdvance=60000;`);
    await click("Run Optimizer");
    await waitFor(`document.querySelector('#statusText').textContent==='Plan complete.'`);
    assert.equal(await evaluate(`document.querySelector('#shortsVerification').textContent`), "Plan complete.");
    // Waiting before tracking must not restart an imported timer either.
    await evaluate(`window.testNow += 15000`);
    await click("Track this plan");
    const imported = await evaluate(`JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).missions['C1-1']`);
    assert.equal(imported.endsAt, startedAt + seconds * 1000, "search and preview time must not extend imported timers");
    assert.equal(imported.status, "running", "elapsed timers remain locked until confirmed");
    assert.equal(await evaluate(`document.querySelector('.tracker-lane[data-section="C1"]').dataset.status`), seconds === 30 ? "due" : "running");
    await send("Page.reload");
    await waitFor(`document.querySelectorAll('.tracker-lane').length===3`);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).missions['C1-1'].endsAt`), imported.endsAt);
  }
  const legacySettings = JSON.parse(savedSettings);
  legacySettings.input.shortsEnabled = false;
  legacySettings.input.campaignTargetName = "C3-5";
  for (const progress of Object.values(legacySettings.input.shortsProgress)) progress.target = 0;
  const legacySeed = await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.removeItem('cifi-shorts-tracker-v1');
    localStorage.setItem('cifi-farm-mission-optimizer-state-v3', ${JSON.stringify(JSON.stringify(legacySettings))});
  ` });
  await send("Page.reload");
  await waitFor(`document.documentElement.dataset.appVersion && document.querySelector('#shorts-target-C3').value==='5'`);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: legacySeed.identifier });
  assert.equal(await evaluate(`document.querySelector('#campaignEnabled').checked`), true);
  assert.equal(await evaluate(`document.querySelector('#shortsControls').classList.contains('hidden')`), false);
  await click("Run Optimizer");
  await waitFor(`document.querySelector('#statusText').textContent==='Plan complete.'`);
  await click("Track this plan");
  assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).targets`), { C1: 8, C2: 8, C3: 5, C4: 0 });
  await evaluate(`document.querySelector('#campaignEnabled').click()`);
  assert.equal(await evaluate(`localStorage.getItem('cifi-shorts-tracker-v1')`), null);
  await click("Run Optimizer");
  await waitFor(`document.querySelector('#statusText').textContent==='Completed'`);
  assert.equal(await evaluate(`document.querySelector('#shortsOutput').classList.contains('hidden')`), true, "disabling the planner leaves farm-only optimisation");
  // Restore the reported surplus farm and exercise its confirmation in the app.
  const surplusSave = await evaluate(`(async () => {
    const {createDefaultInput}=await import('./src/validation.js');
    const {optimizeShorts}=await import('./src/shorts-optimizer.js');
    const {createTracker,saveTracker}=await import('./src/shorts-tracker.js');
    const {saveState}=await import('./src/state.js');
    const input=createDefaultInput();
    Object.assign(input,{ouroUnlocked:true,campaignEnabled:true,shortsEnabled:true,relic11Level:3});
    [[6.5,11393],[13,6259],[22,3009],[41,1967]].forEach(([power,count],index)=>{input.workers[Object.keys(input.workers)[index]]={power,count};});
    Object.assign(input.modifiers,{engineeringBadge:true,swarmLevel:40,productivityLevel:11,research58:6,research70:6,research80:2,relic3:40,ts07Enabled:true});
    [[8,12],[8,12],[9,12],[0,8]].forEach(([completed,target],index)=>{input.shortsProgress['C'+(index+1)]={completed,target,active:null};});
    input.selectedCampaignFarmMissions=['F1-1','F1-2','F1-3','F2-1','F2-2','F3-1'];
    input.selectedFarmMissions=[...input.selectedCampaignFarmMissions];
    const state=createTracker(await optimizeShorts(input),input);
    state.farms['F1-3'].workers['Combat Corvette']=19;
    state.farms['F1-3'].workers['Titan Hauler']=1;
    saveState(input); saveTracker(state);
    return {settings:localStorage.getItem('cifi-farm-mission-optimizer-state-v3'),tracker:localStorage.getItem('cifi-shorts-tracker-v1')};
  })()`);
  const surplusSeed = await send("Page.addScriptToEvaluateOnNewDocument", {source: `localStorage.setItem('cifi-farm-mission-optimizer-state-v3',${JSON.stringify(surplusSave.settings)}); localStorage.setItem('cifi-shorts-tracker-v1',${JSON.stringify(surplusSave.tracker)});`});
  await send("Page.reload");
  await waitFor(`document.querySelector('.tracker-actions')?.textContent.includes('Reduce F1-3 to 18 Combat Corvettes')`);
  await send("Page.removeScriptToEvaluateOnNewDocument", {identifier:surplusSeed.identifier});
  await click("Update remaining plan");
  await waitFor(`Array.from(document.querySelectorAll('.tracker-actions button')).some(button=>button.textContent==='Confirm reduced crew'&&!button.disabled)`);
  await click("Confirm reduced crew");
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).farms['F1-3'].workers['Combat Corvette']`), 18, await evaluate(`document.querySelector('#shortsTracker').innerText`));
  await click("Update remaining plan");
  await waitFor(`Array.from(document.querySelectorAll('.tracker-actions button')).filter(button=>button.textContent==='Start mission'&&!button.disabled).length===4`);
  assert.ok(await evaluate(`document.querySelector('.tracker-actions').textContent.includes('concurrently')`));
  for (let launch=0; launch<4; launch++) await click("Start mission");
  assert.equal(await evaluate(`Object.values(JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).missions).filter(job=>job.status==='running').length`), 4);
  // Away mode uses an absolute local return time, survives reopening, and
  // preserves actual running timers when it is enabled for an existing plan.
  const awayTimers = await evaluate(`Object.values(JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).missions).filter(job=>job.status==='running').map(job=>[job.name,job.endsAt,job.workers])`);
  assert.equal(await evaluate(`document.querySelector('#awayEnabled').checked`), false);
  await evaluate(`document.querySelector('#awayEnabled').click()`);
  assert.equal(await evaluate(`document.querySelector('#awayFields').hidden`), false);
  const returnAt = await evaluate(`new Date(document.querySelector('#awayUntil').value).getTime()`);
  assert.ok(returnAt > Date.now());
  await click("Update remaining plan");
  await waitFor(`document.querySelector('#statusText').textContent==='Plan complete.' && JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).input.awayEnabled`);
  assert.ok(await evaluate(`document.querySelector('#shortsSummary').textContent.includes('Away mode')`));
  assert.deepEqual(await evaluate(`Object.values(JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).missions).filter(job=>job.status==='running').map(job=>[job.name,job.endsAt,job.workers])`), awayTimers);
  assert.ok(await evaluate(`JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).result.shortsPlan.jobs.every(job=>job.startHours===0 || job.startHours>=JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).result.shortsPlan.awayHours)`));
  await send("Page.reload");
  await waitFor(`document.querySelector('.tracker-away-help')?.textContent.includes('Away mode')`);
  assert.equal(await evaluate(`new Date(document.querySelector('#awayUntil').value).getTime()`), returnAt);
  assert.equal(await evaluate(`document.querySelector('#awayEnabled').checked`), true);
  await send("Emulation.setDeviceMetricsOverride", {width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('.away-controls').scrollIntoView()`);
  assert.ok(await evaluate(`document.querySelector('#awayUntil').getBoundingClientRect().right <= innerWidth`));
  await screenshot("away-mobile", ".away-controls");
  await send("Emulation.setDeviceMetricsOverride", {width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await screenshot("away-desktop", ".away-controls");
  await evaluate(`document.querySelector('#awayEnabled').click()`);
  await click("Update remaining plan");
  await waitFor(`!JSON.parse(localStorage.getItem('cifi-shorts-tracker-v1')).input.awayEnabled`);
  assert.equal(await evaluate(`document.querySelector('.tracker-away-help').hidden`), true);
  assert.deepEqual(exceptions, []);
  console.log("Browser checks passed: keyboard starts, manual completion, corrections, opt-in notifications, deduplication, refresh, live replan, failed/cancelled updates, reset, mobile, reduced motion, Campaign Planner, Ouroboros switching, and Away mode persistence and locked timers.");
} finally {
  socket?.close();
  browser.kill();
  server.close();
  await delay(500);
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()));
  assert.ok(profile.startsWith(join(tmpdir(), "cifi-tracker-check-")));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
