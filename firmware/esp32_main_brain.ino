#include <Arduino.h>
#include <WiFi.h>

// ── NETWORK CONFIGURATION ──
const char* ssid = "MONTEGROSSO2.4G";
const char* password = "Pacheco1581";

WiFiServer server(23); // Servidor TCP en el puerto 23
WiFiClient client;

// ── PINOUT CONFIGURATION ──
const int PIN_BUTTON       = 4;   // Simular botón de emisión de ticket (Input Pullup)
const int PIN_BEAM_SENSOR  = 5;   // Sensor fotoeléctrico anti-aplastamiento (Input Pullup/Pulldown)

const int PIN_RELAY_UP     = 18;  // Relé comando SUBIDA (Barrera)
const int PIN_RELAY_STOP   = 19;  // Relé comando PARADA (Barrera)
const int PIN_RELAY_DOWN   = 21;  // Relé comando BAJADA (Barrera)

// ── TIMING CONFIGURATION ──
const unsigned long PULSE_DURATION       = 500;   // Duración del pulso para los relés (ms)
const unsigned long BARRIER_CLOSE_DELAY  = 4000;  // Tiempo de espera para cerrar tras paso del vehículo (4s)
const unsigned long DEBOUNCE_DELAY       = 50;    // Filtro de ruido para entradas físicas (ms)

// ── STATE MACHINE FOR VEHICLE PASSAGE ──
enum BarrierState {
  BARRIER_CLOSED,
  BARRIER_OPENING,
  BARRIER_WAITING_VEHICLE, // Barrera abierta, esperando que el auto interrumpa el sensor
  BARRIER_VEHICLE_INSIDE,  // El auto está interrumpiendo el haz del sensor
  BARRIER_CLOSING
};

BarrierState currentBarrierState = BARRIER_CLOSED;

// Variables de control de tiempo
unsigned long relayUpTimer = 0;
unsigned long relayDownTimer = 0;
unsigned long barrierCloseTimer = 0;

// Variables de debouncing
int lastButtonState = HIGH;
int buttonState = HIGH;
unsigned long lastButtonDebounceTime = 0;

int lastSensorState = HIGH;
int sensorState = HIGH;
unsigned long lastSensorDebounceTime = 0;

void setup() {
  Serial.begin(115200);

  // Configuración de Entradas con Pullup interno
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BEAM_SENSOR, INPUT_PULLUP);

  // Configuración de Salidas (Relés)
  pinMode(PIN_RELAY_UP, OUTPUT);
  pinMode(PIN_RELAY_STOP, OUTPUT);
  pinMode(PIN_RELAY_DOWN, OUTPUT);
  
  digitalWrite(PIN_RELAY_UP, HIGH);
  digitalWrite(PIN_RELAY_STOP, HIGH);
  digitalWrite(PIN_RELAY_DOWN, HIGH);

  // Conexión Wi-Fi
  Serial.print("Conectando a Wi-Fi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("\nWiFi conectado exitosamente!");
  Serial.print("Direccion IP del ESP32: ");
  Serial.println(WiFi.localIP());

  // Iniciar servidor TCP
  server.begin();
  Serial.println("Servidor TCP iniciado en puerto 23.");
  Serial.println("{\"status\":\"BOOT_OK\",\"msg\":\"ESP32 Network Brain Initialized\"}");
}

// Envía eventos JSON tanto por Serial local (para debug) como por Red (a Electron)
void sendJsonEvent(String eventType, String payload) {
  String msg = "{\"event\":\"" + eventType + "\",\"payload\":\"" + payload + "\"}";
  
  // Debug local por cable
  Serial.println(msg); 
  
  // Envío por red a la app de Electron
  if (client && client.connected()) {
    client.println(msg);
  }
}

void triggerRelayUp() {
  digitalWrite(PIN_RELAY_UP, LOW); 
  relayUpTimer = millis();
  currentBarrierState = BARRIER_OPENING;
  sendJsonEvent("BARRIER_STATE", "OPENING");
}

void triggerRelayDown() {
  digitalWrite(PIN_RELAY_DOWN, LOW); 
  relayDownTimer = millis();
  currentBarrierState = BARRIER_CLOSING;
  sendJsonEvent("BARRIER_STATE", "CLOSING");
}

