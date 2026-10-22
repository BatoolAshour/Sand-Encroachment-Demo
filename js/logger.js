/* =====================================================================
 * logger.js — keeps every reading of the experiment and exports CSV.
 *
 * The log lives in memory only (refreshing the page clears it).
 * Reset does NOT clear the log, so a finished run can still be exported.
 * Use "Clear log" to empty it. Each run gets its own run_id.
 *
 * [PYTHON INTEGRATION NOTE] In the finished system bridge.py will also
 * save its own log file on the computer; this browser log stays useful
 * for quick exports during demonstrations.
 * ===================================================================== */

const CSV_COLUMNS = [
  "run_id", "timestamp", "elapsed_s", "mode", "scenario",
  "sand_level", "risk_level", "road_condition", "status",
  // Environmental / satellite columns: SAMPLE values while data_source = "sample"
  "data_source", "observation_date", "temperature_c", "humidity_pct", "wind_speed_mps",
  "sand_coverage_pct", "vegetation_coverage_pct", "bare_soil_pct", "distance_to_road_m",
  "demo_indicator_score", "demo_indicator_level",
];

class ExperimentLogger {
  constructor() {
    this.entries = [];
  }

  add(entry) {
    this.entries.push(entry);
  }

  clear() {
    this.entries = [];
  }

  get count() {
    return this.entries.length;
  }

  // Newest entries first, for the on-screen table.
  latest(n) {
    return this.entries.slice(-n).reverse();
  }

  toCSV() {
    const escape = (value) => {
      const text = value === null || value === undefined ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows = this.entries.map((entry) => CSV_COLUMNS.map((col) => escape(entry[col])).join(","));
    return [CSV_COLUMNS.join(","), ...rows].join("\n");
  }

  // Downloads the log as a .csv file. Returns false if there is nothing to export.
  downloadCSV() {
    if (this.entries.length === 0) return false;
    const blob = new Blob([this.toCSV()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = `sand_experiment_log_${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
}
