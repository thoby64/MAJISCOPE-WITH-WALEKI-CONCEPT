# Firmware Ingest Contract

The single endpoint all LoRa water-level sensors send data to — registered or not.

---

## Device ID Naming Convention

**All new sensors should follow this standard naming scheme.**

A well-named device ID tells you *where* the sensor is without looking it up.

### Format

```
{UTILITY}_{DMA}_{SEQ}
```

| Part | Rule | Example |
|------|------|---------|
| `UTILITY` | First 2–3 uppercase letters of the utility name | `AU` (AUWSA), `DA` (DAWASCO), `MU` (MUWASA) |
| `DMA` | First 2–3 uppercase letters of the DMA / area name | `NAM` (Nambala), `KIN` (Kinondoni), `mor` → `MOR` |
| `SEQ` | 2 or 4 digit zero-padded sequential number | `01`, `0001`, `0042` |

**Separator:** underscore `_` between each part.

### Examples

| Utility | DMA | Seq | Device ID |
|---------|-----|-----|-----------|
| AUWSA | Nambala | 1 | `AU_NAM_0001` |
| AUWSA | Nambala | 42 | `AU_NAM_0042` |
| DAWASCO | Kinondoni | 7 | `DA_KIN_0007` |
| MUWASA | Magu | 15 | `MU_MAG_0015` |
| KIGOMA UDC | Kigoma | 3 | `KIG_KIG_0003` |

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
5. **Register the device ID in MajiScope** before field deployment so pending readings are immediately promoted.

---

## Endpoint

```
POST /api/sensors/ingest
```

**This is the only endpoint firmware needs.** It works whether the sensor is registered in MajiScope or not.

## Authentication

| Header | Value |
|--------|-------|
| `X-Ingest-Key` | The shared secret configured as `SENSOR_INGEST_KEY` on the server |

Or a valid Bearer token (for authenticated clients).

---

## Request Body

### Required

