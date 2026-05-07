/**
 * esp32-barrier-controller.ino — GarageIA Barrier Controller v3.0
 *
 * NON-BLOCKING firmware for ESP32 that controls two relay channels
 * (entry/exit barrier) and reads a Radar LD2450 anti-crush sensor.
 *
 * Architecture: Cooperative multitasking via millis()-based state machine.
 * NO delay() calls anywhere. The main loop runs at full speed so that
 * TCP commands and sensor reads are processed in real-time.
 *
 * SAFETY INVARIANT (LIFE-CRITICAL):
 *   If the radar reports OCCUPIED, the exit relay MUST remain HIGH
 *   (barrier arm stays UP) regardless of any network command or timeout.
 *   The ESP32 enforces this locally — even if the Node server crashes.
 *
 * Protocol (Server → ESP32):
 *   OPEN:ENTRY\n   → Activate entry relay for RELAY_PULSE_MS, then auto-off
 *   OPEN:EXIT\n    → Activate exit relay for RELAY_PULSE_MS, then auto-off
 *                    (auto-off is BLOCKED while radar reads OCCUPIED)
 *
 * Protocol (ESP32 → Server):
 *   ACK:OPEN_ENTRY\n     → Entry relay activated
 *   ACK:OPEN_EXIT\n      → Exit relay activated
 *   SENSOR:OCCUPIED\n    → Radar detected object under barrier
 *   SENSOR:CLEAR\n       → Radar zone is clear
 *
 * Hardware Wiring:
 *   GPIO 12 → Relay CH1 (Entry barrier)
 *   GPIO 13 → Relay CH2 (Exit barrier)
 *   GPIO 14 → Radar LD2450 digital output (HIGH = object detected)
 *   GPIO  2 → Onboard LED (WiFi status indicator)
 */

#include <WiFi.h>

// ── CONFIGURATION ────────────────────────────────────────────────────

// WiFi credentials
const char* WIFI_SSID     = "MONTEGROSSO2.4G";
const char* WIFI_PASSWORD = "Pacheco1581";

// Hardware pin assignments
const int PIN_RELAY_ENTRY  = 12;   // Relay channel for entry barrier
const int PIN_RELAY_EXIT   = 13;   // Relay channel for exit barrier
const int PIN_RADAR_SENSOR = 14;   // Radar LD2450 digital output
const int PIN_LED_WIFI     = 2;    // Onboard LED (WiFi indicator)

// Timing constants
const unsigned long RELAY_PULSE_MS       = 3000;  // Hold relay ON for 3 seconds
const unsigned long SENSOR_DEBOUNCE_MS   = 200;   // Debounce radar reads (avoid flicker)
const unsigned long WIFI_BLINK_MS        = 500;   // LED blink interval while connecting
const unsigned long WIFI_RECONNECT_MS    = 5000;  // Retry WiFi every 5 seconds
const unsigned long TCP_KEEPALIVE_MS     = 15000; // Send heartbeat every 15 seconds (aligned with Node 5s keep-alive)

// TCP Server port (matches EthernetRelayDriver config)
const int TCP_PORT = 23;

// ── STATE MACHINE ────────────────────────────────────────────────────

// Relay states (independent per barrier)
enum RelayState {
  RELAY_IDLE,       // Relay OFF, waiting for command
  RELAY_ACTIVE,     // Relay ON, counting down auto-off timer
  RELAY_HELD_SAFE   // Relay ON, held because radar says OCCUPIED (exit only)
};

// Per-relay state tracking
struct RelayChannel {
  int           pin;
  RelayState    state;
  unsigned long activatedAt;  // millis() when relay was turned ON
};

RelayChannel entryRelay = { PIN_RELAY_ENTRY, RELAY_IDLE, 0 };
RelayChannel exitRelay  = { PIN_RELAY_EXIT,  RELAY_IDLE, 0 };

// Sensor state tracking (with debounce)
enum SensorState { SENSOR_CLEAR, SENSOR_OCCUPIED, SENSOR_UNKNOWN };
SensorState currentSensorState    = SENSOR_UNKNOWN;
SensorState lastReportedSensor    = SENSOR_UNKNOWN;
unsigned long lastSensorChangeAt  = 0;

// WiFi reconnect tracking
unsigned long lastWifiCheckAt     = 0;
unsigned long lastWifiBlink       = 0;

// TCP Keepalive
unsigned long lastKeepaliveAt     = 0;

// TCP Server & persistent client
WiFiServer server(TCP_PORT);
WiFiClient client;

// TCP receive buffer for stream reassembly
String recvBuffer = "";

// Connection lifecycle tracking
bool clientWasConnected = false;
unsigned long clientConnectedAt = 0;

