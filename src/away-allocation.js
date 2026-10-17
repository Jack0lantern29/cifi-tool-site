import { TYPE_ORDER } from "./data.js?v=3.2.7";

// Joint integer feasibility, rather than assigning the strongest workers to
// each mission in turn. A tight-cap mission may need those workers while a
// larger mission can use many weaker ones. All selected crews finish by return.
export function solveAwayAllocation(highs, jobs, free, workers, awayHours) {
  if (awayHours < 2 / 3600 || TYPE_ORDER.some(type => free[type] < 0)) return null;
  const types = TYPE_ORDER.filter(type => free[type] > 0 && workers[type].power > 0);
  if (!types.length) return null;
  const columns = jobs.flatMap(job => types.map(type => ({ job, type })));
  const rows = [];
  for (const type of types) rows.push({ coefficients: columns.map(col => col.type === type ? 1 : 0), lower: 0, upper: free[type] });
  for (const job of jobs) {
    rows.push({ coefficients: columns.map(col => col.job === job ? 1 : 0), lower: 1, upper: job.cap });
    const required = job.work / awayHours;
    const scale = Math.max(required, ...types.map(type => workers[type].power));
    rows.push({ coefficients: columns.map(col => col.job === job ? workers[col.type].power / scale : 0), lower: required / scale, upper: highs.infinity });
  }
  const starts = [0], indices = [], values = [];
  for (const row of rows) {
    row.coefficients.forEach((value, index) => { if (value) { indices.push(index); values.push(value); } });
    starts.push(indices.length);
  }
  const maxPower = Math.max(...types.map(type => workers[type].power));
  const model = highs.createModel();
  try {
    model.options.set({ output_flag: false, mip_rel_gap: 0, mip_abs_gap: 0, mip_feasibility_tolerance: 1e-9, primal_feasibility_tolerance: 1e-9, time_limit: 2, random_seed: 0 });
    model.passModel({
      numCols: columns.length, numRows: rows.length, sense: highs.constants.objectiveSense.minimize,
      colCost: columns.map(col => workers[col.type].power / maxPower),
      colLower: columns.map(() => 0), colUpper: columns.map(col => Math.min(col.job.cap, free[col.type])),
      rowLower: rows.map(row => row.lower), rowUpper: rows.map(row => row.upper),
      integrality: columns.map(() => highs.constants.variableType.integer),
      matrix: { format: "csr", numCols: columns.length, numRows: rows.length, starts, indices, values }
    });
    model.run();
    const status = model.getModelStatus();
    if (status === highs.constants.modelStatus.infeasible) return null;
    if (status !== highs.constants.modelStatus.optimal && model.info.get("primal_solution_status") !== highs.constants.solutionStatus.feasible) {
      throw new Error("The away crew check did not finish. Recalculate the plan.");
    }
    const vector = model.getSolution().colValue;
    const crews = Object.fromEntries(jobs.map(job => [job.name, Object.fromEntries(TYPE_ORDER.map(type => [type, 0]))]));
    columns.forEach((col, index) => { crews[col.job.name][col.type] = Math.round(vector[index]); });
    // Never trust solver tolerances to make a physically impossible crew valid.
    for (const job of jobs) {
      const crew = crews[job.name];
      const power = TYPE_ORDER.reduce((total, type) => total + crew[type] * workers[type].power, 0);
      if (TYPE_ORDER.some(type => !Number.isSafeInteger(crew[type]) || crew[type] < 0) || Object.values(crew).reduce((a, b) => a + b, 0) > job.cap || !(power > 0) || job.work / power > awayHours + 1e-10) {
        throw new Error("The away crew allocation could not be verified numerically.");
      }
    }
    if (TYPE_ORDER.some(type => jobs.reduce((total, job) => total + crews[job.name][type], 0) > free[type])) throw new Error("The away crew allocation exceeds available personnel.");
    return crews;
  } finally { model.dispose(); }
}
