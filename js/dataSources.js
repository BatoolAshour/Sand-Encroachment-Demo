/* =====================================================================
 * dataSources.js — where readings come from.
 *
 * Both sources share the same small interface, so app.js does not care
 * which one is active:
 *
 *   source.start()   begin producing readings
 *   source.stop()    pause (keeps current values)
 *   source.reset()   go back to the initial state
 *
 * Each source reports back through two callbacks given to its constructor:
 *   onReading({ timestamp, sand_level })      a new raw reading arrived
 *   onConnection(state, message)              connection/status changed
 *
 * app.js turns a raw reading into the full data object and passes it to
 * updateDashboard(). Risk is always calculated in the browser (risk.js),
 * so the same thresholds apply to simulated and real data.
 * ===================================================================== */


/* ---------------------------------------------------------------------
 * 1) SimulationSource — generates readings in the browser.
 *    No backend or hardware needed.
 * --------------------------------------------------------------------- */
class SimulationSource {
  constructor({ onReading, onConnection }) {
    this.onReading = onReading;
    this.onConnection = onConnection;
    this.timer = null;
    this.level = 0;
    this.scenarioKey = CONFIG.DEFAULT_SCENARIO;
  }

  setScenario(key) {
    if (CONFIG.SCENARIOS[key]) this.scenarioKey = key;
  }

  start() {
    if (this.timer) return true;
    this.onConnection("simulation", "Scenario simulation running in the browser");
    this.timer = setInterval(() => this.tick(), CONFIG.TICK_INTERVAL_MS);
    this.tick(); // first reading immediately so the dashboard reacts at once
    return true;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  reset() {
    this.stop();
    this.level = 0;
  }

  // One simulation step: add some sand, never more than the scenario allows.
  tick() {
    const scenario = CONFIG.SCENARIOS[this.scenarioKey];
    if (this.level < scenario.maxLevel) {
      const randomFactor = 0.6 + Math.random() * 0.8; // 0.6 – 1.4
      this.level = Math.min(scenario.maxLevel, this.level + scenario.rate * randomFactor);
    }
    // Sand does not disappear by itself, so the level never goes down here.
    this.onReading({
      timestamp: new Date().toISOString(),
      sand_level: clampLevel(this.level),
    });
  }
}


/* ---------------------------------------------------------------------
 * 2) LiveSensorSource — receives REAL readings from the Python backend.
 *
 * [PYTHON / ARDUINO INTEGRATION POINT]
 * Data path in the finished system:
 *
 *   Sand sensors -> Arduino/ESP32 -> USB serial -> python/bridge.py
 *                -> WebSocket (CONFIG.LIVE_BACKEND_URL) -> this class
 *
 * Expected message from the backend (one JSON object per reading):
 *   { "timestamp": "2026-10-22T12:00:00Z", "sand_level": 45 }
 * Extra fields are allowed and ignored. risk_level is recalculated here.
 *
 * Optional commands this class sends to the backend, so Python can
 * forward them to the Arduino (e.g. switch the fan on/off):
 *   { "command": "start" } | { "command": "stop" } | { "command": "reset" }
 *
 * While CONFIG.LIVE_BACKEND_URL is null nothing is connected and NO
 * readings are produced. This class never invents sensor values.
 * --------------------------------------------------------------------- */
class LiveSensorSource {
  constructor({ onReading, onConnection }) {
    this.onReading = onReading;
    this.onConnection = onConnection;
    this.socket = null;
  }

  isConfigured() {
    return typeof CONFIG.LIVE_BACKEND_URL === "string" && CONFIG.LIVE_BACKEND_URL.length > 0;
  }

  // Returns false when the backend is not configured, so app.js can explain why.
  start() {
    if (!this.isConfigured()) {
      this.onConnection("not_configured",
        "Python/Arduino integration is not configured yet. No sensor data is available.");
      return false;
    }
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.sendCommand("start");
      return true;
    }

    this.onConnection("connecting", `Connecting to ${CONFIG.LIVE_BACKEND_URL} …`);
    try {
      this.socket = new WebSocket(CONFIG.LIVE_BACKEND_URL);
    } catch (err) {
      this.onConnection("disconnected", `Invalid backend address: ${err.message}`);
      return false;
    }

    let wasOpen = false;
    this.socket.onopen = () => {
      wasOpen = true;
      this.onConnection("connected", "Python backend connected. Waiting for sensor readings…");
      this.sendCommand("start");
    };

    this.socket.onmessage = (event) => {
      const reading = LiveSensorSource.parseMessage(event.data);
      if (reading) {
        this.onReading(reading);
      } else {
        console.warn("Ignored invalid message from backend:", event.data);
      }
    };

    // A failed connection fires "error" and then "close"; we report once, on close.
    this.socket.onclose = () => {
      this.socket = null;
      this.onConnection("disconnected", wasOpen
        ? "Connection to the Python backend was closed."
        : `Could not reach the Python backend at ${CONFIG.LIVE_BACKEND_URL}. Is bridge.py running?`);
    };
    return true;
  }

  stop() {
    this.sendCommand("stop");
    // The socket stays open so Start can resume without reconnecting.
  }

  reset() {
    this.sendCommand("reset");
    if (this.socket) {
      this.socket.onclose = null; // closing on purpose: no "disconnected" warning
      this.socket.close();
      this.socket = null;
    }
  }

  sendCommand(command) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ command }));
    }
  }

  // Validates one backend message. Returns a raw reading or null.
  static parseMessage(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    const level = Number(data && data.sand_level);
    if (!Number.isFinite(level)) return null;
    return {
      timestamp: typeof data.timestamp === "string" ? data.timestamp : new Date().toISOString(),
      sand_level: clampLevel(level),
    };
  }
}
