#include <WiFi.h>

// --- CONFIGURACIÓN DE RED ---
const char* ssid = "MONTEGROSSO2.4G";
const char* password = "Pacheco1581";

// --- PINES DE HARDWARE ---
const int PIN_RELAY_ENTRADA = 12; 
const int PIN_RELAY_SALIDA  = 13;
const int PIN_LED_WIFI      = 2;

WiFiServer server(23);

void setup() {
  Serial.begin(115200);
  
  // Configurar pines
  pinMode(PIN_RELAY_ENTRADA, OUTPUT);
  pinMode(PIN_RELAY_SALIDA, OUTPUT);
  pinMode(PIN_LED_WIFI, OUTPUT);
  
  // Asegurar que arranquen apagados
  digitalWrite(PIN_RELAY_ENTRADA, LOW);
  digitalWrite(PIN_RELAY_SALIDA, LOW);

  conectarWiFi();
  server.begin();
  Serial.println(">> SERVIDOR BARRERAS LISTO (Puerto 23)");
}

void conectarWiFi() {
  Serial.print("Conectando a "); Serial.println(ssid);
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    digitalWrite(PIN_LED_WIFI, !digitalRead(PIN_LED_WIFI)); // Titila mientras conecta
    delay(500);
    Serial.print(".");
  }
  
  digitalWrite(PIN_LED_WIFI, HIGH); // Luz fija = WiFi OK
  Serial.println("\n¡CONEXIÓN EXITOSA!");
  Serial.print("IP: "); Serial.println(WiFi.localIP());
}

void loop() {
  // Si se desconecta el WiFi, intentar reconectar
  if (WiFi.status() != WL_CONNECTED) { conectarWiFi(); }

  WiFiClient client = server.available();

  if (client) {
    Serial.println(">> App GarageIA Conectada.");
    while (client.connected()) {
      if (client.available()) {
        String request = client.readStringUntil('\n');
        request.trim();

        if (request == "OPEN:ENTRY") {
           Serial.println("COMANDO: ABRIENDO ENTRADA (Pin 12)");
           digitalWrite(PIN_RELAY_ENTRADA, HIGH); 
           delay(1000); // Mantenemos el relé pegado 1 seg
           digitalWrite(PIN_RELAY_ENTRADA, LOW);
           client.println("OK");
        } 
        else if (request == "OPEN:EXIT") {
           Serial.println("COMANDO: ABRIENDO SALIDA (Pin 13)");
           digitalWrite(PIN_RELAY_SALIDA, HIGH); 
           delay(1000);
           digitalWrite(PIN_RELAY_SALIDA, LOW);
           client.println("OK");
        }
      }
    }
    Serial.println(">> App Desconectada.");
  }
}