// ── SETUP ────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== GarageIA Barrier Controller v3.0 ===");

  // Configure GPIO
  pinMode(PIN_RELAY_ENTRY,  OUTPUT);
  pinMode(PIN_RELAY_EXIT,   OUTPUT);
  pinMode(PIN_RADAR_SENSOR, INPUT_PULLDOWN); // Radar output: HIGH = presence
  pinMode(PIN_LED_WIFI,     OUTPUT);

  // Ensure relays start OFF (barrier arms DOWN)
  digitalWrite(PIN_RELAY_ENTRY, LOW);
  digitalWrite(PIN_RELAY_EXIT,  LOW);

  // Connect WiFi (non-blocking after initial connect)
  connectWiFi();

  // Start TCP server
  server.begin();
  Serial.printf(">> TCP Server listening on port %d\n", TCP_PORT);
  Serial.printf(">> IP: %s\n", WiFi.localIP().toString().c_str());
}

// ── MAIN LOOP (NON-BLOCKING) ────────────────────────────────────────

void loop() {
  unsigned long now = millis();

  // 1. WiFi health check (non-blocking reconnect)
  handleWiFi(now);

  // 2. Accept new TCP clients / read commands
  handleTCP(now);

  // 3. Read radar sensor with debounce
  handleSensor(now);

  // 4. Update relay state machines (auto-off + safety hold)
  handleRelays(now);

  // 5. TCP keepalive (heartbeat to prevent idle disconnect)
  handleKeepalive(now);
}

// ── WIFI MANAGEMENT (NON-BLOCKING) ──────────────────────────────────

void connectWiFi() {
  Serial.printf("Connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Initial blocking wait (only at boot, max ~10s)
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    // Blink LED while connecting
    if (millis() - lastWifiBlink >= WIFI_BLINK_MS) {
      digitalWrite(PIN_LED_WIFI, !digitalRead(PIN_LED_WIFI));
      lastWifiBlink = millis();
    }
    delay(10); // Minimal yield for WiFi stack — only during boot
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(PIN_LED_WIFI, HIGH);
    Serial.printf("\nWiFi OK! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    digitalWrite(PIN_LED_WIFI, LOW);
    Serial.println("\nWiFi FAILED (will retry in loop)");
  }
}

void handleWiFi(unsigned long now) {
  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(PIN_LED_WIFI, HIGH);
    return;
  }

  // Non-blocking reconnect attempt every WIFI_RECONNECT_MS
  if (now - lastWifiCheckAt >= WIFI_RECONNECT_MS) {
    lastWifiCheckAt = now;
    Serial.println("[WiFi] Disconnected — attempting reconnect...");
    WiFi.reconnect();

    // Blink LED to indicate reconnecting
    digitalWrite(PIN_LED_WIFI, !digitalRead(PIN_LED_WIFI));
  }
}

// ── TCP COMMAND HANDLING ────────────────────────────────────────────

void handleTCP(unsigned long now) {
  // ── ZOMBIE KILLER: Detect and reap stale/dead client ──
  // LwIP on ESP32 has very limited socket descriptors (~4-5).
  // If Node crashes or the WiFi drops, the old WiFiClient object
  // retains the descriptor even though the peer is gone.
  // We MUST explicitly stop() it to free the slot before accepting
  // a new connection. Without this, server.available() returns
  // nothing because all slots are exhausted ("Zombie Socket").
  if (client && !client.connected()) {
    if (clientWasConnected) {
      unsigned long uptime = (now - clientConnectedAt) / 1000;
      Serial.printf("[TCP] Client disconnected (was connected %lu sec) — cleaning up zombie socket\n", uptime);
    }
    client.flush();
    client.stop();
    clientWasConnected = false;
    recvBuffer = "";
  }

  // ── Accept new client if no active connection ──
  if (!client || !client.connected()) {
    WiFiClient newClient = server.available();
    if (newClient) {
      // Extra safety: if somehow we still have a lingering client, kill it
      if (client) {
        client.flush();
        client.stop();
      }
      client = newClient;
      clientWasConnected = true;
      clientConnectedAt = now;
      recvBuffer = "";
      Serial.printf(">> GarageIA Node Connected (IP: %s)\n", client.remoteIP().toString().c_str());
      client.println("HELLO:ESP32_BARRIER_V3");
      // NOTE: Do NOT return here — fall through to read any data
      // that arrived in the same TCP segment as the handshake.
      // This eliminates one-tick latency on first command.
    }
  }

  // ── Read available data into buffer ──
  if (!client || !client.connected()) return;

  while (client.available()) {
    char c = client.read();
    recvBuffer += c;

    // Guard against buffer overflow (malformed data)
    if (recvBuffer.length() > 256) {
      Serial.println("[TCP] Buffer overflow — flushing");
      recvBuffer = "";
      continue;
    }

    // Process complete messages (delimited by \n)
    int nlIdx = recvBuffer.indexOf('\n');
    while (nlIdx != -1) {
      String message = recvBuffer.substring(0, nlIdx);
      message.trim();
      recvBuffer = recvBuffer.substring(nlIdx + 1);

      if (message.length() > 0) {
        processCommand(message);
      }

      nlIdx = recvBuffer.indexOf('\n');
    }
  }
}