| Field | Type | Description |
|-------|------|-------------|
| `device_id` | string | Unique sensor identifier following the [naming convention](#device-id-naming-convention) (e.g. `AU_NAM_0001`). **Must be present and non-empty.** |

### Required for unregistered devices (strict validation)

When the device is **not yet registered** in MajiScope, the server stores the reading as **pending** and requires:

| Field | Type | Description |
|-------|------|-------------|
| `device_id` | string | Non-empty. |
| A depth value | float | One of: `depth_m`, `Depth`, `depth`, `H2`, `h2` (flat), or `Depth_mm` / `depth_mm`, or a `raw_data` string that parses to a depth. |
| `occurred_at` | string | *(optional for pending)* Falls back to server receive-time if absent. |

If `device_id` is missing or depth cannot be resolved → **400 rejected**.

### For registered devices (tolerant parsing)

Once the sensor is registered, the server applies tolerant defaults:
- `h1_m` uses the registered sensor value (overridable per-reading).
- `occurred_at` falls back to server time.
- `depth_m` uses the registered default if parsing fails.
- `raw_data` strings are parsed as fallback.

---

## Behaviour

| Device registered? | Behaviour |
|--------------------|-----------|
| **Yes** | Reading is stored as a real `SensorReading` with computed water level, status, and full scope (utility/dma/tank). Returns `is_pending: false`. |
| **No** | Reading is stored in a **pending buffer** (`sensor_pending_reading`) by `device_id`. Returns `is_pending: true`. When the sensor is later registered and associated with a tank, all pending readings are **automatically promoted** to real readings with full scope. Returns `is_duplicate: true` on retry. |

### Idempotency

Both registered and pending paths use the same dedup key: `{device_id}:{occurred_at_iso}`. Retries return the existing result without creating duplicate rows.

---

## Response: Registered Device (200)

```json
{
  "ok": true,
  "is_pending": false,
  "reading_id": "abc-123",
  "sensor_id": "def-456",
  "tank_id": "ghi-789",
  "utility_id": "jkl-012",
  "dma_id": "mno-345",
  "water_level_m": 10.261,
  "h1_m": 12.0,
  "depth_m": 1.739,
  "status": "active",
  "occurred_at": "2026-01-21T12:27:04",
  "dedup_key": "AU_NAM_0001:2026-01-21T12:27:04",
  "is_duplicate": false
}
```

---

## Response: Unregistered Device — Pending (200)

```json
{
  "ok": true,
  "is_pending": true,
  "reading_id": "buf-789",
  "device_id": "AU_NAM_0001",
  "occurred_at": "2026-01-21T12:27:04",
  "dedup_key": "AU_NAM_0001:2026-01-21T12:27:04",
  "is_duplicate": false
}
```

The pending reading is stored and will be **automatically promoted** to a real tank reading when the sensor is registered via `POST /api/sensors`.

---

## Error Responses

| Status | Meaning |
|--------|---------|
| 400 | Missing `device_id` or depth cannot be resolved (unregistered device) |
| 401 | Missing or invalid `X-Ingest-Key` / Bearer token |

---

## Registration

Before or after sending data, firmware can be registered in MajiScope:

```
POST /api/sensors
```

```json
{
  "device_id": "AU_NAM_0001",
  "tank_id": "<tank-uuid-from-majiscope>",
  "h1_m": 12.0,
  "activated": true
}
```

On registration, any pending readings for `device_id` are **automatically promoted** — they become real tank readings with computed water level and status. The response includes `promoted_readings` showing how many historical readings were attached.

```json
{
  "id": "...",
  "device_id": "AU_NAM_0001",
  "tank_id": "...",
  "promoted_readings": 147,
  ...
}
```

`h1_m` is the cable/sensor hanging length in metres. Set once at install time. Used to compute `water_level_m = h1_m - depth_m`. Firmware should **not** send `h1_m` unless overriding a temporary condition.

---

## Depth Extraction Precedence

1. Flat top-level: `depth_m` → `Depth` → `depth` → `H2` → `h2`
2. Flat millimetre: `Depth_mm` → `depth_mm` (÷ 1000)
3. Nested `properties` dict: same key order
4. Nested `properties` mm: same key order
5. `raw_data` string regex: `Depth=X` or `D=X` or fallback `Nm` token
6. Registered `sensor.depth_m` default (registered devices only)

### Physical Sanity

Depth > 20 m is rejected (falls back to sensor default for registered devices; 400 for unregistered).

---

## Timestamp Formats

| Format | Example | Recommended |
|--------|---------|-------------|
| ISO 8601 | `2026-01-21T12:27:04` | ✅ Preferred — compact, portable |
| Underscore | `2026-01-21_12-27-04` | ✅ Accepted |
| Epoch ms | `1737465424000` | ✅ Accepted (13 digits) |
| Omitted | — | Server uses current UTC time |

**Recommendation for LoRa:** use ISO 8601 (`YYYY-MM-DDThh:mm:ss`) — 19 characters, portable, human-readable in logs. Epoch ms is acceptable but longer (13 digits vs 19 chars) and less debuggable in the field.

---

## Firmware Alignment Checklist

- [ ] **Device ID follows the naming convention** — `{UTILITY}_{DMA}_{SEQ}` (e.g. `AU_NAM_0001`)
- [ ] Send to **only** `POST /api/sensors/ingest` — works for registered and unregistered devices
- [ ] Always include `device_id` (non-empty) and a depth value
- [ ] Include `occurred_at` if possible; if not, server uses receive-time
- [ ] Do **not** send `latitude` or `longitude` — sensor position is the tank's coordinates in MajiScope
- [ ] Keep payload under LoRa modem's reliable size (typically ≤ 50 bytes for the JSON body)
- [ ] Use ISO 8601 compact format for timestamps (`YYYY-MM-DDThh:mm:ss`)
- [ ] Test with actual LoRa modem before field deployment — verify the packet arrives intact
- [ ] Verify `occurred_at` is set in UTC if sending epoch ms

---

## Example: Minimal Firmware Payload

```json
{"device_id":"AU_NAM_0001","depth_m":1.739,"occurred_at":"2026-01-21T12:27:04"}
```

**Total: ~70 bytes** — well within LoRa's reliable range.

---

## Example: cURL

```bash
curl -X POST https://majiscope.example.com/api/sensors/ingest \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Key: your-secret-key" \
  -d '{
    "device_id": "AU_NAM_0001",
    "depth_m": 1.739,
    "occurred_at": "2026-01-21T12:27:04"
  }'
```

---

## Current Firmware Styles

For reference, here are the two payload styles observed in the existing Waleki Firebase data:

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
Sensor installed physically
    ↓
Sensor sends data → POST /api/sensors/ingest
    ↓
Not registered? → Stored as pending (200, is_pending: true)
    ↓
User registers sensor → POST /api/sensors
    ↓
Pending readings automatically promoted to real tank readings
    ↓
Tank detail page shows full reading history
```
