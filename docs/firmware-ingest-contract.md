# Firmware Ingest Contract

The single endpoint all LoRa sensors send data to — registered or not, any category.

MajiScope supports two sensor categories:

| Category | `category` value | Measures |
|----------|------------------|----------|
| Water Level | `water_level` | Depth of water below the sensor (one value per reading) |
| Water Quality | `water_quality` | Multi-parameter sonde (temperature, pH, EC, DO, turbidity, and optional probes) |

**Firmware does not need to know its category.** The category is assigned when the sensor is *registered* in MajiScope. The same device sends to the same endpoint with the same envelope; the server parses the payload according to the registered category. Before registration, any recognizable payload (level depth *or* quality parameters) is accepted and buffered.

---

## Device ID Naming Convention

**All new sensors — both categories — follow this standard naming scheme.**

A well-named device ID tells you *where* the sensor is without looking it up.

### Format

```
{UTILITY}_{DMA}_{SEQ}
```

| Part | Rule | Example |
|------|------|---------|
| `UTILITY` | First 2–3 uppercase letters of the utility name | `AU` (AUWSA), `DA` (DAWASCO), `MU` (MUWASA), `JKA` (JKT–AUWSA?) |
| `DMA` | First 2–3 uppercase letters of the DMA / area name | `NAM` (Nambala), `KIN` (Kinondoni), `NHW` (NHW) |
| `SEQ` | 2 or 4 digit zero-padded sequential number | `01`, `0001`, `0042` |

**Separator:** underscore `_` between each part.

### Examples

| Utility | DMA | Seq | Device ID |
|---------|-----|-----|-----------|
| AUWSA | Nambala | 1 | `AU_NAM_0001` |
| AUWSA | Nambala | 42 | `AU_NAM_0042` |
| DAWASCO | Kinondoni | 7 | `DA_KIN_0007` |
| JKT | NHW | 3 | `JKA_NHW_003` |
| KIGOMA UDC | Kigoma | 3 | `KIG_KIG_0003` |

### Category in the device ID?

No. Both water-level and water-quality sensors on the **same tank** use the same utility/DMA prefix and independent sequences:

| Tank | Sensor | Device ID |
|------|--------|-----------|
| Nambala #1 | Water level | `AU_NAM_0001` |
| Nambala #1 | Water quality | `AU_NAM_0002` |

The next sequence number is simply the next sensor in that DMA — regardless of category.

### Why This Matters

- **Field debugging:** A technician seeing `AU_NAM_0042` on a device knows it's AUWSA utility, Nambala DMA, sensor #42 — without any screen or database lookup.
- **Sorting:** Sensors sort naturally by utility, then DMA, then sequence in lists and logs.
- **Deduplication:** The combination of utility + DMA + sequence is unique across the entire deployment.
- **LoRa-friendly:** `AU_NAM_0001` is only 15 characters — well within packet size limits.

### Rules

1. **Always uppercase** the utility and DMA abbreviations.
2. **Always zero-pad** the sequence number to 4 digits (preferred) or 2 digits (if space is tight).
3. **Use underscores**, not dashes or dots — underscores survive LoRa corruption better and sort correctly.
4. **Never reuse** a device ID. If a sensor is decommissioned, the next one gets the next sequence number.
5. **Register the device ID in MajiScope** (with its category) before field deployment so pending readings are immediately promoted.

---

## Endpoint

```
POST /api/sensors/ingest
```

**This is the only endpoint firmware needs.** It works whether the sensor is registered in MajiScope or not, and for both categories.

## Authentication

| Header | Value |
|--------|-------|
| `X-Ingest-Key` | The shared secret configured as `SENSOR_INGEST_KEY` on the server |

Or a valid Bearer token (for authenticated clients).

---

## Request Body (shared envelope)

### Required

