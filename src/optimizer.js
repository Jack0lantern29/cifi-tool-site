import {
  CAMPAIGN_BASE_CAPS,
  getFx4FragmentBonusMultiplier as getFx4FragmentBonusMultiplier_,
  isCampaignName as isCampaignName_,
  MATS,
  MISSION_DATA,
  OURO_OFF_VISIBLE_CAMPAIGNS,
  OURO_OFF_VISIBLE_FARMS,
  TYPE_ORDER,
  TYPE_RANK
} from "./data.js?v=3.2.4";
import { createSeededRandom, deriveSeed, formatRunId } from "./random.js?v=3.2.4";
import {
  compareSummaries,
  describeObjective,
  getModeKind,
  normalizedHybridScore,
  summaryFromTotals
} from "./objective.js?v=3.2.4";
import { calculateGlobalSpeedMultiplier, validateInput } from "./validation.js?v=3.2.4";

const MIN_DURATION_MINS = 2 / 60;
const EPS = 1e-9;
const NEAR_BEST_POOL_PCT = 0.05;
const MULTISTART_MIN_RUNS = 3;
const MULTISTART_MAX_RUNS = 7;
const MULTISTART_STALE_LIMIT = 2;
const MULTISTART_TOP_K = 3;
const LOCAL_POLISH_MAX_PASSES = 5;
const LOCAL_POLISH_MAX_MOVES = 100;
const TYPE_REBUILD_MAX_UNITS = 8;
const FRAGMENT_SHORTLIST_SIZE = 6;
const RESOURCE_SHORTLIST_SIZE = 6;
const SA_INITIAL_TEMP = 1;
const SA_COOLING_RATE = 0.995;
const SA_MIN_TEMP = 0.001;
const SA_MAX_ITERATIONS = 2000;
const SA_SWAP_PROBABILITY = 0.35;

// Copy personnel counts and powers before trying changes.
function cloneWorkers_(workers) {
  return Object.fromEntries(TYPE_ORDER.map(type => [type, { ...workers[type] }]));
}

// Copy the personnel breakdown for every mission.
function cloneMissionWorkerCounts_(counts) {
  return Object.fromEntries(Object.entries(counts).map(([name, values]) => [name, { ...values }]));
}

// Calculate the campaign capacity bonus from Relic 11.
function getCampaignRelic11Multiplier_(ui) {
  if (!ui.ouroUnlocked) return 1;

  const relicLevel = Math.max(0, ui.relic11Level || 0);
  return 1 + (relicLevel * 0.5);
}

// Apply the relic bonus to a campaign's personnel limit.
function getEffectiveCampaignCap_(missionName, ui) {
  const baseCap = CAMPAIGN_BASE_CAPS[missionName];
  if (baseCap == null) return null;

  return Math.round(baseCap * getCampaignRelic11Multiplier_(ui));
}

// Prepare unlocked, selected farms and the chosen campaign target.
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

    // Keep only the chosen campaign; it will receive leftover personnel.
    if (isCampaignRow && (!ui.campaignEnabled || row.name !== ui.campaignTargetName)) {
      return;
    }

    if (!isCampaignRow && !ui.campaignEnabled && ui.selectedFarmMissions && !ui.selectedFarmMissions.has(row.name)) {
      return;
    }

    if (!isCampaignRow && ui.campaignEnabled && ui.selectedCampaignFarmMissions && !ui.selectedCampaignFarmMissions.has(row.name)) {
      return;
    }

    const baseCap = isCampaignRow
      ? (CAMPAIGN_BASE_CAPS[row.name] ?? row.cap)
      : row.cap;

    // Campaign mode filters farms to the selected concurrent set, then sends leftover personnel to campaign.
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

