
const MATS = ["Difar","Kento","Chromium","Exon","Organium","Adamorphium","Moskom","Darkseid"];
const TYPE_ORDER = ["Mining Pod","Fireteam Carrier","Titan Hauler","Combat Corvette"];
const TYPE_RANK = {
  "Mining Pod": 1,
  "Fireteam Carrier": 2,
  "Titan Hauler": 3,
  "Combat Corvette": 4
};

const MISSION_DATA = [{"name":"F1-1","minutes":30.0,"cap":20,"academy":5.0,"fragments":0.0,"rewards":{"Difar":38.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"F1-2","minutes":360.0,"cap":60,"academy":150.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":320.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"F1-3","minutes":2400.0,"cap":100,"academy":1200.0,"fragments":0.0,"rewards":{"Difar":1350.0,"Kento":280.0,"Chromium":760.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"F1-4","minutes":6000.0,"cap":120,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"F2-1","minutes":150.0,"cap":80,"academy":35.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":35.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"F2-2","minutes":2400.0,"cap":160,"academy":170.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":560.0,"Exon":0.0,"Organium":80.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"F2-3","minutes":72000.0,"cap":500,"academy":11500.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":2200.0,"Organium":320.0,"Adamorphium":260.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"F2-4","minutes":132000.0,"cap":1000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"F3-1","minutes":3000.0,"cap":150,"academy":2000.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":19.0,"Darkseid":0.0}},
  {"name":"F3-2","minutes":975000.0,"cap":2000,"academy":1000000.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":80.0}},
  {"name":"F3-3","minutes":1875000.0,"cap":4000,"academy":2000000.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":5200.0,"Adamorphium":2440.0,"Moskom":4000.0,"Darkseid":160.0}},
  {"name":"F3-4","minutes":3900000.0,"cap":8000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"F4-1","minutes":21000.0,"cap":1000,"academy":17000.0,"fragments":0.0,"rewards":{"Difar":40.0,"Kento":60.0,"Chromium":0.0,"Exon":0.0,"Organium":50.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"F4-2","minutes":4875000.0,"cap":10000,"academy":3300000.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":8000.0,"Exon":0.0,"Organium":0.0,"Adamorphium":7000.0,"Moskom":0.0,"Darkseid":2000.0}},
  {"name":"F4-3","minutes":9750000.0,"cap":20000,"academy":6700000.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":30000.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":20000.0,"Darkseid":5000.0}},
  {"name":"F4-4","minutes":19500000.0,"cap":40000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C1-1","minutes":5.0,"cap":5,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C1-2","minutes":30.0,"cap":10,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C1-3","minutes":900.0,"cap":20,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C1-4","minutes":2400.0,"cap":30,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C1-5","minutes":7800.0,"cap":40,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C1-6","minutes":16200.0,"cap":60,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C1-7","minutes":36600.0,"cap":70,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C1-8","minutes":90000.0,"cap":100,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C1-9","minutes":192000000.0,"cap":750,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C1-10","minutes":288000000.0,"cap":1000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C1-11","minutes":426000000.0,"cap":1250,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C1-12","minutes":852000000.0,"cap":1500,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C2-1","minutes":150000.0,"cap":100,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C2-2","minutes":195000.0,"cap":120,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C2-3","minutes":270000.0,"cap":140,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C2-4","minutes":405000.0,"cap":160,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C2-5","minutes":480000.0,"cap":180,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C2-6","minutes":570000.0,"cap":200,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C2-7","minutes":840000.0,"cap":300,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C2-8","minutes":3600000.0,"cap":500,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C2-9","minutes":576000000.0,"cap":1500,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C2-10","minutes":1128000000.0,"cap":3000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C2-11","minutes":2184000000.0,"cap":6000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C2-12","minutes":6552000000.0,"cap":12000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C3-1","minutes":3000000.0,"cap":500,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C3-2","minutes":4500000.0,"cap":600,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C3-3","minutes":6000000.0,"cap":700,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C3-4","minutes":7500000.0,"cap":800,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C3-5","minutes":9000000.0,"cap":900,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C3-6","minutes":10500000.0,"cap":1000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C3-7","minutes":24000000.0,"cap":1100,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C3-8","minutes":45000000.0,"cap":1200,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C3-9","minutes":5760000000.0,"cap":8750,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C3-10","minutes":11280000000.0,"cap":17500,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C3-11","minutes":15780000000.0,"cap":30000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C3-12","minutes":29280000000.0,"cap":35000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C4-1","minutes":144000000.0,"cap":2800,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C4-2","minutes":195000000.0,"cap":3000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C4-3","minutes":240000000.0,"cap":3600,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C4-4","minutes":300000000.0,"cap":3900,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C4-5","minutes":390000000.0,"cap":4200,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C4-6","minutes":660000000.0,"cap":4500,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C4-7","minutes":900000000.0,"cap":4800,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C4-8","minutes":1920000000.0,"cap":5000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C4-9","minutes":57600000000.0,"cap":30000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C4-10","minutes":172800000000.0,"cap":50000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C4-11","minutes":518400000000.0,"cap":70000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}},
  {"name":"C4-12","minutes":2155196371763.288,"cap":90000,"academy":0.0,"fragments":0.0,"rewards":{"Difar":0.0,"Kento":0.0,"Chromium":0.0,"Exon":0.0,"Organium":0.0,"Adamorphium":0.0,"Moskom":0.0,"Darkseid":0.0}}];
const CAMPAIGN_BASE_CAPS = {};
MISSION_DATA.forEach(row => {
  if (/^C\d+-\d+$/i.test(row.name)) {
    CAMPAIGN_BASE_CAPS[row.name] = row.cap;
  }
});
const OURO_OFF_VISIBLE_FARMS = new Set(["F1-1","F1-2","F1-3","F2-1","F2-2","F2-3","F3-1","F3-2","F3-3"]);
const OURO_OFF_VISIBLE_CAMPAIGNS = new Set([
  "C1-9","C1-10","C1-11","C1-12",
  "C2-9","C2-10","C2-11","C2-12",
  "C3-9","C3-10","C3-11","C3-12",
  "C4-1","C4-2","C4-3","C4-4","C4-5","C4-6","C4-7","C4-8","C4-9","C4-10","C4-11","C4-12"
]);
const ALL_MODE_OPTIONS = ["Fragments + Resources", "Fragments", "Maximising Resources", "Academy Points", "Max Completions"];
const OURO_REQUIRED_MODE_OPTIONS = new Set(["Fragments + Resources", "Fragments"]);

const CURRENT_VERSION = "web-v2";
const STORAGE_KEY = "cifi-farm-mission-optimizer-state-v1";
const MIN_DURATION_MINS = 2.0 / 60.0;
const EPS = 1e-9;
const NEAR_BEST_POOL_PCT = 0.05;
const LOCAL_IMPROVE_MAX_ITERS = 250;
const MULTISTART_MIN_RUNS = 3;
const MULTISTART_MAX_RUNS = 7;
const MULTISTART_STALE_LIMIT = 2;
const MULTISTART_TOP_K = 3;
const LOCAL_POLISH_MAX_PASSES = 5;
const LOCAL_POLISH_MAX_MOVES = 100;
const TYPE_REBUILD_MAX_UNITS = 8;
const FRAGMENT_SHORTLIST_SIZE = 6;
const RESOURCE_SHORTLIST_SIZE = 6;
const SA_INITIAL_TEMP = 1.0;
const SA_COOLING_RATE = 0.995;
const SA_MIN_TEMP = 0.001;
const SA_MAX_ITERATIONS = 2000;
const SA_SWAP_PROBABILITY = 0.35;

function isFx4Mission_(missionName) {
  return /^F\d+-4$/i.test(missionName);
}

const FX4_FRAGMENT_BONUS = { 'F1-4': 1, 'F2-4': 5, 'F3-4': 50, 'F4-4': 200 };

function getFx4FragmentBonusMultiplier_(missionName) {
  return FX4_FRAGMENT_BONUS[missionName] || 0;
}

const tabButtons = document.querySelectorAll('.tab-button');
const tabPanels = document.querySelectorAll('.tab-panel');
const jumpButtons = document.querySelectorAll('.jump-button');
const ouroToggle = document.getElementById('ouroToggle');
const ouroOnlyBlocks = document.querySelectorAll('.ouro-only');
const modeSelect = document.getElementById('modeSelect');
const campaignTargetSelect = document.getElementById('campaignTarget');
const runOptimizerBtn = document.getElementById('runOptimizerBtn');
const resetInputsBtn = document.getElementById('resetInputsBtn');
const missionSelectAllBtn = document.getElementById('missionSelectAllBtn');
const missionClearAllBtn = document.getElementById('missionClearAllBtn');

const ALL_FARM_MISSIONS = MISSION_DATA
  .filter(m => !isCampaignName_(m.name))
  .map(m => m.name);
const ALL_CAMPAIGN_MISSIONS = MISSION_DATA
  .filter(m => isCampaignName_(m.name))
  .map(m => m.name);

let missionSelectionState = {};

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.tab;
    tabButtons.forEach((btn) => btn.classList.remove('active'));
    tabPanels.forEach((panel) => panel.classList.remove('active'));
    button.classList.add('active');
    document.getElementById(target).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

jumpButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const targetId = button.dataset.jump;
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

function getVisibleCampaignMissionNames_(ouroUnlocked) {
  return ALL_CAMPAIGN_MISSIONS.filter(name => ouroUnlocked || OURO_OFF_VISIBLE_CAMPAIGNS.has(name));
}

function renderModeOptions_() {
  const prev = modeSelect.value;
  const ouroUnlocked = ouroToggle.checked;
  const allowed = ALL_MODE_OPTIONS.filter(mode => ouroUnlocked || !OURO_REQUIRED_MODE_OPTIONS.has(mode));
  modeSelect.innerHTML = allowed.map(mode => `<option>${mode}</option>`).join('');
  if (allowed.includes(prev)) {
    modeSelect.value = prev;
  } else {
    modeSelect.value = 'Maximising Resources';
  }
}

function renderCampaignTargets_() {
  const previous = campaignTargetSelect.value;
  const visible = getVisibleCampaignMissionNames_(ouroToggle.checked);
  campaignTargetSelect.innerHTML = visible.map(name => `<option>${name}</option>`).join('');

  if (visible.includes(previous)) {
    campaignTargetSelect.value = previous;
  } else if (visible.includes('C4-11')) {
    campaignTargetSelect.value = 'C4-11';
  } else if (visible.length > 0) {
    campaignTargetSelect.value = visible[0];
  }
}


let DEFAULT_FORM_STATE = null;

function collectFormState_() {
  const controls = document.querySelectorAll('#optimizer input[id], #optimizer select[id]');
  const values = {};
  controls.forEach((el) => {
    if (el.type === 'checkbox') {
      values[el.id] = !!el.checked;
    } else {
      values[el.id] = el.value;
    }
  });
  return {
    version: CURRENT_VERSION,
    values,
    missionSelectionState: { ...missionSelectionState }
  };
}

function saveState_() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(collectFormState_()));
  } catch (err) {
    console.warn('Unable to save optimizer state.', err);
  }
}

function applyFormState_(state) {
  if (!state || !state.values) return;

  const values = state.values || {};

  if (typeof values.ouroToggle === 'boolean') {
    ouroToggle.checked = values.ouroToggle;
  }

  Object.entries(values).forEach(([id, value]) => {
    if (id === 'ouroToggle' || id === 'modeSelect' || id === 'campaignTarget') return;
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = !!value;
    } else {
      el.value = value;
    }
  });

  missionSelectionState = { ...(state.missionSelectionState || {}) };
  syncOuroVisibility();

  if (values.modeSelect && Array.from(modeSelect.options).some(opt => opt.value === values.modeSelect)) {
    modeSelect.value = values.modeSelect;
  }

  if (values.campaignTarget && Array.from(campaignTargetSelect.options).some(opt => opt.value === values.campaignTarget)) {
    campaignTargetSelect.value = values.campaignTarget;
  }

  renderFarmMissionSelection_();
}

function applyZeroDefaults_() {
  const controls = document.querySelectorAll('#optimizer input[id], #optimizer select[id]');

  controls.forEach((el) => {
    if (el.type === 'checkbox') {
      el.checked = false;
    } else if (el.type === 'number') {
      el.value = 0;
    } else if (el.tagName === 'SELECT') {
      el.selectedIndex = 0;
    }
  });

  missionSelectionState = {};
  syncOuroVisibility();
  renderFarmMissionSelection_();
}

function restoreSavedState_() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    applyFormState_(parsed);
    return true;
  } catch (err) {
    console.warn('Unable to restore optimizer state.', err);
    return false;
  }
}