| Field | Type | Description |
|-------|------|-------------|
| `device_id` | string | Unique sensor identifier following the [naming convention](#device-id-naming-convention) (e.g. `AU_NAM_0001`). **Must be present and non-empty.** |
| `occurred_at` | string | *(optional)* Timestamp of the measurement. Falls back to server receive-time (UTC) if absent. See [Timestamp Formats](#timestamp-formats). |

### Optional (category-specific data)

| Field | Type | Used by | Description |
|-------|------|---------|-------------|
| `raw_data` | string | both | Comma-separated `Key=Value` string, parsed as fallback. See [raw_data](#raw_data-strings) below. |
| `properties` | object | both | Nested key–value dict (legacy envelope). Flat top-level fields are preferred. |
| depth fields | float | water level | `depth_m`, `Depth`, `depth`, `H2`, `h2`, `Depth_mm`, `depth_mm` |
| `h1_m` | float | water level | Sensor hanging length override (rare — see [Registration](#registration)) |
| quality fields | float | water quality | Any of the parameters listed in [Water-Quality Parameters](#water-quality-parameters) |

Unknown/extra fields are accepted and preserved when the reading is buffered as pending, so vendor-specific telemetry (battery voltage, RSSI, etc.) can be included freely.

### Unregistered devices (strict validation)

When the device is **not yet registered** in MajiScope, the server stores the reading as **pending** and requires at least one recognizable value:

- **Water-level payload:** a resolvable depth (flat field, mm field, nested, or `raw_data`)
- **Water-quality payload:** at least one in-range quality parameter

If `device_id` is missing → **422 rejected**. If present but **nothing** in the payload is recognizable → **422 rejected** with an explanatory message. The pending buffer keeps the *verbatim* raw payload, so when the device is later registered (with its category chosen), the buffered messages are parsed correctly at that moment.

### Registered devices (tolerant parsing)

Once the sensor is registered, the server parses according to the registered **category**:

- **Water level:** tolerant defaults — `h1_m` from registration, `depth_m` default from registration if parsing fails, `raw_data` fallback.
- **Water quality:** alias-matched parameters (see table below); out-of-range values are **dropped** (treated as absent); a reading with zero recognized parameters → **422**.

---

## Water-Quality Parameters

The server recognizes these canonical fields. Firmware may send either the canonical name **or** any listed alias — case-insensitive. Aliases cover common vendor spellings.

### Tier A — core sonde parameters (recommended on every WQ device)

| Canonical field | Aliases | Unit | Sanity range | Notes |
|-----------------|---------|------|--------------|-------|
| `temperature_c` | `Temperature`, `temp`, `Temp`, `WaterTemp`, `water_temperature` | °C | −5 … 50 | Always present on real sondes |
| `ph` | `pH`, `PH` | pH | 0 … 14 | — |
| `ec_uscm` | `EC`, `Conductivity`, `conductivity`, `specific_cond`, `SPCond`, `ec` | µS/cm | 0 … 200 000 | Specific conductance at 25 °C |
| `do_mgl` | `DO`, `DissolvedOxygen`, `do`, `oxygen_mgl` | mg/L | 0 … 20 | Dissolved oxygen concentration |
| `do_pct_sat` | `DO_pct`, `do_pct`, `saturation_pct` | % | 0 … 200 | DO % saturation (send if the probe reports it) |
| `turbidity_ntu` | `Turbidity`, `Turb`, `turbidity`, `NTU` | NTU | 0 … 4 000 | NTU/FNU treated as equivalent |

### Tier B/C — optional fitted probes (send only what the device carries)

| Canonical field | Aliases | Unit | Sanity range |
|-----------------|---------|------|--------------|
| `orp_mv` | `ORP`, `Redox`, `orp` | mV | −2000 … 2000 |
| `free_chlorine_mgl` | `FreeCl`, `free_cl`, `Chlorine`, `chlorine_mgl` | mg/L | 0 … 20 |
| `nitrate_mgl` | `Nitrate`, `NO3`, `no3` | mg/L | 0 … 500 |
| `ammonia_mgl` | `Ammonia`, `NH3`, `nh3`, `nh4` | mg/L | 0 … 500 |
| `phosphate_mgl` | `Phosphate`, `PO4`, `po4` | mg/L | 0 … 500 |
| `chlorophyll_ugl` | `Chlorophyll`, `chla`, `chlorophyll_a` | µg/L | 0 … 1000 |
| `phycocyanin_ugl` | `Phycocyanin`, `pc_ugl` | µg/L | 0 … 1000 |

### Physical sanity

Values outside the sanity range are silently **dropped** (recorded as absent for that reading, not stored as garbage). This protects dashboards from misconfigured firmware (e.g. `pH=23`).

---

## Behaviour

| Device registered? | Behaviour |
|--------------------|-----------|
| **Yes** | Reading is parsed per the registered **category** and stored as a real reading with computed status and full scope (utility/dma/tank). Returns `is_pending: false`. Response shape depends on category (below). |
| **No** | Reading is stored in a **pending buffer** by `device_id`, verbatim. Returns `is_pending: true`. When the sensor is later registered (category chosen at that moment), all pending readings are **automatically parsed and promoted** to real readings. Returns `is_duplicate: true` on retry. |

**One active sensor per category per tank.** A tank can carry one active water-level sensor *and* one active water-quality sensor, but never two of the same category. Firmware doesn't enforce this — it's a registration-time rule — but integrators should plan device deployment accordingly.

### Idempotency

Readings are deduplicated on `(device_id, occurred_at)`. Retries return the existing result without creating duplicate rows.

---

## Response: Registered Water-Level Device (200)

```json
{
  "ok": true,
  "category": "water_level",
  "reading_id": "abc-123",
  "sensor_id": "def-456",
  "tank_id": "ghi-789",
  "utility_id": "jkl-012",
  "dma_id": "mno-345",
  "water_level_m": 10.261,
  "h1_m": 12.0,
  "depth_m": 1.739,
  "status": "active",
  "occurred_at": "2026-09-02T15:10:00Z",
  "is_duplicate": false
}
```

## Response: Registered Water-Quality Device (200)

```json
{
  "ok": true,
  "category": "water_quality",
  "reading_id": "3d739f71-1d65-46a4-8cfb-90c6222d61e3",
  "sensor_id": "6488b926-fd9b-4d81-9f3e-554820c73c9c",
  "tank_id": "ca4a5ff4-9cd2-4796-b0b7-0c83da481fed",
  "utility_id": "d15ef11e-0aee-489d-95c7-67c3223aa90c",
  "dma_id": null,
  "status": "active",
  "parameters": {
    "temperature_c": 21.4,
    "ph": 7.2,
    "ec_uscm": 480.0,
    "do_mgl": 6.4,
    "turbidity_ntu": 3.1,
    "free_chlorine_mgl": 0.8,
    "nitrate_mgl": 8.5
  },
  "occurred_at": "2026-09-02T15:10:00Z",
  "is_duplicate": false
}
```

`parameters` contains only the values recognized in that reading — absent probes are simply not in the object.

## Response: Unregistered Device — Pending (200, both categories)

```json
{
  "ok": true,
  "is_pending": true,
  "reading_id": "buf-789",
  "device_id": "AU_NAM_0001",
  "occurred_at": "2026-09-02T15:00:00Z",
  "dedup_key": "AU_NAM_0001:2026-09-02T15:00:00",
  "is_duplicate": false
}
```

The pending reading is stored and will be **automatically promoted** to a real tank reading when the sensor is registered via `POST /api/sensors`.

---

## Error Responses

| Status | Meaning |
|--------|---------|
| 422 | `device_id` missing, or no recognizable value in the payload (no depth for a level-style payload, no quality parameter for a quality-style payload) |
| 401 | Missing or invalid `X-Ingest-Key` / Bearer token |

---

## Registration

Before or after sending data, sensors are registered in MajiScope **with a category**:

```
POST /api/sensors
```

**Water level:**

```json
{
  "device_id": "AU_NAM_0001",
  "tank_id": "<tank-uuid-from-majiscope>",
  "category": "water_level",
  "h1_m": 12.0,
  "activated": true
}
```

**Water quality:**

```json
{
  "device_id": "AU_NAM_0002",
  "tank_id": "<tank-uuid-from-majiscope>",
  "category": "water_quality",
  "activated": true
}
```

On registration, any pending readings for `device_id` are **automatically parsed and promoted** according to the chosen category. The response includes `promoted_readings` showing how many historical readings were attached.

```json
{
  "id": "...",
  "device_id": "AU_NAM_0002",
  "category": "water_quality",
  "tank_id": "...",
  "config": { "parameters": { } },
  "promoted_readings": 147,
  ...
}
```

Notes:

- `category` is required for clarity in new registrations (defaults to `water_level` if omitted).
- **Water level:** `h1_m` is the cable/sensor hanging length in metres, set once at install time. `water_level_m = h1_m - depth_m`. Firmware should **not** send `h1_m` per reading.
- **Water quality:** optional `parameter_thresholds` can be supplied at registration to override the default warning/critical bounds per parameter (e.g. tighten the pH band for a specific tank). Otherwise conservative defaults apply.
- A tank cannot have **two active sensors of the same category** — the server rejects it (409).

---

## Depth Extraction Precedence (water level)

1. Flat top-level: `depth_m` → `Depth` → `depth` → `H2` → `h2`
2. Flat millimetre: `Depth_mm` → `depth_mm` (÷ 1000)
3. Nested `properties` dict: same key order
4. Nested `properties` mm: same key order
5. `raw_data` string regex: `Depth=X` or `D=X` or fallback `Nm` token
6. Registered default depth (registered devices only)

### Physical Sanity

Depth > 20 m is rejected (falls back to the registered default for registered devices; 422 for unregistered).

---

## Water-Quality Extraction Precedence

1. Flat top-level fields — canonical name or alias, case-insensitive
2. Nested `properties` dict — same matching
3. `raw_data` string — `Key=Value` / `Key: Value` pairs, alias-matched

Out-of-range values are dropped at every step (see [Physical sanity](#physical-sanity)).

---

## raw_data Strings

Both categories accept a `raw_data` string as a fallback for devices that only emit serial/NMEA-style lines:

**Water level:**
```
Voltage=676mV, Current=5.63mA, Depth=0.510m
```

**Water quality:**
```
Temp=21.9, pH=7.05, EC=505, Turb=2.8, DO=6.1
```

The parser scans `Key=Value` / `Key: Value` pairs and alias-matches keys. Flat JSON fields are **preferred** for new firmware — `raw_data` is backward compatibility only.

---

## Timestamp Formats

| Format | Example | Recommended |
|--------|---------|-------------|
| ISO 8601 UTC (`Z`) | `2026-09-02T15:10:00Z` | ✅ **Preferred** — explicit UTC, no ambiguity |
| ISO 8601 with offset | `2026-09-02T18:10:00+03:00` | ✅ Accepted — converted to UTC server-side |
| Plain ISO 8601 (no zone) | `2026-09-02T15:10:00` | ✅ Accepted — **interpreted as UTC** |
| Underscore | `2026-09-02_15-10-00` | ✅ Accepted |
| Epoch ms | `1734239400000` | ✅ Accepted (13 digits, UTC) |

**Recommendation for LoRa:** use ISO 8601 with `Z` (`YYYY-MM-DDThh:mm:ssZ` — 20 characters). All server timestamps are stored in UTC and converted to local time (EAT) only for display, so as long as the device clock is correct the reading will display the correct local time.

---

## Firmware Alignment Checklist

### Both categories

- [ ] **Device ID follows the naming convention** — `{UTILITY}_{DMA}_{SEQ}` (e.g. `JKA_NHW_003`)
- [ ] Send to **only** `POST /api/sensors/ingest` — works for registered and unregistered devices
- [ ] Always include `device_id` (non-empty)
- [ ] Include `occurred_at` (ISO 8601 with `Z`) whenever the payload budget allows
- [ ] Do **not** send `latitude` or `longitude` — sensor position is the tank's coordinates in MajiScope
- [ ] Test with the actual LoRa modem before field deployment — verify the packet arrives intact

### Water level

- [ ] Always include a depth value (`depth_m` preferred)
- [ ] Do not send `h1_m` per reading — it is set at registration

### Water quality

- [ ] Send every parameter the probe carries, using canonical names or aliases (Tier A recommended: temperature, pH, EC, DO, turbidity)
- [ ] Do not invent values for probes the device does not carry — absent parameters are fine
- [ ] Values are sanity-checked; impossible values (e.g. `pH=23`) are silently dropped

### LoRa size budget

| Payload | Typical size |
|---------|--------------|
| Water level (minimal) | ~70 bytes |
| Water quality (Tier A, 5 params) | ~120 bytes |
| Water quality (all params) | ~200 bytes |

Multi-parameter payloads may exceed a single LoRa frame's reliable size — if your modem enforces a hard limit, either (a) split the parameters across alternating transmissions with distinct `occurred_at`, or (b) send a compact subset per interval. Consult your gateway integrator; do not truncate JSON mid-object.

---

## Example: Minimal Water-Level Payload

```json
{"device_id":"AU_NAM_0001","depth_m":1.739,"occurred_at":"2026-09-02T15:10:00Z"}
```

**Total: ~70 bytes** — well within LoRa's reliable range.

## Example: Water-Quality Payload (Tier A + chlorine)

```json
{
  "device_id": "AU_NAM_0002",
  "temperature_c": 21.4,
  "ph": 7.2,
  "ec_uscm": 480.0,
  "do_mgl": 6.4,
  "turbidity_ntu": 3.1,
  "free_chlorine_mgl": 0.8,
  "occurred_at": "2026-09-02T15:10:00Z"
}
```

## Example: cURL

```bash
# Water level
curl -X POST https://majiscope.example.com/api/sensors/ingest \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Key: your-secret-key" \
  -d '{
    "device_id": "AU_NAM_0001",
    "depth_m": 1.739,
    "occurred_at": "2026-09-02T15:10:00Z"
  }'

# Water quality
curl -X POST https://majiscope.example.com/api/sensors/ingest \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Key: your-secret-key" \
  -d '{
    "device_id": "AU_NAM_0002",
    "temperature_c": 21.4,
    "ph": 7.2,
    "ec_uscm": 480.0,
    "do_mgl": 6.4,
    "turbidity_ntu": 3.1,
    "occurred_at": "2026-09-02T15:10:00Z"
  }'
```

---

## Current Firmware Styles

For reference, here are the payload styles observed in the existing Waleki Firebase data (water level):

**Structured (Node_1, Node_2, Node_3):**
```json
{"depth_m": 1.739, "occurred_at": "2026-01-21_12-27-04"}
```

**RawData (Node1, Node2):**
```json
{"raw_data": "Voltage=676mV, Current=5.63mA, Depth=0.510m"}
```

Both are accepted. The `depth_m` flat field is preferred (simpler, smaller). `raw_data` fallback is for backward compatibility and should not be relied on for new firmware.

**All new firmware must use the [Device ID Naming Convention](#device-id-naming-convention)** (`{UTILITY}_{DMA}_{SEQ}` e.g. `AU_NAM_0001`) instead of the legacy `Node_1` / `Node1` style.

---

## Lifecycle Summary

```
Sensor installed physically (water level or water quality)
    ↓
Sensor sends data → POST /api/sensors/ingest   (same endpoint, both categories)
    ↓
Not registered? → Stored as pending, verbatim (200, is_pending: true)
    ↓
User registers sensor → POST /api/sensors       (category chosen here: water_level | water_quality)
    ↓
Pending readings automatically parsed per category and promoted to real readings
    ↓
Tank page shows the sensor under its category with full reading history
```