// Try several farm allocations, improve them, and assign campaign leftovers.
function solveOptimizer_(ui, missions, campaignMission, rng, onProgress) {
  const modeNorm = ui.modeNorm;

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

  let workers = cloneWorkers_(ui.workers);
  const workerPowers = ui.workerPowers;
  const weights = ui.weights;
  const globalSpeedMult = ui.globalSpeedMult;
  const ts07Mult = ui.ts07Enabled ? 2.0 : 1.0;
  const fragmentsPerCompletion = ui.fragmentsPerCompletion;
  const hybridIdeals = ui.hybridIdeals || null;
  const hybridFragmentWeight = Number.isFinite(hybridIdeals?.fragmentWeight) ? hybridIdeals.fragmentWeight : 0.75;
  const hybridResourceWeight = 1 - hybridFragmentWeight;
  let assignmentMap = {};
  let totals = { Academy: 0, Completions: 0, Fragments: 0 };
  MATS.forEach(m => totals[m] = 0);
  let missionWorkerCounts = {};
  missions.forEach(m => missionWorkerCounts[m.name] = {});
  const farmMissionPool = missions.filter(mission => !mission.isCampaign);

  // Calculate hourly mission runs, respecting the two-second minimum.
  function missionRunsPerHour(baseMins, totalPower) {
    if (!totalPower || totalPower <= 0) return 0;
    const rawMinutes = baseMins / (globalSpeedMult * totalPower);
    const actualMinutes = Math.max(rawMinutes, MIN_DURATION_MINS);
    return 60.0 / actualMinutes;
  }

  // Estimate how many hours the campaign mission will take.
  function campaignETAHours(mission, totalPower) {
    if (!mission || !totalPower || totalPower <= 0) return Infinity;
    const rawMinutes = mission.baseMins / (globalSpeedMult * totalPower);
    const actualMinutes = Math.max(rawMinutes, MIN_DURATION_MINS);
    return actualMinutes / 60.0;
  }

  // Estimate campaign time using its currently assigned personnel.
  function currentCampaignETA() {
    if (!campaignMission) return Infinity;
    return campaignETAHours(campaignMission, campaignMission.currentPower);
  }

  // Create a lookup key for one mission and personnel type.
  function assignmentKey_(missionName, workerType) {
    return missionName + "|" + workerType;
  }

  // Update an assignment count and remove empty entries.
  function addAssignment(missionName, workerType, deltaCount) {
    const key = assignmentKey_(missionName, workerType);
    const oldVal = assignmentMap[key] || 0;
    const newVal = oldVal + deltaCount;
    if (newVal > 0) assignmentMap[key] = newVal;
    else delete assignmentMap[key];
  }

  // Convert assignment counts into the result's list format.
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

  // Add one worker and update the mission's power and run rate.
  function addWorkerToMission(mission, type) {
    const power = workerPowers[type];
    mission.assignedUnits++;
    mission.currentPower += power;
    if (!mission.isCampaign) {
      mission.currentRunsPerHour = missionRunsPerHour(mission.baseMins, mission.currentPower);
    }
    missionWorkerCounts[mission.name][type] = (missionWorkerCounts[mission.name][type] || 0) + 1;
  }

  // Remove one worker and update the mission's power and run rate.
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

  // Add the base fragments and this mission's fragment bonus.
  function getFragmentYieldPerCompletion_(mission) {
    return fragmentsPerCompletion + (mission.baseFragments || 0);
  }

  // Add the rewards gained from extra mission runs.
  function addFarmContributionToTotals(mission, deltaRuns) {
    totals.Completions += deltaRuns * ts07Mult;
    totals.Academy += deltaRuns * ts07Mult * mission.baseAcademy;
    totals.Fragments += deltaRuns * getFragmentYieldPerCompletion_(mission);
    MATS.forEach(mat => {
      totals[mat] += deltaRuns * ts07Mult * mission.baseRewards[mat];
    });
  }

  // Subtract rewards lost when a mission's run rate falls.
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

  // Calculate the current resource score using the selected priorities.
  function currentUtility() {
    let u = 0;
    MATS.forEach(mat => {
      const w = weights[mat] || 1.0;
      u += w * Math.log(totals[mat] + 1);
    });
    return u;
  }

  // Measure the resource-score gain from extra mission runs.
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

  // Measure the resource-score loss from fewer mission runs.
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

  // Estimate what adding one worker would gain for the selected mode.
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
    } else if (isFragmentsMode) {
      baseRaw = fragmentRaw;
    } else if (isFragResMode) {
      const fragIdeal = Math.max(0, hybridIdeals?.fragments || 0);
      const resourceIdeal = Math.max(0, hybridIdeals?.resourceUtility || 0);
      if (fragIdeal <= EPS && resourceIdeal <= EPS) baseRaw = deltaRuns * ts07Mult;
      else if (fragIdeal <= EPS) baseRaw = resourceRaw / resourceIdeal;
      else if (resourceIdeal <= EPS) baseRaw = fragmentRaw / fragIdeal;
      else baseRaw = hybridFragmentWeight * fragmentRaw / fragIdeal + hybridResourceWeight * resourceRaw / resourceIdeal;
    } else if (isMaxCompMode) {
      baseRaw = deltaRuns * ts07Mult;
    } else {
      baseRaw = deltaRuns * ts07Mult;
    }

    if (baseRaw <= EPS) return null;
    return { deltaRuns, baseRaw, fragmentRaw, resourceRaw };
  }

  // Estimate what removing one worker would lose for the selected mode.
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
    } else if (isFragmentsMode) {
      baseLossRaw = fragmentLossRaw;
    } else if (isFragResMode) {
      const fragIdeal = Math.max(0, hybridIdeals?.fragments || 0);
      const resourceIdeal = Math.max(0, hybridIdeals?.resourceUtility || 0);
      if (fragIdeal <= EPS && resourceIdeal <= EPS) baseLossRaw = deltaRunsLoss * ts07Mult;
      else if (fragIdeal <= EPS) baseLossRaw = resourceLossRaw / resourceIdeal;
      else if (resourceIdeal <= EPS) baseLossRaw = fragmentLossRaw / fragIdeal;
      else baseLossRaw = hybridFragmentWeight * fragmentLossRaw / fragIdeal + hybridResourceWeight * resourceLossRaw / resourceIdeal;
    } else if (isMaxCompMode) {
      baseLossRaw = deltaRunsLoss * ts07Mult;
    } else {
      baseLossRaw = deltaRunsLoss * ts07Mult;
    }

    if (baseLossRaw <= EPS) return null;
    return { deltaRunsLoss, baseLossRaw, fragmentLossRaw, resourceLossRaw };
  }

  // Fill campaign slots with the strongest personnel left after farming.
  function assignRemainingWorkersToCampaign_() {
    if (!ui.campaignEnabled || !campaignMission) return;

    const campaignTypeOrder = [...TYPE_ORDER].sort((a, b) =>
      (workerPowers[b] || 0) - (workerPowers[a] || 0) || TYPE_RANK[a] - TYPE_RANK[b]);
    for (let ti = 0; ti < campaignTypeOrder.length; ti++) {
      const type = campaignTypeOrder[ti];
      const worker = workers[type];
      if (!worker || worker.count <= 0 || worker.power <= 0) continue;

      const availableSlots = campaignMission.cap - campaignMission.assignedUnits;
      const assignedCount = Math.min(worker.count, availableSlots);
      if (assignedCount > 0) {
        addAssignment(campaignMission.name, type, assignedCount);
        campaignMission.assignedUnits += assignedCount;
        campaignMission.currentPower += workerPowers[type] * assignedCount;
        missionWorkerCounts[campaignMission.name][type] =
          (missionWorkerCounts[campaignMission.name][type] || 0) + assignedCount;
        worker.count -= assignedCount;
      }

      if (campaignMission.assignedUnits >= campaignMission.cap) break;
    }
  }

  // Summarise the current rewards for comparing allocations.
  function getSolutionSummary_() {
    return summaryFromTotals(totals, weights);
  }

  // Check whether a candidate is better for the selected mode.
  function isSummaryBetter_(cand, incumbent) {
    return compareSummaries(ui.modeRaw, cand, incumbent, hybridIdeals) > 0;
  }

  // Save the current allocation so trial changes can be undone.
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
      missionWorkerCounts: cloneMissionWorkerCounts_(missionWorkerCounts)
    };
  }

  // Restore a previously saved allocation and its totals.
  function restoreState_(snap) {
    assignmentMap = Object.assign({}, snap.assignmentMap);
    totals = Object.assign({}, snap.totals);
    missionWorkerCounts = cloneMissionWorkerCounts_(snap.missionWorkerCounts);
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

  // Quickly estimate the fragment gain from adding one worker.
  function roughFragmentScore_(mission, type) {
    const power = workerPowers[type];
    if (!power || mission.isCampaign || mission.assignedUnits >= mission.cap) return -1;
    const oldRuns = mission.currentRunsPerHour;
    const newRuns = missionRunsPerHour(mission.baseMins, mission.currentPower + power);
    const deltaRuns = newRuns - oldRuns;
    if (deltaRuns <= EPS) return -1;
    return deltaRuns * getFragmentYieldPerCompletion_(mission);
  }

  // Quickly estimate the weighted resource gain from adding one worker.
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

  // Shortlist promising missions for one personnel type.
  function getCandidateMissionsForType_(type) {
    const currentAssigned = [];
    const fragmentRanked = [];
    const resourceRanked = [];
    farmMissionPool.forEach(mission => {
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
    // Add a mission to the shortlist without repeating it.
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

  // Pick a strong option, allowing some variety between search attempts.
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
    let r = rng() * totalWeight;
    for (let i = 0; i < pool.length; i++) {
      r -= localWeights[i];
      if (r <= 0) return pool[i];
    }
    return pool[0];
  }

  // Build an allocation by repeatedly choosing a useful worker placement.
  function executeGreedyAllocation_(randomize) {
    const totalWorkersAtStart = TYPE_ORDER.reduce((s, t) => s + ((workers[t] && workers[t].count) || 0), 0);
    while (true) {
      let candidates = [];
      let maxBaseRaw = 0;

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
            mission, type,
            power: worker.power,
            deltaRuns: farm.deltaRuns,
            baseRaw: farm.baseRaw,
            fragmentRaw: farm.fragmentRaw || 0,
            resourceRaw: farm.resourceRaw || 0
          });
        }
      }

      if (candidates.length === 0) break;

      const invMaxBase = maxBaseRaw > EPS ? 1 / maxBaseRaw : 0;

      candidates.forEach(c => {
        c.baseNorm = c.baseRaw * invMaxBase;
        c.finalScore = c.baseNorm;
      });

      candidates.sort((a, b) => b.finalScore - a.finalScore);
      const best = candidates[0];
      if (!best || best.finalScore <= EPS) break;

      const threshold = best.finalScore * (1 - NEAR_BEST_POOL_PCT);
      const pool = candidates.filter(c => c.finalScore + EPS >= threshold);

      pool.sort((a, b) => {
        const df = b.finalScore - a.finalScore;
        if (Math.abs(df) > 1e-12) return df;
        const db = b.baseNorm - a.baseNorm;
        if (Math.abs(db) > 1e-12) return db;

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

      const remainingWorkers = TYPE_ORDER.reduce((sum, type) => sum + (workers[type]?.count || 0), 0);
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
      addFarmContributionToTotals(mission, pick.deltaRuns);
    }
  }

  // Try rebuilding farms around their two-second speed limits.
  function floorRebalance_() {
    if (!globalSpeedMult || globalSpeedMult <= 0) return;

    const beforeSnap = snapshotState_();
    const beforeSummary = getSolutionSummary_();

    farmMissionPool.forEach(mission => {
      TYPE_ORDER.forEach(type => {
        let count = missionWorkerCounts[mission.name][type] || 0;
        while (count > 0) {
          removeWorkerFromMission(mission, type);
          addAssignment(mission.name, type, -1);
          workers[type].count++;
          count--;
        }
      });
    });
 

    totals.Completions = 0;
    totals.Academy = 0;
    totals.Fragments = 0;
    MATS.forEach(m => totals[m] = 0);
 

    const farmBySpeed = [...farmMissionPool]
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

  // Look for better allocations by moving or swapping personnel.
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

  // Try redistributing small groups of one personnel type.
  function polishByWorkerType_() {
    TYPE_ORDER.forEach(type => {
      const baseSnap = snapshotState_();
      const baseSummary = getSolutionSummary_();
      const baseUnassigned = baseSnap.workerCounts[type] || 0;

      let removable = [];
      farmMissionPool.forEach(mission => {
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

  // Place spare personnel when they improve the main or secondary score.
  function assignUnassignedTieBreakers_() {
    while (true) {
      const baseSummary = getSolutionSummary_();
      let best = null;

      TYPE_ORDER.forEach(type => {
        if (!workers[type] || workers[type].count <= 0 || workerPowers[type] <= 0) return;
        farmMissionPool.forEach(mission => {
          if (mission.assignedUnits >= mission.cap) return;
          const oldRuns = mission.currentRunsPerHour;
          const newRuns = missionRunsPerHour(mission.baseMins, mission.currentPower + workerPowers[type]);
          const deltaRuns = newRuns - oldRuns;
          if (deltaRuns <= EPS) return;

          const snap = snapshotState_();
          addWorkerToMission(mission, type);
          addAssignment(mission.name, type, 1);
          workers[type].count--;
          addFarmContributionToTotals(mission, deltaRuns);
          const candidateSummary = getSolutionSummary_();
          if (isSummaryBetter_(candidateSummary, baseSummary) &&
              (!best || isSummaryBetter_(candidateSummary, best.summary))) {
            best = { snap: snapshotState_(), summary: candidateSummary };
          }
          restoreState_(snap);
        });
      });

      if (!best) break;
      restoreState_(best.snap);
    }
  }

  // Free personnel who no longer improve a speed-capped farm.
  function removeRedundantCappedWorkers_() {
    farmMissionPool.forEach(mission => {
      const cappedRunsPerHour = 60 / MIN_DURATION_MINS;
      if (mission.currentRunsPerHour < cappedRunsPerHour) return;
      const requiredPower = mission.baseMins / (globalSpeedMult * MIN_DURATION_MINS);
      for (let typeIndex = TYPE_ORDER.length - 1; typeIndex >= 0; typeIndex--) {
        const type = TYPE_ORDER[typeIndex];
        const count = missionWorkerCounts[mission.name][type] || 0;
        const power = workerPowers[type] || 0;
        if (count <= 0 || power <= 0) continue;
        const removable = Math.min(count, Math.max(0, Math.floor((mission.currentPower - requiredPower) / power)));
        if (removable <= 0) continue;
        mission.assignedUnits -= removable;
        mission.currentPower -= power * removable;
        mission.currentRunsPerHour = missionRunsPerHour(mission.baseMins, mission.currentPower);
        missionWorkerCounts[mission.name][type] -= removable;
        if (missionWorkerCounts[mission.name][type] <= 0) delete missionWorkerCounts[mission.name][type];
        addAssignment(mission.name, type, -removable);
        workers[type].count += removable;
      }
    });
  }

  // Explore random moves and swaps to escape a stuck allocation.
  function simulatedAnnealingPolish_() {
    const farmMissions = farmMissionPool;
    if (farmMissions.length < 2) return;

    // Return the main score used to judge a trial move.
    function scalarScore() {
      const s = getSolutionSummary_();
      if (isResourcesMode) return s.resourceUtility;
      if (isAcademyMode)   return s.academy;
      if (isMaxCompMode)   return s.completions;
      if (isFragmentsMode) return s.fragments;
      if (isFragResMode)   return normalizedHybridScore(s, hybridIdeals);
      return s.completions;
    }

    // Choose one item using the run's repeatable random sequence.
    function randChoice(arr) {
      return arr[Math.floor(rng() * arr.length)];
    }

    // Choose a personnel type currently assigned to this mission.
    function randTypeOnMission(mission) {
      const types = TYPE_ORDER.filter(
        t => (missionWorkerCounts[mission.name][t] || 0) > 0
      );
      return types.length > 0 ? randChoice(types) : null;
    }

    // Try moving one randomly chosen worker to another farm.
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

    // Try swapping personnel between two farms.
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
    let bestSummary = getSolutionSummary_();

    for (let iter = 0; iter < SA_MAX_ITERATIONS; iter++) {
      const beforeSnap = snapshotState_();
      const beforeScore = currentScore;
      let moved;
      if (rng() < SA_SWAP_PROBABILITY) {
        moved = tryNeighborSwap();
      } else {
        moved = tryNeighborRelocate();
      }
      if (!moved) continue;
      const neighborScore = scalarScore();
      const delta = neighborScore - beforeScore;
      if (delta > 0 || rng() < Math.exp(delta / temperature)) {
        currentScore = neighborScore;
        const currentSummary = getSolutionSummary_();
        if (isSummaryBetter_(currentSummary, bestSummary)) {
          bestSnap = snapshotState_();
          bestSummary = currentSummary;
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

  const emptySnap = snapshotState_();
  const runResults = [];
  let bestSoFar = null;
  let staleRuns = 0;
  let runIdx = 0;

  while (runIdx < MULTISTART_MAX_RUNS) {
    restoreState_(emptySnap);
    const randomize = runIdx > 0;
    executeGreedyAllocation_(randomize);

    polishFarmSolution_();

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
    onProgress({ phase: "optimising", completed: runIdx, total: MULTISTART_MAX_RUNS });
    if (runIdx >= MULTISTART_MIN_RUNS && staleRuns >= MULTISTART_STALE_LIMIT) break;
  }

  // Select the strongest result from all search attempts.
  function chooseBestRun_(results) {
    if (!results || results.length === 0) return null;
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

  onProgress({ phase: "polishing", completed: 0, total: 1 });
  floorRebalance_();

  polishByWorkerType_();
  polishFarmSolution_();

  if (!isSummaryBetter_(getSolutionSummary_(), preFloorSummary)) {
    restoreState_(preFloorSnap);
  }
  const preAnnealSnap = snapshotState_();
  const preAnnealSummary = getSolutionSummary_();
  simulatedAnnealingPolish_();
  if (compareSummaries(ui.modeRaw, getSolutionSummary_(), preAnnealSummary, hybridIdeals) < 0) {
    restoreState_(preAnnealSnap);
  }
  assignUnassignedTieBreakers_();
  removeRedundantCappedWorkers_();

  // Finish the farms before assigning the campaign remainder.
  onProgress({ phase: "campaign", completed: 0, total: 1 });
  assignRemainingWorkersToCampaign_();
  const assignments = getAssignmentsArray_().sort((a, b) => {
    const nameComp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    if (nameComp !== 0) return nameComp;
    const rankA = TYPE_RANK[a.type] || 99;
    const rankB = TYPE_RANK[b.type] || 99;
    return rankA - rankB;
  });

  const finalSummary = getSolutionSummary_();
  const objective = describeObjective(ui.modeRaw, finalSummary, hybridIdeals);
  return {
    assignments,
    totals,
    campaignETA: ui.campaignEnabled && campaignMission ? currentCampaignETA() : Infinity,
    campaignCapacity: campaignMission?.cap || 0,
    campaignAssigned: campaignMission?.assignedUnits || 0,
    selectedFarmCount: farmMissionPool.length,
    selectedFarmNames: farmMissionPool.map(mission => mission.name),
    unassignedWorkers: Object.fromEntries(TYPE_ORDER.map(type => [type, workers[type]?.count || 0])),
    globalSpeedMult,
    modeUsed: ui.modeRaw,
    searchEffort: "standard",
    solutionStatus: "best-found",
    objective: { ...objective, upperBound: null, relativeGap: null },
    solverStats: { engine: "CIFI heuristic", version: "3.2.4", nodes: 0, iterations: runResults.length },
    hybridIdeals: hybridIdeals ? { ...hybridIdeals, proven: false } : null
  };
}

export class OptimizerValidationError extends Error {
  // Keep the input problems together in one error.
  constructor(errors) {
    super("The optimiser input is invalid.");
    this.name = "OptimizerValidationError";
    this.errors = errors;
  }
}

/**
 * Run the standard search, repeating the same choices for the same inputs.
 * @param {import('./types.js').OptimizerInput} rawInput
 * @param {{ seed?: number, onProgress?: (progress: {phase: string, determinate: boolean, completed: number, total: number, elapsedMs?: number, nodes?: number, upperBound?: number, relativeGap?: number}) => void }} options
 * @returns {import('./types.js').OptimizerResult}
 */
export function optimize(rawInput, options = {}) {
  const { input, errors } = validateInput(rawInput);
  if (errors.length) throw new OptimizerValidationError(errors);

  const seedInput = {
    ...input,
    selectedFarmMissions: [...input.selectedFarmMissions].sort(),
    selectedCampaignFarmMissions: [...input.selectedCampaignFarmMissions].sort()
  };
  const runSeed = deriveSeed(seedInput);
  const effectiveSeedFarms = input.campaignEnabled
    ? [...input.selectedCampaignFarmMissions].sort()
    : [...input.selectedFarmMissions].sort();
  const solverSeedInput = {
    ...seedInput,
    campaignEnabled: false,
    campaignTargetName: "",
    relic11Level: 0,
    selectedFarmMissions: effectiveSeedFarms,
    selectedCampaignFarmMissions: effectiveSeedFarms
  };
  // Route preferences must not change the farm search or its established seed.
  delete solverSeedInput.shortsEnabled;
  delete solverSeedInput.shortsProgress;
  const solverSeed = Number.isInteger(options.seed) ? options.seed >>> 0 : deriveSeed(solverSeedInput);
  const rng = createSeededRandom(solverSeed);
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  // Send progress with a known amount of work to complete.
  const reportProgress = progress => onProgress({ determinate: true, ...progress });
  const workerPowers = Object.fromEntries(TYPE_ORDER.map(type => [type, input.workers[type].power]));
  const selectedFarmMissions = new Set(input.selectedFarmMissions);
  const selectedCampaignFarmMissions = new Set(input.selectedCampaignFarmMissions);
  const ui = {
    ...input,
    workerPowers,
    selectedFarmMissions,
    selectedCampaignFarmMissions,
    modeRaw: input.mode,
    modeNorm: input.mode.trim().toLowerCase(),
    globalSpeedMult: calculateGlobalSpeedMultiplier(input),
    ts07Enabled: input.modifiers.ts07Enabled,
    hybridIdeals: null
  };

  reportProgress({ phase: "preparing", completed: 0, total: 1 });
  if (getModeKind(input.mode) === "hybrid") {
    reportProgress({ phase: "estimating-ideals", completed: 0, total: 2 });
    const effectiveFarms = input.campaignEnabled ? selectedCampaignFarmMissions : selectedFarmMissions;
    const idealBase = {
      ...ui,
      campaignEnabled: false,
      campaignTargetName: "",
      selectedFarmMissions: new Set(effectiveFarms),
      selectedCampaignFarmMissions: new Set(effectiveFarms)
    };
    const fragmentUi = { ...idealBase, modeRaw: "Fragments", modeNorm: "fragments" };
    const fragmentPool = buildMissionPool_(fragmentUi);
    const fragmentResult = solveOptimizer_(fragmentUi, fragmentPool.missions, null, createSeededRandom(solverSeed ^ 0x9e3779b9), () => {});
    reportProgress({ phase: "estimating-ideals", completed: 1, total: 2 });
    const resourceUi = { ...idealBase, modeRaw: "Maximising Resources", modeNorm: "maximising resources" };
    const resourcePool = buildMissionPool_(resourceUi);
    const resourceResult = solveOptimizer_(resourceUi, resourcePool.missions, null, createSeededRandom(solverSeed ^ 0x85ebca6b), () => {});
    ui.hybridIdeals = {
      fragments: fragmentResult.totals.Fragments,
      resourceUtility: summaryFromTotals(resourceResult.totals, input.weights).resourceUtility,
      fragmentWeight: input.hybridFragmentPercent / 100,
      resourceWeight: 1 - input.hybridFragmentPercent / 100
    };
    reportProgress({ phase: "estimating-ideals", completed: 2, total: 2 });
  }
  const { missions, campaignMission } = buildMissionPool_(ui);
  const result = solveOptimizer_(ui, missions, campaignMission, rng, reportProgress);
  const unassignedWorkers = result.unassignedWorkers;
  const notices = [];
  if (result.selectedFarmCount === 0) notices.push("No farm missions were selected for this run.");
  if (input.campaignEnabled && result.campaignAssigned >= result.campaignCapacity && Object.values(unassignedWorkers).some(count => count > 0)) {
    notices.push("Campaign capacity was reached; some personnel remain unassigned.");
  }
  if (result.assignments.length === 0) notices.push("No personnel could be assigned with the current inputs.");
  reportProgress({ phase: "complete", completed: 1, total: 1 });
  return { ...result, seed: runSeed, runId: formatRunId(runSeed), notices };
}

export { buildMissionPool_ as buildMissionPoolForTest };