function clearOutput_() {
  document.getElementById('campaignEtaText').textContent = '—';
  document.getElementById('modeUsedText').textContent = modeSelect.value;
  document.getElementById('totalsBody').innerHTML = '<tr><td colspan="2">Run the optimiser to populate totals.</td></tr>';
  document.getElementById('distributionBody').innerHTML = '<tr><td colspan="5">Run the optimiser to populate mission distribution.</td></tr>';
  setStatus_('Ready');
}

function resetToDefaults_() {
  if (!DEFAULT_FORM_STATE) return;
  missionSelectionState = {};
  applyFormState_(DEFAULT_FORM_STATE);
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Unable to clear optimizer state.', err);
  }
  clearOutput_();
}

function initPersistence_() {
  const restored = restoreSavedState_();

  if (!restored) {
    applyZeroDefaults_();
  }

  syncOuroVisibility();
  DEFAULT_FORM_STATE = collectFormState_();

  const optimizerPanel = document.getElementById('optimizer');

  optimizerPanel.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.matches('input[id], select[id]')) return;
    saveState_();
  });

  optimizerPanel.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.matches('input[id], select[id]')) return;
    saveState_();
  });
}

function syncOuroVisibility() {
  const show = ouroToggle.checked;
  ouroOnlyBlocks.forEach((block) => {
    block.classList.toggle('hidden', !show);
  });

  renderModeOptions_();
  renderCampaignTargets_();
  renderFarmMissionSelection_();
}

ouroToggle.addEventListener('change', () => { syncOuroVisibility(); saveState_(); });
missionSelectAllBtn.addEventListener('click', () => {
  getVisibleFarmMissionNames_(ouroToggle.checked).forEach(name => {
    missionSelectionState[name] = true;
  });
  renderFarmMissionSelection_();
  saveState_();
});
missionClearAllBtn.addEventListener('click', () => {
  getVisibleFarmMissionNames_(ouroToggle.checked).forEach(name => {
    missionSelectionState[name] = false;
  });
  renderFarmMissionSelection_();
  saveState_();
});
syncOuroVisibility();

resetInputsBtn.addEventListener('click', () => resetToDefaults_());
runOptimizerBtn.addEventListener('click', () => { saveState_(); runOptimizerWeb(); });