void handleCommand(String incomingData) {
  if (incomingData.indexOf("OPEN_BARRIER") >= 0) {
    if (currentBarrierState == BARRIER_CLOSED || currentBarrierState == BARRIER_CLOSING) {
      triggerRelayUp();
    }
  } 
  else if (incomingData.indexOf("CLOSE_BARRIER") >= 0) {
    if (currentBarrierState == BARRIER_WAITING_VEHICLE) {
      triggerRelayDown();
    }
  }
  else if (incomingData.indexOf("STOP_BARRIER") >= 0) {
    digitalWrite(PIN_RELAY_STOP, LOW);
    delay(200);
    digitalWrite(PIN_RELAY_STOP, HIGH);
    sendJsonEvent("BARRIER_STATE", "STOPPED");
  }
}

void processIncomingCommands() {
  // Manejo de conexiones de red entrantes
  if (server.hasClient()) {
    if (!client || !client.connected()) {
      if (client) client.stop();
      client = server.available();
      Serial.println("App Electron (Cliente) conectada por red.");
    } else {
      // Si ya hay alguien conectado, rechazar nuevas conexiones
      WiFiClient extraClient = server.available();
      extraClient.stop();
    }
  }

  // Leer comandos recibidos por Wi-Fi
  if (client && client.connected() && client.available() > 0) {
    String incomingData = client.readStringUntil('\n');
    incomingData.trim();
    if (incomingData.length() > 0) {
      handleCommand(incomingData);
    }
  }

  // Leer comandos recibidos por el cable USB (útil para pruebas)
  if (Serial.available() > 0) {
    String incomingData = Serial.readStringUntil('\n');
    incomingData.trim();
    if (incomingData.length() > 0) {
      handleCommand(incomingData);
    }
  }
}

void handleHardwareInputs() {
  unsigned long currentMillis = millis();

  // 1. LÓGICA DEL BOTÓN DE ENTRADA
  int readingButton = digitalRead(PIN_BUTTON);
  if (readingButton != lastButtonState) {
    lastButtonDebounceTime = currentMillis;
  }
  if ((currentMillis - lastButtonDebounceTime) > DEBOUNCE_DELAY) {
    if (readingButton != buttonState) {
      buttonState = readingButton;
      if (buttonState == LOW) { 
        sendJsonEvent("BUTTON_PRESSED", "ENTRY_STATION");
      }
    }
  }
  lastButtonState = readingButton;

  // 2. LÓGICA DEL SENSOR FOTOELÉCTRICO
  int readingSensor = digitalRead(PIN_BEAM_SENSOR);
  if (readingSensor != lastSensorState) {
    lastSensorDebounceTime = currentMillis;
  }
  if ((currentMillis - lastSensorDebounceTime) > DEBOUNCE_DELAY) {
    if (readingSensor != sensorState) {
      sensorState = readingSensor;
      if (sensorState == LOW) { 
        sendJsonEvent("SENSOR_STATE", "OCCUPIED");
        if (currentBarrierState == BARRIER_WAITING_VEHICLE || currentBarrierState == BARRIER_OPENING) {
          currentBarrierState = BARRIER_VEHICLE_INSIDE;
        }
      } else { 
        sendJsonEvent("SENSOR_STATE", "CLEAR");
        if (currentBarrierState == BARRIER_VEHICLE_INSIDE) {
          barrierCloseTimer = millis(); 
          currentBarrierState = BARRIER_WAITING_VEHICLE; 
        }
      }
    }
  }
  lastSensorState = readingSensor;
}

void manageTimersAndState() {
  unsigned long currentMillis = millis();

  if (digitalRead(PIN_RELAY_UP) == LOW && (currentMillis - relayUpTimer >= PULSE_DURATION)) {
    digitalWrite(PIN_RELAY_UP, HIGH);
    if (currentBarrierState == BARRIER_OPENING) {
      currentBarrierState = BARRIER_WAITING_VEHICLE;
      sendJsonEvent("BARRIER_STATE", "OPEN");
    }
  }

  if (digitalRead(PIN_RELAY_DOWN) == LOW && (currentMillis - relayDownTimer >= PULSE_DURATION)) {
    digitalWrite(PIN_RELAY_DOWN, HIGH);
    if (currentBarrierState == BARRIER_CLOSING) {
      currentBarrierState = BARRIER_CLOSED;
      sendJsonEvent("BARRIER_STATE", "CLOSED");
    }
  }

  if (currentBarrierState == BARRIER_WAITING_VEHICLE && digitalRead(PIN_BEAM_SENSOR) == HIGH) {
    if (currentMillis - barrierCloseTimer >= BARRIER_CLOSE_DELAY) {
      triggerRelayDown();
    }
  }
}

void loop() {
  processIncomingCommands();
  handleHardwareInputs();
  manageTimersAndState();
}