void processCommand(String cmd) {
  Serial.printf("[CMD] Received: \"%s\"\n", cmd.c_str());

  if (cmd == "OPEN:ENTRY") {
    activateRelay(entryRelay, "ENTRY");
    sendTCP("ACK:OPEN_ENTRY");
  }
  else if (cmd == "OPEN:EXIT") {
    activateRelay(exitRelay, "EXIT");
    sendTCP("ACK:OPEN_EXIT");
  }
  else {
    Serial.printf("[CMD] Unknown command: \"%s\"\n", cmd.c_str());
  }
}

// ── RELAY STATE MACHINE ─────────────────────────────────────────────

void activateRelay(RelayChannel &relay, const char* name) {
  digitalWrite(relay.pin, HIGH);
  relay.state = RELAY_ACTIVE;
  relay.activatedAt = millis();
  Serial.printf("[RELAY] %s → ON (pulse %lu ms)\n", name, RELAY_PULSE_MS);
}

void handleRelays(unsigned long now) {
  // ── ENTRY RELAY: Simple timed pulse (no safety override needed) ──
  if (entryRelay.state == RELAY_ACTIVE) {
    if (now - entryRelay.activatedAt >= RELAY_PULSE_MS) {
      digitalWrite(entryRelay.pin, LOW);
      entryRelay.state = RELAY_IDLE;
      Serial.println("[RELAY] ENTRY → OFF (auto-close)");
    }
  }

  // ── EXIT RELAY: Safety-critical — radar can HOLD it open ──
  if (exitRelay.state == RELAY_ACTIVE) {
    if (now - exitRelay.activatedAt >= RELAY_PULSE_MS) {
      // Time's up — but check radar before closing!
      if (currentSensorState == SENSOR_OCCUPIED) {
        // SAFETY OVERRIDE: Do NOT close barrier while vehicle is under it
        exitRelay.state = RELAY_HELD_SAFE;
        Serial.println("[SAFETY] EXIT auto-close BLOCKED — radar OCCUPIED");
      } else {
        // Clear to close
        digitalWrite(exitRelay.pin, LOW);
        exitRelay.state = RELAY_IDLE;
        Serial.println("[RELAY] EXIT → OFF (auto-close)");
      }
    }
  }
  else if (exitRelay.state == RELAY_HELD_SAFE) {
    // Waiting for radar to clear before allowing barrier to close
    if (currentSensorState != SENSOR_OCCUPIED) {
      digitalWrite(exitRelay.pin, LOW);
      exitRelay.state = RELAY_IDLE;
      Serial.println("[SAFETY] Radar CLEAR — EXIT relay released → OFF");
    }
    // else: keep relay HIGH (barrier arm stays UP) — life-safety invariant
  }
}

// ── RADAR SENSOR (DEBOUNCED) ────────────────────────────────────────

void handleSensor(unsigned long now) {
  // Read raw digital pin (HIGH = object detected by LD2450)
  int rawReading = digitalRead(PIN_RADAR_SENSOR);
  SensorState reading = (rawReading == HIGH) ? SENSOR_OCCUPIED : SENSOR_CLEAR;

  // Debounce: only accept state change after SENSOR_DEBOUNCE_MS stability
  if (reading != currentSensorState) {
    if (now - lastSensorChangeAt >= SENSOR_DEBOUNCE_MS) {
      currentSensorState = reading;
      lastSensorChangeAt = now;

      Serial.printf("[SENSOR] State → %s\n",
        currentSensorState == SENSOR_OCCUPIED ? "OCCUPIED" : "CLEAR");

      // Send telemetry to Node server (only on actual change)
      if (currentSensorState != lastReportedSensor) {
        lastReportedSensor = currentSensorState;
        if (currentSensorState == SENSOR_OCCUPIED) {
          sendTCP("SENSOR:OCCUPIED");
        } else {
          sendTCP("SENSOR:CLEAR");
        }
      }
    }
  } else {
    // Reset debounce timer when reading is stable
    lastSensorChangeAt = now;
  }
}

// ── TCP SEND HELPER ─────────────────────────────────────────────────

void sendTCP(const char* message) {
  if (client && client.connected()) {
    client.println(message); // println adds \n delimiter
    Serial.printf("[TCP TX] %s\n", message);
  } else {
    Serial.printf("[TCP TX] DROPPED (no client): %s\n", message);
  }
}

// ── KEEPALIVE ───────────────────────────────────────────────────────

void handleKeepalive(unsigned long now) {
  if (now - lastKeepaliveAt >= TCP_KEEPALIVE_MS) {
    lastKeepaliveAt = now;
    if (client && client.connected()) {
      client.println("HEARTBEAT");
    }
  }
}