function scrollToOutput_() {
  const output = document.getElementById('output');
  if (!output) return;
  window.requestAnimationFrame(() => {
    output.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function clamp_(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}


function typeKey_(type) {
  return String(type || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeMode_(value) {
  return String(value || "").trim().toLowerCase();
}

function getVisibleFarmMissionNames_(ouroUnlocked) {
  return ALL_FARM_MISSIONS.filter(name => ouroUnlocked || OURO_OFF_VISIBLE_FARMS.has(name));
}

function renderFarmMissionSelection_() {
  const container = document.getElementById('farmMissionSelectionGrid');
  if (!container) return;

  const visible = getVisibleFarmMissionNames_(ouroToggle.checked);
  visible.forEach(name => {
    if (!(name in missionSelectionState)) missionSelectionState[name] = true;
  });

  const tiers = { F1: [], F2: [], F3: [], F4: [] };
  visible.forEach(name => {
    const tier = String(name).split('-')[0];
    if (tiers[tier]) tiers[tier].push(name);
  });

  const tierMarkup = Object.entries(tiers)
    .filter(([, names]) => names.length > 0)
    .map(([tier, names]) => {
      const selectedCount = names.reduce((sum, name) => sum + (missionSelectionState[name] !== false ? 1 : 0), 0);
      const countLabel = `${selectedCount} selected`;

      return `
        <div class="mission-tier-card">
          <div class="mission-tier-header">
            <h3>${tier}</h3>
            <span class="mission-tier-count">${countLabel}</span>
          </div>
          <div class="mission-tile-grid">
            ${names.map(name => `
              <label class="mission-tile ${missionSelectionState[name] ? 'is-checked' : ''}">
                <input class="mission-tile-input" type="checkbox" value="${name}" ${missionSelectionState[name] ? 'checked' : ''} />
                <span>${name}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = tierMarkup || '<div class="mission-tier-empty">No farm missions are currently visible.</div>';

  container.querySelectorAll('.mission-tile-input').forEach(input => {
    input.addEventListener('change', () => {
      missionSelectionState[input.value] = input.checked;
      renderFarmMissionSelection_();
      saveState_();
    });
  });
}

function getSelectedFarmMissionNames_() {
  const selected = new Set();
  getVisibleFarmMissionNames_(ouroToggle.checked).forEach(name => {
    if (missionSelectionState[name] !== false) selected.add(name);
  });
  return selected;
}

function isCampaignName_(name) {
  return /^C\d+-\d+$/i.test(String(name || "").trim());
}

function getCampaignBaseWeight_(focus) {
  switch (String(focus || "").trim()) {
    case "Prioritize Campaign":
      return 0.50;
    case "Prioritize Farms":
      return 0.20;
    case "Even Consideration":
    default:
      return 0.35;
  }
}

function getGlobalSpeedMultiplierFromUi_() {
  const engineeringBadge = document.getElementById('engineeringBadge').checked;
  const swarmLevel = parseFloat(document.getElementById('swarmLevel').value) || 0;
  const productivityLevel = parseFloat(document.getElementById('productivityLevel').value) || 0;
  const research58 = parseFloat(document.getElementById('research58').value) || 0;
  const research70 = parseFloat(document.getElementById('research70').value) || 0;
  const research80 = parseFloat(document.getElementById('research80').value) || 0;
  const relic3 = ouroToggle.checked ? (parseFloat(document.getElementById('relic3').value) || 0) : 0;
  let mult = 1.0;
  mult *= engineeringBadge ? 2.0 : 1.0;
  mult *= Math.pow(1.0311, swarmLevel);
  mult *= Math.pow(1.1, productivityLevel);
  mult *= (research58 >= 1 ? 1.05 : 1.0);
  mult *= (research58 >= 3 ? 1.05 : 1.0);
  mult *= (research58 >= 5 ? 1.05 : 1.0);
  mult *= (research70 >= 5 ? 2.0 : 1.0);
  mult *= (research80 >= 5 ? 1.5 : 1.0);
  if (ouroToggle.checked) {
    mult *= (relic3 * 0.03) + 1.0;
  }
  return mult;
}

function getUiState_() {
  const workers = {};
  const workerPowers = {};
  TYPE_ORDER.forEach(type => {
    const power = parseFloat(document.getElementById(`power-${typeKey_(type)}`).value) || 0;
    const count = parseInt(document.getElementById(`count-${typeKey_(type)}`).value || '0', 10) || 0;
    workers[type] = { power, count };
    workerPowers[type] = power;
  });

  const weights = {};
  MATS.forEach(mat => {
    const value = document.getElementById(`priority-${mat}`).value;
    weights[mat] = value === "Boosted" ? 10.0 : 1.0;
  });

  const ouroUnlocked = ouroToggle.checked;
  const baseFragments = ouroUnlocked ? (parseFloat(document.getElementById('baseFragmentsInput').value) || 0) : 0;

  return {
    ouroUnlocked,
    workers,
    workerPowers,
    weights,
    selectedFarmMissions: getSelectedFarmMissionNames_(),
    modeRaw: modeSelect.value,
    modeNorm: normalizeMode_(modeSelect.value),
    fragmentsPerCompletion: baseFragments,
    campaignEnabled: document.getElementById('campaignEnabled').checked,
    campaignTargetName: document.getElementById('campaignTarget').value,
    campaignFocus: document.getElementById('campaignFocus').value,
    relic11Level: parseInt(document.getElementById('relic11').value || '0', 10) || 0,
    globalSpeedMult: getGlobalSpeedMultiplierFromUi_(),
    ts07Enabled: ouroToggle.checked ? document.getElementById('ts07').checked : false
  };
}

function getCampaignRelic11Multiplier_(ui) {
  if (!ui.ouroUnlocked) return 1;

  const relicLevel = Math.max(0, ui.relic11Level || 0);
  return 1 + (relicLevel * 0.5);
}

function getEffectiveCampaignCap_(missionName, ui) {
  const baseCap = CAMPAIGN_BASE_CAPS[missionName];
  if (baseCap == null) return null;

  return Math.round(baseCap * getCampaignRelic11Multiplier_(ui));
}

function buildMissionPool_(ui) {
  let campaignMission = null;
  const missions = [];

  MISSION_DATA.forEach(row => {
    const anyReward = MATS.some(mat => (row.rewards[mat] || 0) > 0);
    const isCampaignRow = isCampaignName_(row.name) && !anyReward && (row.academy || 0) <= 0;

    if (!isCampaignRow && !ui.ouroUnlocked && !OURO_OFF_VISIBLE_FARMS.has(row.name)) {
      return;
    }

    if (isCampaignRow && !ui.ouroUnlocked && !OURO_OFF_VISIBLE_CAMPAIGNS.has(row.name)) {
      return;
    }

    if (!isCampaignRow && ui.selectedFarmMissions && !ui.selectedFarmMissions.has(row.name)) {
      return;
    }

    const baseCap = isCampaignRow
      ? (CAMPAIGN_BASE_CAPS[row.name] ?? row.cap)
      : row.cap;

    const effectiveCap = isCampaignRow
      ? getEffectiveCampaignCap_(row.name, ui)
      : row.cap;

    const mission = {
      id: missions.length,
      name: row.name,
      baseCap,
      cap: effectiveCap,
      baseMins: row.minutes,
      baseAcademy: row.academy || 0,
      baseFragments: getFx4FragmentBonusMultiplier_(row.name) * ui.fragmentsPerCompletion || (row.fragments || 0),
      baseRewards: { ...row.rewards },
      isCampaign: isCampaignRow,
      assignedUnits: 0,
      currentPower: 0,
      currentRunsPerHour: 0
    };

    missions.push(mission);

    if (ui.campaignEnabled && row.name === ui.campaignTargetName) {
      campaignMission = mission;
    }
  });

  if (ui.campaignEnabled && !campaignMission) {
    throw new Error(`Campaign target "${ui.campaignTargetName}" was not found.`);
  }

  return { missions, campaignMission };
}

function runOptimizerWeb() {
  setStatus_("Running...");
  try {
    const ui = getUiState_();
    const { missions, campaignMission } = buildMissionPool_(ui);

    const result = solveOptimizer_(ui, missions, campaignMission);
    renderResult_(ui, result);
    setStatus_("Completed");
  } catch (err) {
    console.error(err);
    setStatus_("Error");
    renderError_(err);
  } finally {
    scrollToOutput_();
  }
}

function solveOptimizer_(ui, missions, campaignMission) {
  const modeNorm = ui.modeNorm;
  const campaignBaseWeight = getCampaignBaseWeight_(ui.campaignFocus);

  const isAcademyMode   = (modeNorm === "academy points");
  const isMaxCompMode   = (modeNorm === "max completions");
  const isResourcesMode = (modeNorm === "maximising resources");
  const isFragmentsMode =
    (modeNorm === "farm fragments") ||
    (modeNorm === "fragments farm") ||
    (modeNorm === "fragments") ||
    (modeNorm === "fragments farming");
  const isFragResMode =
    (modeNorm === "fragments + resources") ||
    (modeNorm === "fragments and resources") ||
    (modeNorm === "fragment/resource hybrid") ||
    (modeNorm === "hybrid fragments/resources");

  let workers = JSON.parse(JSON.stringify(ui.workers));
  const workerPowers = ui.workerPowers;
  const weights = ui.weights;
  const globalSpeedMult = ui.globalSpeedMult;
  const ts07Mult = ui.ts07Enabled ? 2.0 : 1.0;
  const fragmentsPerCompletion = ui.fragmentsPerCompletion;
  let assignmentMap = {};
  let totals = { Academy: 0, Completions: 0, Fragments: 0 };
  MATS.forEach(m => totals[m] = 0);
  let missionWorkerCounts = {};
  missions.forEach(m => missionWorkerCounts[m.name] = {});

  function missionRunsPerHour(baseMins, totalPower) {
    if (!totalPower || totalPower <= 0) return 0;
    const rawMinutes = baseMins / (globalSpeedMult * totalPower);
    const actualMinutes = Math.max(rawMinutes, MIN_DURATION_MINS);
    return 60.0 / actualMinutes;
  }

  function campaignETAHours(mission, totalPower) {
    if (!mission || !totalPower || totalPower <= 0) return Infinity;
    const rawMinutes = mission.baseMins / (globalSpeedMult * totalPower);
    const actualMinutes = Math.max(rawMinutes, MIN_DURATION_MINS);
    return actualMinutes / 60.0;
  }

  function currentCampaignETA() {
    if (!campaignMission) return Infinity;
    return campaignETAHours(campaignMission, campaignMission.currentPower);
  }

  function urgencyMultiplier(etaHours) {
    if (!ui.campaignEnabled || !campaignMission) return 1.0;
    if (!isFinite(etaHours)) return 1.50;
    const x = Math.log10(1 + Math.max(0, etaHours));
    return clamp_(1.00 + 0.15 * x, 1.00, 1.50);
  }

  function effectiveCampaignWeight() {
    if (!ui.campaignEnabled || !campaignMission) return 0.0;
    const eta = currentCampaignETA();
    return clamp_(campaignBaseWeight * urgencyMultiplier(eta), 0.05, 0.95);
  }

  function assignmentKey_(missionName, workerType) {
    return missionName + "|" + workerType;
  }

  function addAssignment(missionName, workerType, deltaCount) {
    const key = assignmentKey_(missionName, workerType);
    const oldVal = assignmentMap[key] || 0;
    const newVal = oldVal + deltaCount;
    if (newVal > 0) assignmentMap[key] = newVal;
    else delete assignmentMap[key];
  }

  function getAssignmentsArray_() {
    const out = [];
    Object.keys(assignmentMap).forEach(key => {
      const count = assignmentMap[key];
      if (count <= 0) return;
      const parts = key.split("|");
      out.push({ name: parts[0], type: parts[1], count });
    });
    return out;
  }

  function addWorkerToMission(mission, type) {
    const power = workerPowers[type];
    mission.assignedUnits++;
    mission.currentPower += power;
    if (!mission.isCampaign) {
      mission.currentRunsPerHour = missionRunsPerHour(mission.baseMins, mission.currentPower);
    }
    missionWorkerCounts[mission.name][type] = (missionWorkerCounts[mission.name][type] || 0) + 1;
  }

  function removeWorkerFromMission(mission, type) {
    const power = workerPowers[type];
    mission.assignedUnits--;
    mission.currentPower -= power;
    if (mission.currentPower < 0) mission.currentPower = 0;
    if (!mission.isCampaign) {
      mission.currentRunsPerHour = mission.currentPower > 0
        ? missionRunsPerHour(mission.baseMins, mission.currentPower)
        : 0;
    }
    missionWorkerCounts[mission.name][type] = (missionWorkerCounts[mission.name][type] || 0) - 1;
    if (missionWorkerCounts[mission.name][type] <= 0) delete missionWorkerCounts[mission.name][type];
  }

  function getFragmentYieldPerCompletion_(mission) {
    return fragmentsPerCompletion + (mission.baseFragments || 0);
  }

  function addFarmContributionToTotals(mission, deltaRuns) {
    totals.Completions += deltaRuns * ts07Mult;
    totals.Academy += deltaRuns * ts07Mult * mission.baseAcademy;
    totals.Fragments += deltaRuns * getFragmentYieldPerCompletion_(mission);
    MATS.forEach(mat => {
      totals[mat] += deltaRuns * ts07Mult * mission.baseRewards[mat];
    });
  }

  function removeFarmContributionFromTotals(mission, deltaRunsLoss) {
    totals.Completions -= deltaRunsLoss * ts07Mult;
    totals.Academy -= deltaRunsLoss * ts07Mult * mission.baseAcademy;
    totals.Fragments -= deltaRunsLoss * getFragmentYieldPerCompletion_(mission);
    MATS.forEach(mat => {
      totals[mat] -= deltaRunsLoss * ts07Mult * mission.baseRewards[mat];
      if (totals[mat] < 0 && Math.abs(totals[mat]) < 1e-7) totals[mat] = 0;
    });
    if (totals.Completions < 0 && Math.abs(totals.Completions) < 1e-7) totals.Completions = 0;
    if (totals.Academy < 0 && Math.abs(totals.Academy) < 1e-7) totals.Academy = 0;
    if (totals.Fragments < 0 && Math.abs(totals.Fragments) < 1e-7) totals.Fragments = 0;
  }

  function currentUtility() {
    let u = 0;
    MATS.forEach(mat => {
      const w = weights[mat] || 1.0;
      u += w * Math.log(totals[mat] + 1);
    });
    return u;
  }

  function getResourceUtilityAdd_(mission, deltaRuns) {
    let deltaU = 0;
    let useful = false;
    MATS.forEach(mat => {
      const gain = deltaRuns * ts07Mult * mission.baseRewards[mat];
      if (gain <= 0) return;
      useful = true;
      const wt = weights[mat] || 1.0;
      deltaU += wt * (Math.log(totals[mat] + gain + 1) - Math.log(totals[mat] + 1));
    });
    return useful ? deltaU : 0;
  }

  function getResourceUtilityLoss_(mission, deltaRunsLoss) {
    let deltaLoss = 0;
    MATS.forEach(mat => {
      const loss = deltaRunsLoss * ts07Mult * mission.baseRewards[mat];
      if (loss <= 0) return;
      const wt = weights[mat] || 1.0;
      const oldVal = totals[mat];
      const newVal = Math.max(0, oldVal - loss);
      deltaLoss += wt * (Math.log(oldVal + 1) - Math.log(newVal + 1));
    });
    return deltaLoss;
  }

  function getFarmAddMetrics(mission, type) {
    if (!mission || mission.isCampaign) return null;
    if (mission.assignedUnits >= mission.cap) return null;
    const power = workerPowers[type];
    if (!power || power <= 0) return null;

    const oldRuns = mission.currentRunsPerHour;
    const newRuns = missionRunsPerHour(mission.baseMins, mission.currentPower + power);
    const deltaRuns = newRuns - oldRuns;
    if (deltaRuns <= EPS) return null;

    const resourceRaw = getResourceUtilityAdd_(mission, deltaRuns);
    const fragmentRaw = deltaRuns * getFragmentYieldPerCompletion_(mission);
    let baseRaw = 0;

    if (isResourcesMode) {
      if (resourceRaw <= EPS) return null;
      baseRaw = resourceRaw;
    } else if (isAcademyMode) {
      baseRaw = deltaRuns * ts07Mult * mission.baseAcademy;
    } else if (isFragmentsMode || isFragResMode) {
      baseRaw = fragmentRaw;
    } else if (isMaxCompMode) {
      baseRaw = deltaRuns * ts07Mult;
    } else {
      baseRaw = deltaRuns * ts07Mult;
    }

    if (baseRaw <= EPS) return null;
    return { deltaRuns, baseRaw, fragmentRaw, resourceRaw };
  }

  function getFarmRemoveMetrics(mission, type) {
    if (!mission || mission.isCampaign) return null;
    const cnt = missionWorkerCounts[mission.name][type] || 0;
    if (cnt <= 0) return null;
    const power = workerPowers[type];
    if (!power || power <= 0) return null;

    const oldRuns = mission.currentRunsPerHour;
    const newPower = mission.currentPower - power;
    const newRuns = newPower > 0 ? missionRunsPerHour(mission.baseMins, newPower) : 0;
    const deltaRunsLoss = oldRuns - newRuns;
    if (deltaRunsLoss <= EPS) return null;

    const resourceLossRaw = getResourceUtilityLoss_(mission, deltaRunsLoss);
    const fragmentLossRaw = deltaRunsLoss * getFragmentYieldPerCompletion_(mission);
    let baseLossRaw = 0;

    if (isResourcesMode) {
      baseLossRaw = resourceLossRaw;
    } else if (isAcademyMode) {
      baseLossRaw = deltaRunsLoss * ts07Mult * mission.baseAcademy;
    } else if (isFragmentsMode || isFragResMode) {
      baseLossRaw = fragmentLossRaw;
    } else if (isMaxCompMode) {
      baseLossRaw = deltaRunsLoss * ts07Mult;
    } else {
      baseLossRaw = deltaRunsLoss * ts07Mult;
    }

    if (baseLossRaw <= EPS) return null;
    return { deltaRunsLoss, baseLossRaw, fragmentLossRaw, resourceLossRaw };
  }

  function getCampaignAddRaw(type) {
    if (!ui.campaignEnabled || !campaignMission) return 0;
    if (campaignMission.assignedUnits >= campaignMission.cap) return 0;
    const power = workerPowers[type];
    if (!power || power <= 0) return 0;

    const oldETA = campaignETAHours(campaignMission, campaignMission.currentPower);
    const newETA = campaignETAHours(campaignMission, campaignMission.currentPower + power);

    if (!isFinite(newETA) || newETA <= 0) return 0;
    if (!isFinite(oldETA)) return 1 / newETA;
    return Math.max(0, (oldETA - newETA) / Math.max(oldETA, EPS));
  }

  function seedCampaignWithOneWorker_() {
    if (!ui.campaignEnabled || !campaignMission) return;
    if (campaignMission.currentPower > 0) return;
    if (campaignMission.assignedUnits >= campaignMission.cap) return;

    let bestType = null;
    let bestRaw = 0;
    TYPE_ORDER.forEach(type => {
      const worker = workers[type];
      if (!worker || worker.count <= 0 || worker.power <= 0) return;
      const raw = getCampaignAddRaw(type);
      if (raw > bestRaw) {
        bestRaw = raw;
        bestType = type;
      }
    });

    if (!bestType) return;
    addAssignment(campaignMission.name, bestType, 1);
    addWorkerToMission(campaignMission, bestType);
    workers[bestType].count--;
  }

  function getCampaignRemoveLossRaw(type) {
    if (!ui.campaignEnabled || !campaignMission) return 0;
    const cnt = missionWorkerCounts[campaignMission.name][type] || 0;
    if (cnt <= 0) return 0;
    const power = workerPowers[type];
    if (!power || power <= 0) return 0;
    const oldETA = campaignETAHours(campaignMission, campaignMission.currentPower);
    if (!isFinite(oldETA) || oldETA <= 0) return 0;

    const remainingPower = campaignMission.currentPower - power;
    if (remainingPower <= 0) return 1 / oldETA;
    const newETA = campaignETAHours(campaignMission, remainingPower);
    if (!isFinite(newETA)) return 1 / oldETA;
    return Math.max(0, (newETA - oldETA) / Math.max(oldETA, EPS));
  }

  function getSolutionSummary_() {
    return {
      resourceUtility: currentUtility(),
      fragments: totals.Fragments,
      academy: totals.Academy,
      completions: totals.Completions
    };
  }

  function isSummaryBetter_(cand, incumbent) {
    if (!incumbent) return true;
    if (isResourcesMode) {
      if (cand.resourceUtility > incumbent.resourceUtility + EPS) return true;
      if (cand.resourceUtility < incumbent.resourceUtility - EPS) return false;
      return cand.fragments > incumbent.fragments + EPS;
    }
    if (isAcademyMode) {
      if (cand.academy > incumbent.academy + EPS) return true;
      if (cand.academy < incumbent.academy - EPS) return false;
      return cand.completions > incumbent.completions + EPS;
    }
    if (isMaxCompMode) {
      if (cand.completions > incumbent.completions + EPS) return true;
      if (cand.completions < incumbent.completions - EPS) return false;
      return cand.fragments > incumbent.fragments + EPS;
    }
    if (isFragmentsMode) {
      if (cand.fragments > incumbent.fragments + EPS) return true;
      if (cand.fragments < incumbent.fragments - EPS) return false;
      return cand.resourceUtility > incumbent.resourceUtility + EPS;
    }
    if (isFragResMode) {
      const FRAG_WEIGHT = 0.75;
      const RES_WEIGHT  = 0.25;
      const candScore = FRAG_WEIGHT * (cand.fragments / Math.max(incumbent.fragments, EPS))
                      + RES_WEIGHT  * (cand.resourceUtility / Math.max(incumbent.resourceUtility, EPS));
      if (Math.abs(candScore - 1.0) > EPS) return candScore > 1.0;
      return cand.completions > incumbent.completions + EPS;
    }
    return cand.completions > incumbent.completions + EPS;
  }

  function snapshotState_() {
    return {
      assignmentMap: Object.assign({}, assignmentMap),
      totals: Object.assign({}, totals),
      workerCounts: TYPE_ORDER.reduce((acc, type) => {
        acc[type] = workers[type] ? workers[type].count : 0;
        return acc;
      }, {}),
      missionFields: missions.map(m => ({
        assignedUnits: m.assignedUnits,
        currentPower: m.currentPower,
        currentRunsPerHour: m.currentRunsPerHour
      })),
      missionWorkerCounts: JSON.parse(JSON.stringify(missionWorkerCounts))
    };
  }

  function restoreState_(snap) {
    assignmentMap = Object.assign({}, snap.assignmentMap);
    totals = Object.assign({}, snap.totals);
    missionWorkerCounts = JSON.parse(JSON.stringify(snap.missionWorkerCounts));
    TYPE_ORDER.forEach(type => {
      if (workers[type]) workers[type].count = snap.workerCounts[type] || 0;
    });
    missions.forEach((m, idx) => {
      const s = snap.missionFields[idx];
      m.assignedUnits = s.assignedUnits;
      m.currentPower = s.currentPower;
      m.currentRunsPerHour = s.currentRunsPerHour;
    });
  }

  function roughFragmentScore_(mission, type) {
    const power = workerPowers[type];
    if (!power || mission.isCampaign || mission.assignedUnits >= mission.cap) return -1;
    const oldRuns = mission.currentRunsPerHour;
    const newRuns = missionRunsPerHour(mission.baseMins, mission.currentPower + power);
    const deltaRuns = newRuns - oldRuns;
    if (deltaRuns <= EPS) return -1;
    return deltaRuns * getFragmentYieldPerCompletion_(mission);
  }

  function roughResourceScore_(mission, type) {
    const power = workerPowers[type];
    if (!power || mission.isCampaign || mission.assignedUnits >= mission.cap) return -1;
    const oldRuns = mission.currentRunsPerHour;
    const newRuns = missionRunsPerHour(mission.baseMins, mission.currentPower + power);
    const deltaRuns = newRuns - oldRuns;
    if (deltaRuns <= EPS) return -1;
    let score = 0;
    MATS.forEach(mat => {
      score += deltaRuns * ts07Mult * mission.baseRewards[mat] * (weights[mat] || 1.0);
    });
    return score;
  }

  function getCandidateMissionsForType_(type) {
    const currentAssigned = [];
    const fragmentRanked = [];
    const resourceRanked = [];
    missions.forEach(mission => {
      if (mission.isCampaign) return;
      if ((missionWorkerCounts[mission.name][type] || 0) > 0 && mission.assignedUnits < mission.cap) {
        currentAssigned.push(mission);
      }
      fragmentRanked.push({ mission, s: roughFragmentScore_(mission, type) });
      resourceRanked.push({ mission, s: roughResourceScore_(mission, type) });
    });
    fragmentRanked.sort((a, b) => b.s - a.s);
    resourceRanked.sort((a, b) => b.s - a.s);

    const selected = {};
    const out = [];
    function addMission_(m) {
      if (!m || selected[m.name]) return;
      selected[m.name] = true;
      out.push(m);
    }
    currentAssigned.forEach(addMission_);
    fragmentRanked.slice(0, FRAGMENT_SHORTLIST_SIZE).forEach(x => addMission_(x.mission));
    resourceRanked.slice(0, RESOURCE_SHORTLIST_SIZE).forEach(x => addMission_(x.mission));
    return out;
  }

  function chooseFromRanked_(ranked, randomize, phase) {
    if (!ranked || ranked.length === 0) return null;
    if (!randomize || ranked.length === 1) return ranked[0];
    let topK = MULTISTART_TOP_K;
    if (phase > 0.70) topK = 1;
    else if (phase > 0.40) topK = Math.min(2, ranked.length);
    const pool = ranked.slice(0, Math.min(topK, ranked.length));
    let totalWeight = 0;
    const localWeights = [];
    for (let i = 0; i < pool.length; i++) {
      const w = topK - i;
      localWeights.push(w);
      totalWeight += w;
    }
    let r = Math.random() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
      r -= localWeights[i];
      if (r <= 0) return pool[i];
    }
    return pool[0];
  }

  function executeGreedyAllocation_(randomize) {
    const totalWorkersAtStart = TYPE_ORDER.reduce((s, t) => s + ((workers[t] && workers[t].count) || 0), 0);
    while (true) {
      let candidates = [];
      let maxBaseRaw = 0;
      let maxCampRaw = 0;

      const effW = effectiveCampaignWeight();
      const eta = currentCampaignETA();
      const campaignUrgent = ui.campaignEnabled && campaignMission && (!isFinite(eta) || effW >= 0.50);

      for (let ti = 0; ti < TYPE_ORDER.length; ti++) {
        const type = TYPE_ORDER[ti];
        const worker = workers[type];
        if (!worker || worker.count <= 0 || worker.power <= 0) continue;
        const candidateMissions = getCandidateMissionsForType_(type);
        for (let mi = 0; mi < candidateMissions.length; mi++) {
          const mission = candidateMissions[mi];
          const farm = getFarmAddMetrics(mission, type);
          if (!farm) continue;
          maxBaseRaw = Math.max(maxBaseRaw, farm.baseRaw);
          candidates.push({
            kind: "farm",
            mission, type,
            power: worker.power,
            deltaRuns: farm.deltaRuns,
            baseRaw: farm.baseRaw,
            fragmentRaw: farm.fragmentRaw || 0,
            resourceRaw: farm.resourceRaw || 0,
            campRaw: 0
          });
        }
      }

      if (ui.campaignEnabled && campaignMission) {
        for (let ti = 0; ti < TYPE_ORDER.length; ti++) {
          const type = TYPE_ORDER[ti];
          const worker = workers[type];
          if (!worker || worker.count <= 0 || worker.power <= 0) continue;
          const campRaw = getCampaignAddRaw(type);
          if (campRaw <= EPS) continue;
          maxCampRaw = Math.max(maxCampRaw, campRaw);
          candidates.push({
            kind: "campaign",
            mission: campaignMission,
            type,
            power: worker.power,
            deltaRuns: 0,
            baseRaw: 0,
            fragmentRaw: 0,
            resourceRaw: 0,
            campRaw
          });
        }
      }

      if (candidates.length === 0) break;

      const invMaxBase = maxBaseRaw > EPS ? 1 / maxBaseRaw : 0;
      const invMaxCamp = maxCampRaw > EPS ? 1 / maxCampRaw : 0;

      candidates.forEach(c => {
        c.baseNorm = c.baseRaw * invMaxBase;
        c.campNorm = c.campRaw * invMaxCamp;
        c.finalScore = (1 - effW) * c.baseNorm + effW * c.campNorm;
      });

      candidates.sort((a, b) => b.finalScore - a.finalScore);
      const best = candidates[0];
      if (!best || best.finalScore <= EPS) break;

      const threshold = best.finalScore * (1 - NEAR_BEST_POOL_PCT);
      const pool = candidates.filter(c => c.finalScore + EPS >= threshold);

      pool.sort((a, b) => {
        const df = b.finalScore - a.finalScore;
        if (Math.abs(df) > 1e-12) return df;
        if (campaignUrgent) {
          const dc = b.campNorm - a.campNorm;
          if (Math.abs(dc) > 1e-12) return dc;
        } else {
          const db = b.baseNorm - a.baseNorm;
          if (Math.abs(db) > 1e-12) return db;
        }

        if (!isFragmentsMode && !isFragResMode) {
          const de = (b.finalScore / Math.max(b.power, EPS)) - (a.finalScore / Math.max(a.power, EPS));
          if (Math.abs(de) > 1e-12) return de;
        }
        const dfrag = (b.fragmentRaw || 0) - (a.fragmentRaw || 0);
        if (Math.abs(dfrag) > 1e-12) return dfrag;

        if (isFragmentsMode || isFragResMode) {
          const de2 = (b.finalScore / Math.max(b.power, EPS)) - (a.finalScore / Math.max(a.power, EPS));
          if (Math.abs(de2) > 1e-12) return de2;
        }
        return a.power - b.power;
      });

      const remainingWorkers = TYPE_ORDER.reduce((s, t) => s + ((workers[t] && workers[t].count) || 0), 0);
      const phase = totalWorkersAtStart > 0 ? 1 - (remainingWorkers / totalWorkersAtStart) : 1;
      const pick = chooseFromRanked_(pool, randomize, phase);
      if (!pick || pick.finalScore <= EPS) break;

      const mission = pick.mission;
      const type = pick.type;
      const worker = workers[type];
      if (!worker || worker.count <= 0) break;

      addAssignment(mission.name, type, 1);
      addWorkerToMission(mission, type);
      worker.count--;

      if (pick.kind === "farm") {
        addFarmContributionToTotals(mission, pick.deltaRuns);
      }
    }
  }

  function floorRebalance_() {
    if (!globalSpeedMult || globalSpeedMult <= 0) return;
 
    const beforeSnap = snapshotState_();
    const beforeSummary = getSolutionSummary_();
 
    missions.forEach(mission => {
      if (mission.isCampaign) return;
      TYPE_ORDER.forEach(type => {
        let cnt = missionWorkerCounts[mission.name][type] || 0;
        while (cnt > 0) {
          removeWorkerFromMission(mission, type);
          addAssignment(mission.name, type, -1);
          workers[type].count++;
          cnt--;
        }
      });
    });
 

    totals.Completions = 0;
    totals.Academy = 0;
    totals.Fragments = 0;
    MATS.forEach(m => totals[m] = 0);
 

    const farmBySpeed = missions
      .filter(m => !m.isCampaign)
      .sort((a, b) => a.baseMins - b.baseMins);
 
    let maxUnitPower = 0;
    TYPE_ORDER.forEach(t => {
      if ((workerPowers[t] || 0) > maxUnitPower) maxUnitPower = workerPowers[t];
    });
 
    farmBySpeed.forEach(mission => {
      const minPower = mission.baseMins / (globalSpeedMult * MIN_DURATION_MINS);
      if (!isFinite(minPower) || minPower <= 0) return;
      if (minPower > mission.cap * maxUnitPower + EPS) return;
 
      const tempAlloc = {};
      TYPE_ORDER.forEach(t => tempAlloc[t] = 0);
      let curPower = 0;
      let units = 0;
 
      for (let ti = 0; ti < TYPE_ORDER.length; ti++) {
        const type = TYPE_ORDER[ti];
        const pw = workerPowers[type] || 0;
        if (pw <= 0) continue;
        const avail = workers[type] ? workers[type].count : 0;
        while (curPower < minPower - EPS && units < mission.cap && tempAlloc[type] < avail) {
          tempAlloc[type]++;
          curPower += pw;
          units++;
        }
        if (curPower >= minPower - EPS) break;
      }
 
      while (curPower < minPower - EPS) {
        let upgraded = false;
        for (let ci = 0; ci < TYPE_ORDER.length; ci++) {
          const cheapType = TYPE_ORDER[ci];
          if (tempAlloc[cheapType] <= 0) continue;
          const cheapPow = workerPowers[cheapType] || 0;
          for (let ei = ci + 1; ei < TYPE_ORDER.length; ei++) {
            const expType = TYPE_ORDER[ei];
            const expPow = workerPowers[expType] || 0;
            if (expPow <= cheapPow) continue;
            const freeOfExp = (workers[expType] ? workers[expType].count : 0) - tempAlloc[expType];
            if (freeOfExp <= 0) continue;
            tempAlloc[cheapType]--;
            tempAlloc[expType]++;
            curPower += expPow - cheapPow;
            upgraded = true;
            break;
          }
          if (upgraded) break;
        }
        if (!upgraded) break;
      }
 
      if (curPower >= minPower - EPS) {
        TYPE_ORDER.forEach(type => {
          for (let i = 0; i < tempAlloc[type]; i++) {
            addWorkerToMission(mission, type);
            addAssignment(mission.name, type, 1);
            workers[type].count--;
          }
        });
        addFarmContributionToTotals(mission, mission.currentRunsPerHour);
      }
    });
 

    executeGreedyAllocation_(false);
 
    const afterSummary = getSolutionSummary_();
    if (!isSummaryBetter_(afterSummary, beforeSummary)) {
      restoreState_(beforeSnap);
    }
  }

  function polishFarmSolution_() {
    let movesMade = 0;

    for (let pass = 0; pass < LOCAL_POLISH_MAX_PASSES; pass++) {
      let improved = false;

      singleMoveLoop:
      for (let mi = 0; mi < missions.length; mi++) {
        const fromMission = missions[mi];
        if (fromMission.isCampaign) continue;

        for (let ti = 0; ti < TYPE_ORDER.length; ti++) {
          const type = TYPE_ORDER[ti];
          const cnt = missionWorkerCounts[fromMission.name][type] || 0;
          if (cnt <= 0) continue;

          const baseSnap = snapshotState_();
          const baseSummary = getSolutionSummary_();
          const rem = getFarmRemoveMetrics(fromMission, type);
          if (!rem) continue;

          removeWorkerFromMission(fromMission, type);
          addAssignment(fromMission.name, type, -1);
          workers[type].count++;
          removeFarmContributionFromTotals(fromMission, rem.deltaRunsLoss);

          let bestSnap = null;
          let bestSummary = baseSummary;

          for (let mj = 0; mj < missions.length; mj++) {
            const toMission = missions[mj];
            if (toMission.isCampaign || toMission.name === fromMission.name) continue;

            const add = getFarmAddMetrics(toMission, type);
            if (!add) continue;

            addWorkerToMission(toMission, type);
            addAssignment(toMission.name, type, 1);
            workers[type].count--;
            addFarmContributionToTotals(toMission, add.deltaRuns);

            const candSummary = getSolutionSummary_();
            if (isSummaryBetter_(candSummary, bestSummary)) {
              bestSummary = candSummary;
              bestSnap = snapshotState_();
            }

            const undo = getFarmRemoveMetrics(toMission, type);
            removeWorkerFromMission(toMission, type);
            addAssignment(toMission.name, type, -1);
            workers[type].count++;
            removeFarmContributionFromTotals(toMission, undo.deltaRunsLoss);
          }

          restoreState_(baseSnap);

          if (bestSnap) {
            restoreState_(bestSnap);
            improved = true;
            movesMade++;
            if (movesMade >= LOCAL_POLISH_MAX_MOVES) return;
            break singleMoveLoop;
          }
        }
      }

      twoOptLoop:
      for (let ai = 0; ai < missions.length; ai++) {
        const missionA = missions[ai];
        if (missionA.isCampaign) continue;

        for (let bi = ai + 1; bi < missions.length; bi++) {
          const missionB = missions[bi];
          if (missionB.isCampaign) continue;

          for (let ti = 0; ti < TYPE_ORDER.length; ti++) {
            const typeT = TYPE_ORDER[ti];
            const cntT = missionWorkerCounts[missionA.name][typeT] || 0;
            if (cntT <= 0) continue;

            for (let ui2 = 0; ui2 < TYPE_ORDER.length; ui2++) {
              const typeU = TYPE_ORDER[ui2];
              const cntU = missionWorkerCounts[missionB.name][typeU] || 0;
              if (cntU <= 0) continue;

              if (typeT === typeU) continue;

              if (missionB.assignedUnits >= missionB.cap &&
                  missionWorkerCounts[missionB.name][typeT] === 0) continue;
              if (missionA.assignedUnits >= missionA.cap &&
                  missionWorkerCounts[missionA.name][typeU] === 0) continue;

              const baseSnap = snapshotState_();
              const baseSummary = getSolutionSummary_();

              const remT = getFarmRemoveMetrics(missionA, typeT);
              if (!remT) continue;
              removeWorkerFromMission(missionA, typeT);
              addAssignment(missionA.name, typeT, -1);
              workers[typeT].count++;
              removeFarmContributionFromTotals(missionA, remT.deltaRunsLoss);

              const remU = getFarmRemoveMetrics(missionB, typeU);
              if (!remU) {
                restoreState_(baseSnap);
                continue;
              }
              removeWorkerFromMission(missionB, typeU);
              addAssignment(missionB.name, typeU, -1);
              workers[typeU].count++;
              removeFarmContributionFromTotals(missionB, remU.deltaRunsLoss);

              const addT = getFarmAddMetrics(missionB, typeT);
              if (!addT) {
                restoreState_(baseSnap);
                continue;
              }
              addWorkerToMission(missionB, typeT);
              addAssignment(missionB.name, typeT, 1);
              workers[typeT].count--;
              addFarmContributionToTotals(missionB, addT.deltaRuns);

              const addU = getFarmAddMetrics(missionA, typeU);
              if (!addU) {
                restoreState_(baseSnap);
                continue;
              }
              addWorkerToMission(missionA, typeU);
              addAssignment(missionA.name, typeU, 1);
              workers[typeU].count--;
              addFarmContributionToTotals(missionA, addU.deltaRuns);

              const candSummary = getSolutionSummary_();

              if (isSummaryBetter_(candSummary, baseSummary)) {
                improved = true;
                movesMade++;
                if (movesMade >= LOCAL_POLISH_MAX_MOVES) return;
                break twoOptLoop;
              } else {
                restoreState_(baseSnap);
              }
            }
          }
        }
      }

      if (!improved) break;
    }
  }

  function polishByWorkerType_() {
    TYPE_ORDER.forEach(type => {
      const baseSnap = snapshotState_();
      const baseSummary = getSolutionSummary_();
      const baseUnassigned = baseSnap.workerCounts[type] || 0;

      let removable = [];
      missions.forEach(mission => {
        if (mission.isCampaign) return;
        const cnt = missionWorkerCounts[mission.name][type] || 0;
        if (cnt <= 0) return;
        const rem = getFarmRemoveMetrics(mission, type);
        const score = rem ? rem.baseLossRaw : 999999;
        removable.push({ mission, cnt, score });
      });

      removable.sort((a, b) => a.score - b.score);
      let freed = 0;
      removable.forEach(x => {
        while (x.cnt > 0 && freed < TYPE_REBUILD_MAX_UNITS) {
          const rem = getFarmRemoveMetrics(x.mission, type);
          if (!rem) break;
          removeWorkerFromMission(x.mission, type);
          addAssignment(x.mission.name, type, -1);
          workers[type].count++;
          removeFarmContributionFromTotals(x.mission, rem.deltaRunsLoss);
          x.cnt--;
          freed++;
        }
      });

      if (freed <= 0) {
        restoreState_(baseSnap);
        return;
      }

      while ((workers[type] && workers[type].count > baseUnassigned)) {
        const candidateMissions = getCandidateMissionsForType_(type);
        let best = null;
        candidateMissions.forEach(mission => {
          const add = getFarmAddMetrics(mission, type);
          if (!add) return;
          if (!best || add.baseRaw > best.add.baseRaw) best = { mission, add };
        });
        if (!best) break;
        addWorkerToMission(best.mission, type);
        addAssignment(best.mission.name, type, 1);
        workers[type].count--;
        addFarmContributionToTotals(best.mission, best.add.deltaRuns);
      }

      const candSummary = getSolutionSummary_();
      if (!isSummaryBetter_(candSummary, baseSummary)) restoreState_(baseSnap);
    });
  }

  function localImproveCampaignVsFarm_() {
    for (let iter = 0; iter < LOCAL_IMPROVE_MAX_ITERS; iter++) {
      const effW = effectiveCampaignWeight();
      let maxBaseRaw = 0;
      let maxCampRaw = 0;
      let bestSecondary = -Infinity;

      for (let ti = 0; ti < TYPE_ORDER.length; ti++) {
        const type = TYPE_ORDER[ti];
        const campAdd = getCampaignAddRaw(type);
        if (campAdd > maxCampRaw) maxCampRaw = campAdd;
        const campLoss = getCampaignRemoveLossRaw(type);
        if (campLoss > maxCampRaw) maxCampRaw = campLoss;

        for (let mi = 0; mi < missions.length; mi++) {
          const mission = missions[mi];
          if (mission.isCampaign) continue;
          const add = getFarmAddMetrics(mission, type);
          if (add && add.baseRaw > maxBaseRaw) maxBaseRaw = add.baseRaw;
          const rem = getFarmRemoveMetrics(mission, type);
          if (rem && rem.baseLossRaw > maxBaseRaw) maxBaseRaw = rem.baseLossRaw;
        }
      }

      const baseScale = maxBaseRaw > EPS ? maxBaseRaw : 1;
      const campScale = maxCampRaw > EPS ? maxCampRaw : 1;
      let bestMove = null;
      let bestDelta = 0;

      for (let ti = 0; ti < TYPE_ORDER.length; ti++) {
        const type = TYPE_ORDER[ti];
        const cntOnCampaign = missionWorkerCounts[campaignMission.name][type] || 0;
        if (cntOnCampaign <= 0) continue;
        const campLoss = getCampaignRemoveLossRaw(type);
        if (campLoss <= EPS) continue;

        for (let mi = 0; mi < missions.length; mi++) {
          const mission = missions[mi];
          if (mission.isCampaign) continue;
          const farmAdd = getFarmAddMetrics(mission, type);
          if (!farmAdd) continue;
          const deltaNorm = (1 - effW) * (farmAdd.baseRaw / baseScale) - effW * (campLoss / campScale);
          const secondary = isFragResMode ? (farmAdd.resourceRaw || 0) : 0;
          if (deltaNorm > bestDelta + EPS || (isFragResMode && Math.abs(deltaNorm - bestDelta) <= EPS && secondary > bestSecondary + EPS)) {
            bestDelta = deltaNorm;
            bestSecondary = secondary;
            bestMove = { dir: "campaign_to_farm", type, mission, deltaRuns: farmAdd.deltaRuns };
          }
        }
      }

      for (let mi = 0; mi < missions.length; mi++) {
        const mission = missions[mi];
        if (mission.isCampaign) continue;
        for (let ti = 0; ti < TYPE_ORDER.length; ti++) {
          const type = TYPE_ORDER[ti];
          const cntOnMission = missionWorkerCounts[mission.name][type] || 0;
          if (cntOnMission <= 0) continue;
          const farmLoss = getFarmRemoveMetrics(mission, type);
          if (!farmLoss) continue;
          const campGain = getCampaignAddRaw(type);
          if (campGain <= EPS) continue;
          const deltaNorm = effW * (campGain / campScale) - (1 - effW) * (farmLoss.baseLossRaw / baseScale);
          const secondary = isFragResMode ? -(farmLoss.resourceLossRaw || 0) : 0;
          if (deltaNorm > bestDelta + EPS || (isFragResMode && Math.abs(deltaNorm - bestDelta) <= EPS && secondary > bestSecondary + EPS)) {
            bestDelta = deltaNorm;
            bestSecondary = secondary;
            bestMove = { dir: "farm_to_campaign", type, mission, deltaRunsLoss: farmLoss.deltaRunsLoss };
          }
        }
      }

      if (!bestMove || bestDelta <= EPS) break;
      if (bestMove.dir === "campaign_to_farm") {
        removeWorkerFromMission(campaignMission, bestMove.type);
        addAssignment(campaignMission.name, bestMove.type, -1);
        workers[bestMove.type].count++;
        addWorkerToMission(bestMove.mission, bestMove.type);
        addAssignment(bestMove.mission.name, bestMove.type, 1);
        workers[bestMove.type].count--;
        addFarmContributionToTotals(bestMove.mission, bestMove.deltaRuns);
      } else if (bestMove.dir === "farm_to_campaign") {
        removeWorkerFromMission(bestMove.mission, bestMove.type);
        addAssignment(bestMove.mission.name, bestMove.type, -1);
        removeFarmContributionFromTotals(bestMove.mission, bestMove.deltaRunsLoss);
        workers[bestMove.type].count++;
        addWorkerToMission(campaignMission, bestMove.type);
        addAssignment(campaignMission.name, bestMove.type, 1);
        workers[bestMove.type].count--;
      }
    }
  }
  function simulatedAnnealingPolish_() {
    const farmMissions = missions.filter(m => !m.isCampaign);
    if (farmMissions.length < 2) return;

    function scalarScore() {
      const s = getSolutionSummary_();
      if (isResourcesMode) return s.resourceUtility + 0.001 * s.fragments;
      if (isAcademyMode)   return s.academy + 0.001 * s.completions;
      if (isMaxCompMode)   return s.completions + 0.001 * s.fragments;
      if (isFragmentsMode) return s.fragments * 1000 + 0.001 * s.resourceUtility;
      if (isFragResMode)   return 0.75 * s.fragments * 1000 + 0.25 * s.resourceUtility;
      return s.completions;
    }

    function randChoice(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    }

    function randTypeOnMission(mission) {
      const types = TYPE_ORDER.filter(
        t => (missionWorkerCounts[mission.name][t] || 0) > 0
      );
      return types.length > 0 ? randChoice(types) : null;
    }

    function tryNeighborRelocate() {
      const occupied = farmMissions.filter(m => m.assignedUnits > 0);
      if (occupied.length === 0) return false;
      const from = randChoice(occupied);
      const type = randTypeOnMission(from);
      if (!type) return false;
      const candidates = farmMissions.filter(
        m => m.name !== from.name && m.assignedUnits < m.cap
      );
      if (candidates.length === 0) return false;
      const to = randChoice(candidates);
      const rem = getFarmRemoveMetrics(from, type);
      if (!rem) return false;
      removeWorkerFromMission(from, type);
      addAssignment(from.name, type, -1);
      workers[type].count++;
      removeFarmContributionFromTotals(from, rem.deltaRunsLoss);
      const add = getFarmAddMetrics(to, type);
      if (!add) {
        addWorkerToMission(from, type);
        addAssignment(from.name, type, 1);
        workers[type].count--;
        addFarmContributionToTotals(from, rem.deltaRunsLoss);
        return false;
      }
      addWorkerToMission(to, type);
      addAssignment(to.name, type, 1);
      workers[type].count--;
      addFarmContributionToTotals(to, add.deltaRuns);
      return true;
    }

    function tryNeighborSwap() {
      const occupied = farmMissions.filter(m => m.assignedUnits > 0);
      if (occupied.length < 2) return false;
      const mA = randChoice(occupied);
      const typeT = randTypeOnMission(mA);
      if (!typeT) return false;
      const candidates = occupied.filter(m => {
        if (m.name === mA.name) return false;
        return TYPE_ORDER.some(
          t => t !== typeT && (missionWorkerCounts[m.name][t] || 0) > 0
        );
      });
      if (candidates.length === 0) return false;
      const mB = randChoice(candidates);
      const swappableTypes = TYPE_ORDER.filter(
        t => t !== typeT && (missionWorkerCounts[mB.name][t] || 0) > 0
      );
      if (swappableTypes.length === 0) return false;
      const typeU = randChoice(swappableTypes);

      const remT = getFarmRemoveMetrics(mA, typeT);
      if (!remT) return false;
      removeWorkerFromMission(mA, typeT);
      addAssignment(mA.name, typeT, -1);
      workers[typeT].count++;
      removeFarmContributionFromTotals(mA, remT.deltaRunsLoss);

      const remU = getFarmRemoveMetrics(mB, typeU);
      if (!remU) {
        addWorkerToMission(mA, typeT);
        addAssignment(mA.name, typeT, 1);
        workers[typeT].count--;
        addFarmContributionToTotals(mA, remT.deltaRunsLoss);
        return false;
      }
      removeWorkerFromMission(mB, typeU);
      addAssignment(mB.name, typeU, -1);
      workers[typeU].count++;
      removeFarmContributionFromTotals(mB, remU.deltaRunsLoss);

      const addT = getFarmAddMetrics(mB, typeT);
      if (!addT) {
        addWorkerToMission(mB, typeU);
        addAssignment(mB.name, typeU, 1);
        workers[typeU].count--;
        addFarmContributionToTotals(mB, remU.deltaRunsLoss);
        addWorkerToMission(mA, typeT);
        addAssignment(mA.name, typeT, 1);
        workers[typeT].count--;
        addFarmContributionToTotals(mA, remT.deltaRunsLoss);
        return false;
      }
      addWorkerToMission(mB, typeT);
      addAssignment(mB.name, typeT, 1);
      workers[typeT].count--;
      addFarmContributionToTotals(mB, addT.deltaRuns);

      const addU = getFarmAddMetrics(mA, typeU);
      if (!addU) {
        const undoT = getFarmRemoveMetrics(mB, typeT);
        if (undoT) {
          removeWorkerFromMission(mB, typeT);
          addAssignment(mB.name, typeT, -1);
          workers[typeT].count++;
          removeFarmContributionFromTotals(mB, undoT.deltaRunsLoss);
        }
        addWorkerToMission(mB, typeU);
        addAssignment(mB.name, typeU, 1);
        workers[typeU].count--;
        addFarmContributionToTotals(mB, remU.deltaRunsLoss);
        addWorkerToMission(mA, typeT);
        addAssignment(mA.name, typeT, 1);
        workers[typeT].count--;
        addFarmContributionToTotals(mA, remT.deltaRunsLoss);
        return false;
      }
      addWorkerToMission(mA, typeU);
      addAssignment(mA.name, typeU, 1);
      workers[typeU].count--;
      addFarmContributionToTotals(mA, addU.deltaRuns);
      return true;
    }

    let temperature = SA_INITIAL_TEMP;
    let currentScore = scalarScore();
    let bestSnap = snapshotState_();
    let bestScore = currentScore;

    for (let iter = 0; iter < SA_MAX_ITERATIONS; iter++) {
      const beforeSnap = snapshotState_();
      const beforeScore = currentScore;
      let moved;
      if (Math.random() < SA_SWAP_PROBABILITY) {
        moved = tryNeighborSwap();
      } else {
        moved = tryNeighborRelocate();
      }
      if (!moved) continue;
      const neighborScore = scalarScore();
      const delta = neighborScore - beforeScore;
      if (delta > 0 || Math.random() < Math.exp(delta / temperature)) {
        currentScore = neighborScore;
        if (currentScore > bestScore) {
          bestSnap = snapshotState_();
          bestScore = currentScore;
        }
      } else {
        restoreState_(beforeSnap);
        currentScore = beforeScore;
      }
      temperature *= SA_COOLING_RATE;
      if (temperature < SA_MIN_TEMP) break;
    }

    restoreState_(bestSnap);
  }

  seedCampaignWithOneWorker_();
  const emptySnap = snapshotState_();
  const runResults = [];
  let bestSoFar = null;
  let staleRuns = 0;
  let runIdx = 0;

  while (runIdx < MULTISTART_MAX_RUNS) {
    restoreState_(emptySnap);
    const randomize = runIdx > 0;
    executeGreedyAllocation_(randomize);

    if (ui.campaignEnabled && campaignMission && !isFragResMode) {
      localImproveCampaignVsFarm_();
    }
    if (!ui.campaignEnabled) {
      polishFarmSolution_();
    }

    const result = {
      summary: getSolutionSummary_(),
      snap: snapshotState_(),
      randomized: randomize
    };
    runResults.push(result);

    if (!bestSoFar || isSummaryBetter_(result.summary, bestSoFar.summary)) {
      bestSoFar = result;
      staleRuns = 0;
    } else {
      staleRuns++;
    }
    runIdx++;
    if (runIdx >= MULTISTART_MIN_RUNS && staleRuns >= MULTISTART_STALE_LIMIT) break;
  }

  function chooseBestRun_(results) {
    if (!results || results.length === 0) return null;
    if (isFragResMode) {
      const FRAG_WEIGHT = 0.75;
      const RES_WEIGHT  = 0.25;
      let maxFrag = EPS;
      let maxRes  = EPS;
      results.forEach(r => {
        if (r.summary.fragments > maxFrag) maxFrag = r.summary.fragments;
        if (r.summary.resourceUtility > maxRes) maxRes = r.summary.resourceUtility;
      });
      results.sort((a, b) => {
        const scoreA = FRAG_WEIGHT * (a.summary.fragments / maxFrag)
                    + RES_WEIGHT  * (a.summary.resourceUtility / maxRes);
        const scoreB = FRAG_WEIGHT * (b.summary.fragments / maxFrag)
                    + RES_WEIGHT  * (b.summary.resourceUtility / maxRes);
        const ds = scoreB - scoreA;
        if (Math.abs(ds) > EPS) return ds;
        return b.summary.completions - a.summary.completions;
      });
      return results[0];
    }
    let best = results[0];
    for (let i = 1; i < results.length; i++) {
      if (isSummaryBetter_(results[i].summary, best.summary)) best = results[i];
    }
    return best;
  }

  const bestRun = chooseBestRun_(runResults);
  if (bestRun) restoreState_(bestRun.snap);

  const preFloorSnap = snapshotState_();
  const preFloorSummary = getSolutionSummary_();

  floorRebalance_();

  if (!ui.campaignEnabled) {
    polishByWorkerType_();
    polishFarmSolution_();
  }

  if (!isSummaryBetter_(getSolutionSummary_(), preFloorSummary)) {
    restoreState_(preFloorSnap);
  }
  simulatedAnnealingPolish_();
  const assignments = getAssignmentsArray_().sort((a, b) => {
    const nameComp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    if (nameComp !== 0) return nameComp;
    const rankA = TYPE_RANK[a.type] || 99;
    const rankB = TYPE_RANK[b.type] || 99;
    return rankA - rankB;
  });

  return {
    assignments,
    totals,
    campaignETA: ui.campaignEnabled && campaignMission ? currentCampaignETA() : Infinity,
    globalSpeedMult,
    modeUsed: ui.modeRaw,
    debug: {
      missionsConsidered: missions.filter(m => !m.isCampaign).length,
      campaignMission: campaignMission ? campaignMission.name : "—",
      multistartRuns: runResults.length,
      ouroUnlocked: ui.ouroUnlocked ? "Yes" : "No"
    }
  };
}

function formatNumber_(value, digits = 1) {
  if (!isFinite(value)) return "∞";
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function renderResult_(ui, result) {
  document.getElementById('campaignEtaText').textContent = isFinite(result.campaignETA) ? formatNumber_(result.campaignETA, 3) : "—";
  document.getElementById('modeUsedText').textContent = result.modeUsed;

  const totalsBody = document.getElementById('totalsBody');
  const totalsRows = [];
  MATS.forEach(mat => totalsRows.push(`<tr><td>${mat}</td><td>${formatNumber_(result.totals[mat] || 0, 1)}</td></tr>`));
  totalsRows.push(`<tr><td>Academy Pts</td><td>${formatNumber_(result.totals.Academy || 0, 1)}</td></tr>`);
  totalsRows.push(`<tr><td>Completions</td><td>${formatNumber_(result.totals.Completions || 0, 1)}</td></tr>`);
  totalsRows.push(`<tr><td>Fragments (est.)</td><td>${formatNumber_(result.totals.Fragments || 0, 3)}</td></tr>`);
  totalsBody.innerHTML = totalsRows.join('');

  const distributionBody = document.getElementById('distributionBody');
  if (result.assignments.length === 0) {
    distributionBody.innerHTML = '<tr><td colspan="5">No assignments were generated.</td></tr>';
  } else {
    const rowMap = new Map();
    result.assignments.forEach(a => {
      if (!rowMap.has(a.name)) {
        rowMap.set(a.name, {
          name: a.name,
          'Mining Pod': 0,
          'Fireteam Carrier': 0,
          'Titan Hauler': 0,
          'Combat Corvette': 0
        });
      }
      rowMap.get(a.name)[a.type] = a.count;
    });

    const missionRows = Array.from(rowMap.values());
    distributionBody.innerHTML = missionRows.map(row => {
      const mining = row['Mining Pod'] ? formatNumber_(row['Mining Pod'], 0) : '<span class="zero-cell">-</span>';
      const fireteam = row['Fireteam Carrier'] ? formatNumber_(row['Fireteam Carrier'], 0) : '<span class="zero-cell">-</span>';
      const titan = row['Titan Hauler'] ? formatNumber_(row['Titan Hauler'], 0) : '<span class="zero-cell">-</span>';
      const corvette = row['Combat Corvette'] ? formatNumber_(row['Combat Corvette'], 0) : '<span class="zero-cell">-</span>';
      return `<tr><td>${row.name}</td><td data-label="Mining Pod">${mining}</td><td data-label="Fireteam Carrier">${fireteam}</td><td data-label="Titan Hauler">${titan}</td><td data-label="Combat Corvette">${corvette}</td></tr>`;
    }).join('');
  }
}

function renderError_(err) {
  document.getElementById('campaignEtaText').textContent = '—';
  document.getElementById('modeUsedText').textContent = modeSelect.value;
  const errorCell = document.createElement('td');
  errorCell.colSpan = 2;
  errorCell.textContent = err.message;
  const errorRow = document.createElement('tr');
  errorRow.appendChild(errorCell);
  const totalsBody = document.getElementById('totalsBody');
  totalsBody.innerHTML = '';
  totalsBody.appendChild(errorRow);
  document.getElementById('distributionBody').innerHTML = '<tr><td colspan="5">No mission distribution available.</td></tr>';
}

function setStatus_(text) {
  document.getElementById('statusText').textContent = text;
}

initPersistence_();
clearOutput_();