#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include "HX711.h"
#include <math.h>

// =====================
// WiFi Credentials
// =====================
const char* ssid = "Andrew";
const char* password = "lifeasweknowit";

// =====================
// Server
// =====================
const char* SERVER_URL = "https://smartwalker-back.onrender.com/api/walker";

// =====================
// Timing
// =====================
const unsigned long SAMPLE_INTERVAL_MS = 200;
unsigned long lastSample = 0;

const unsigned long POST_INTERVAL_MS = 1000;   // HTTPS: 1s is reasonable
unsigned long lastPost = 0;

// =====================
// Device identity
// =====================
const char* RESIDENT_ID = "r1";
const char* DEVICE_ID   = "esp32_s3_01";

// =====================
// HX711 pins/config (TWO AMPLIFIERS)
// =====================
// Amplifier 1 (Load cell 1 / LEFT)
#define HX1_DOUT 17
#define HX1_SCK  18

// Amplifier 2 (Load cell 2 / RIGHT)
#define HX2_DOUT 8
#define HX2_SCK  9

HX711 hxLeft;   // amplifier 1
HX711 hxRight;  // amplifier 2

// =====================
// Calibration (per amplifier)
// =====================
float SCALE_LEFT_COUNTS_PER_KG  = 40000.0f; // placeholder
float SCALE_RIGHT_COUNTS_PER_KG = 40000.0f; // placeholder

long offsetLeft = 0;
long offsetRight = 0;

// =====================
// State (internal float kg)
// =====================
float fsrLeftKg  = 0.0f;
float fsrRightKg = 0.0f;

// IMU placeholders (always 0 per your request)
float tiltDeg = 0.0f;
int steps = 0;

// =====================
// State to POST (integers, rounded kg)
// =====================
int fsrLeft_kgInt  = 0;
int fsrRight_kgInt = 0;

// ---------- WiFi ----------
void connectToWiFiOnce() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_OFF);
  delay(300);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);

  Serial.println("Connecting to WiFi...");
  WiFi.begin(ssid, password);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("✓ Connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("✗ Failed to connect.");
  }
}

bool ensureWiFi(unsigned long timeoutMs = 5000) {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.println("WiFi disconnected, reconnecting...");
  WiFi.reconnect();

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(200);
    Serial.print(".");
  }
  Serial.println();

  return WiFi.status() == WL_CONNECTED;
}

// ========== HX711 helpers ==========
static inline long readHXAvg(HX711 &hx, int samples) {
  unsigned long start = millis();
  while (!hx.is_ready()) {
    if (millis() - start > 250) return 0; // timeout → treat as 0
    delay(1);
  }
  return hx.read_average(samples);
}

static inline float rawToKg(long raw, long offset, float scaleCountsPerKg) {
  return (float)(raw - offset) / scaleCountsPerKg;
}

// ========== Convert kg -> integer kilograms (rounded) ==========
static inline int kgToKgInt(float kg) {
  if (kg < 0.0f) kg = 0.0f;
  long k = lroundf(kg);
  if (k < 0) k = 0;
  if (k > 2147483647L) k = 2147483647L;
  return (int)k;
}

// ========== POST ==========
void sendData() {
  if (!ensureWiFi()) {
    Serial.println("POST skipped: no WiFi");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  if (!http.begin(client, SERVER_URL)) {
    Serial.println("http.begin failed");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  unsigned long ts = millis() / 1000;

  // IMU data forced to 0
  tiltDeg = 0.0f;
  steps = 0;

  String json;
  json.reserve(256);
  json =
    String("{") +
    "\"residentId\":\"" + RESIDENT_ID + "\"," +
    "\"deviceId\":\"" + DEVICE_ID + "\"," +
    "\"ts\":" + String(ts) + "," +
    "\"fsrLeft\":" + String(fsrLeft_kgInt) + "," +
    "\"fsrRight\":" + String(fsrRight_kgInt) + "," +
    "\"tiltDeg\":0," +
    "\"steps\":0" +
    "}";

  int code = http.POST(json);

  Serial.print("POST "); Serial.print(code);
  Serial.print("  L="); Serial.print(fsrLeft_kgInt);  Serial.print("kg");
  Serial.print("  R="); Serial.print(fsrRight_kgInt); Serial.print("kg");
  Serial.println("  (IMU=0)");

  if (code != 200) {
    Serial.println("Payload:");
    Serial.println(json);
    Serial.println("Server response:");
    Serial.println(http.getString());
  }

  http.end();
}

// =====================
// Setup
// =====================
void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\nBOOT");

  connectToWiFiOnce();

  // Init both HX711 amps (each uses channel A / gain 128)
  hxLeft.begin(HX1_DOUT, HX1_SCK);
  hxLeft.set_gain(128);

  hxRight.begin(HX2_DOUT, HX2_SCK);
  hxRight.set_gain(128);

  delay(300);

  // TARE both (no load!)
  Serial.println("Taring... (make sure NO load on either side)");
  offsetLeft  = readHXAvg(hxLeft, 25);
  offsetRight = readHXAvg(hxRight, 25);

  Serial.print("offsetLeft=");  Serial.println(offsetLeft);
  Serial.print("offsetRight="); Serial.println(offsetRight);

  Serial.println("Running...");
}

// =====================
// Loop
// =====================
void loop() {
  unsigned long now = millis();

  if (now - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = now;

    // HX711 raw (each amp separately)
    long rawLeft  = readHXAvg(hxLeft, 8);
    long rawRight = readHXAvg(hxRight, 8);

    // Convert to kg floats (internal)
    fsrLeftKg  = rawToKg(rawLeft,  offsetLeft,  SCALE_LEFT_COUNTS_PER_KG);
    fsrRightKg = rawToKg(rawRight, offsetRight, SCALE_RIGHT_COUNTS_PER_KG);

    // Deadband around zero (10g)
    if (fabsf(fsrLeftKg)  < 0.01f) fsrLeftKg = 0.0f;
    if (fabsf(fsrRightKg) < 0.01f) fsrRightKg = 0.0f;

    // Convert to integer KG for backend (rounded)
    fsrLeft_kgInt  = kgToKgInt(fsrLeftKg);
    fsrRight_kgInt = kgToKgInt(fsrRightKg);
  }

  if (now - lastPost >= POST_INTERVAL_MS) {
    lastPost = now;
    sendData();
  }
}
