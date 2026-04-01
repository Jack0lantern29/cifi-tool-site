function byId(id) {
  return document.getElementById(id);
}

function getNumber(id) {
  const value = Number(byId(id).value);
  return Number.isFinite(value) ? value : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

function runDemoOptimizer() {
  const workers = {
    miningPods: getNumber('miningPods'),
    fireteams: getNumber('fireteams'),
    titans: getNumber('titans'),
    corvettes: getNumber('corvettes')
  };

  const mode = byId('mode').value;
  const campaignEnabled = byId('campaignEnabled').value === 'true';

  const totalWorkers = Object.values(workers).reduce((sum, count) => sum + count, 0);

  const summary = [
    'Demo run complete.',
    '',
    `Mode: ${mode}`,
    `Campaign enabled: ${campaignEnabled}`,
    '',
    'Worker totals',
    `- Mining Pods: ${formatNumber(workers.miningPods)}`,
    `- Fireteam Carriers: ${formatNumber(workers.fireteams)}`,
    `- Titan Haulers: ${formatNumber(workers.titans)}`,
    `- Combat Corvettes: ${formatNumber(workers.corvettes)}`,
    `- Total workers: ${formatNumber(totalWorkers)}`,
    '',
    'Placeholder assignments',
    `- F3-3: ${formatNumber(Math.floor(workers.miningPods * 0.85))} Mining Pods`,
    `- F3-2: ${formatNumber(Math.floor(workers.fireteams * 0.80))} Fireteam Carriers`,
    `- F4-1: ${formatNumber(Math.floor(workers.titans * 0.75))} Titan Haulers`,
    `- F1-4: ${formatNumber(Math.floor(workers.corvettes * 0.65))} Combat Corvettes`,
    '',
    'Next development step',
    'Replace this demo function with your real optimiser logic ported from Apps Script.'
  ].join('\n');

  byId('results').textContent = summary;
  byId('status').textContent = 'Demo completed successfully.';
}

function clearOutput() {
  byId('results').textContent = 'No results yet.';
  byId('status').textContent = '';
}

byId('runDemo').addEventListener('click', runDemoOptimizer);
byId('clearOutput').addEventListener('click', clearOutput);
