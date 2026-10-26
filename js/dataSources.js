/* =====================================================================
 * dataSources.js — where readings come from.
 *
 * Both sources share the same small interface, so app.js does not care
 * which one is active:
 *
 *   source.start()   begin delivering readings
 *   source.stop()    pause (keeps current values)
 *   source.reset()   go back to the initial state
 *
 * Each source reports back through two callbacks given to its constructor:
 *   onReading({ received_at, scenario, readings })   new readings arrived
 *       readings = list of contract readings (timestamp, sensor_id, value,
 *                  unit, source, status), exactly as received
 *       scenario = { scenario_id, label, risk_level } or null (live)
 *   onConnection(state, message)                     connection/status changed
 * ===================================================================== */


/* ---------------------------------------------------------------------
 * 1) ScenarioSource — Scenario / Demo mode.
 *    Delivers the selected scenario from the SHARED MOCK DATA file
 *    (or, later, from the PRO-06 API). Values are passed on unchanged:
 *    nothing is generated or randomised in the browser.
 * --------------------------------------------------------------------- */
class ScenarioSource {
  constructor({ onReading, onConnection }) {
    this.onReading = onReading;
    this.onConnection = onConnection;
    this.timer = null;
    this.scenarioId = CONFIG.DEFAULT_SCENARIO;
  }

  setScenario(id) {
    this.scenarioId = id;
  }

  // File today; the Python API once CONFIG.SCENARIO_API_BASE is set.
  provider() {
    return CONFIG.SCENARIO_API_BASE ? ApiScenarioProvider : SharedFileScenarioProvider;
  }

  start() {
    if (this.timer) return true;
    this.onConnection("simulation", "Scenario / Demo: shared mock data");
    this.timer = setInterval(() => this.tick(), CONFIG.TICK_INTERVAL_MS);
    this.tick(); // first delivery immediately so the dashboard reacts at once
    return true;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  reset() {
    this.stop();
  }

  async tick() {
    const id = this.scenarioId;
    try {
      const sc = await this.provider().get(id);
      if (!this.timer || !sc) return; // stopped meanwhile, or unknown scenario
      this.onReading({
        received_at: new Date().toISOString(),
        scenario: { scenario_id: sc.scenario_id, label: sc.label, risk_level: sc.risk_level },
        readings: JSON.parse(JSON.stringify(sc.readings)), // copy: the source data is never modified
      });
    } catch (err) {
      this.onConnection("api_error", `Could not load scenario "${id}" from the backend: ${err.message}`);
    }
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
 * Expected messages from the backend use the SAME six-field contract as
 * the shared mock data, either one reading or a list of readings:
 *   { "timestamp": "...Z", "sensor_id": "sand_01", "value": 2.1,
 *     "unit": "cm", "source": "live", "status": "ok" }
 * Readings that break the contract (fields, sensor_id, unit) are ignored.
 * NOTE: a "source" value for real sensors is not defined in v1.0; "live" is
 * a proposal to agree with PRO-06 in a v2.0 file.
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
    this.running = false;          // Start pressed and not stopped/reset
    this.reconnects = 0;
    this.reconnectTimer = null;
    this.watchdog = null;
    this.lastReadingAt = 0;
    this.staleReported = false;
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
    this.running = true;
    this.reconnects = 0;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.sendCommand("start");
      this.startWatchdog();
      return true;
    }
    return this.connect();
  }

  connect() {
    this.onConnection("connecting", this.reconnects
      ? `Connection lost. Reconnecting to ${CONFIG.LIVE_BACKEND_URL} (attempt ${this.reconnects} of ${CONFIG.LIVE_RECONNECT_ATTEMPTS})…`
      : `Connecting to ${CONFIG.LIVE_BACKEND_URL} …`);
    let socket;
    try {
      socket = new WebSocket(CONFIG.LIVE_BACKEND_URL);
    } catch (err) {
      this.running = false;
      this.onConnection("disconnected", `Invalid backend address: ${err.message}`);
      return false;
    }
    this.socket = socket;

    let wasOpen = false;
    socket.onopen = () => {
      wasOpen = true;
      this.reconnects = 0;
      this.onConnection("connected", "Python backend connected. Waiting for sensor readings…");
      if (this.running) {
        this.sendCommand("start");
        this.startWatchdog();
      }
    };

    socket.onmessage = (event) => {
      const readings = LiveSensorSource.parseMessage(event.data);
      if (readings) {
        this.lastReadingAt = Date.now();
        if (this.staleReported) {
          this.staleReported = false;
          this.onConnection("connected", "Sensor readings are arriving again.");
        }
        this.onReading({ received_at: new Date().toISOString(), scenario: null, readings });
      } else {
        console.warn("Ignored invalid message from backend:", event.data);
      }
    };

    // A failed connection fires "error" and then "close"; we report once, on close.
    socket.onclose = () => {
      if (this.socket !== socket) return;   // an older socket we already replaced
      this.socket = null;
      this.stopWatchdog();
      // Lost while running: try again a few times before giving up.
      if ((wasOpen || this.reconnects > 0) && this.running && this.reconnects < CONFIG.LIVE_RECONNECT_ATTEMPTS) {
        this.reconnects += 1;
        this.onConnection("connecting",
          `Connection to the Python backend was lost. Reconnecting (attempt ${this.reconnects} of ${CONFIG.LIVE_RECONNECT_ATTEMPTS})…`);
        this.reconnectTimer = setTimeout(() => { if (this.running) this.connect(); }, CONFIG.LIVE_RECONNECT_DELAY_MS);
        return;
      }
      const wasReconnecting = this.reconnects > 0;
      this.running = false;
      this.onConnection("disconnected", wasOpen
        ? "Connection to the Python backend was closed."
        : wasReconnecting
          ? `Could not reconnect to the Python backend at ${CONFIG.LIVE_BACKEND_URL}. Is bridge.py still running?`
          : `Could not reach the Python backend at ${CONFIG.LIVE_BACKEND_URL}. Is bridge.py running?`);
    };
    return true;
  }

  // Connected but silent for too long: say so (the Arduino may be unplugged).
  startWatchdog() {
    this.stopWatchdog();
    this.lastReadingAt = Date.now();
    this.staleReported = false;
    this.watchdog = setInterval(() => {
      const silent = Date.now() - this.lastReadingAt;
      if (!this.staleReported && silent > CONFIG.LIVE_STALE_AFTER_MS) {
        this.staleReported = true;
        this.onConnection("stale", `Connected, but no sensor readings for ${Math.round(silent / 1000)} s. ` +
          "Check the Arduino cable, the serial port given to bridge.py and the sketch output.");
      }
    }, 1000);
  }

  stopWatchdog() {
    clearInterval(this.watchdog);
    this.watchdog = null;
  }

  stop() {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    this.stopWatchdog();
    this.sendCommand("stop");
    // The socket stays open so Start can resume without reconnecting.
  }

  reset() {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    this.stopWatchdog();
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

  // Validates one backend message. Returns a list of valid readings or null.
  static parseMessage(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.readings) ? data.readings : [data]);
    const valid = list.filter((r, i) => {
      const problems = validateReading(r, `live reading ${i + 1}`, null);
      if (problems.length) console.warn(problems.join(" "));
      return problems.length === 0;
    });
    return valid.length ? valid : null;
  }
}
