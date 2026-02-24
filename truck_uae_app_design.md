# TruckAE — UAE Freight Navigation App Design

## 1) App screen breakdown

### A. Home / Quick Start
**Goal:** let drivers begin route planning in under 10 seconds.

**Key elements:**
- Primary CTA: **Plan Route**.
- Secondary CTA: **Resume Active Trip**.
- Current location card (GPS status, city/emirate).
- Vehicle profile shortcut (selected truck + compliance status).
- Alert summary chips (e.g., `2 Restriction Warnings`, `1 Time Window Risk`).
- Bottom navigation: Home, Planner, Map, Alerts, Profile.

---

### B. Route Planner
**Goal:** capture operational constraints before route generation.

**Input form (top panel):**
- Origin, destination (search + pin on map).
- Vehicle type: rigid truck, trailer, articulated.
- Gross vehicle weight, height, axle count/axle load.
- Cargo type (general, hazardous, refrigerated, oversized).
- Planned departure time/date.
- Optional toggles: avoid tolls, prefer highways, prefer industrial corridors.

**Output panel (after compute):**
- Best compliant route card (ETA, distance, legal confidence).
- Alternative route cards (if available) with trade-offs.
- Restriction warnings list with plain-language reasons.
- “Why this route?” explanation (top 3 rules applied).

---

### C. Interactive Truck Map (Core)
**Goal:** map-first operating view with legal overlays.

**Map layers (toggleable):**
- Truck-restricted roads.
- Time-based restrictions (e.g., peak-hour bans).
- Weight, height, axle load limits.
- Industrial areas, ports, logistics hubs.
- Checkpoints/weighbridges (optional phase 1.5).

**Visual design:**
- Green road: allowed.
- Yellow road: conditional (time/weight dependent).
- Red road: prohibited.
- Distinct icons for height barriers, weight limits, hazmat bans, timed gates.
- Large tap targets and high contrast for in-cab usage.

**Interaction:**
- Tap road segment → legal rule card (who/when/why).
- Long press → set waypoint.
- Route playback slider by time (show roads changing from yellow↔red by time window).

---

### D. Alerts Screen (Driver Safety + Compliance)
**Goal:** provide immediate, low-cognitive-load warnings.

**Sections:**
- Live alerts (critical first):
  - “Restricted zone in 1.2 km.”
  - “Time window closes in 15 min on upcoming segment.”
  - “Vehicle height exceeds posted 4.2 m limit ahead.”
- Upcoming alerts timeline for next 30–60 minutes.
- Suggested actions button (reroute now, wait window, contact dispatcher).

**UX notes:**
- Use short, driver-friendly phrasing.
- Severity colors + icon + one-line explanation.
- Optional voice prompts and Arabic/English localization.

---

### E. Fleet Dashboard (MVP-Optional, manager-facing)
**Goal:** operational visibility across active trips.

**Widgets:**
- Active vehicles map with status dots (compliant, warning, risk).
- Violation risk list (sorted by urgency).
- Route compliance score per trip.
- Historical trip table (ETA variance, detours, violations prevented).
- Vehicle profile health (missing dimensions/expired permits).

**Actions:**
- Push reroute recommendation to driver.
- View trip replay and rule-trigger log.

---

## 2) High-level user flows

### Driver flow
1. Open app → Home detects current location + active vehicle profile.
2. Tap **Plan Route** and enter destination.
3. Confirm/adjust truck attributes (weight/height/axle/cargo/departure time).
4. Engine generates compliant route + alternatives.
5. Driver reviews warnings and selects route.
6. During trip, app monitors upcoming segments and fires compliance alerts.
7. If rule conflict appears (time window closes, new restriction), app offers instant reroute.
8. Trip ends with summary: compliance status, delays avoided, alerts encountered.

### Fleet manager flow
1. Open Dashboard and review active fleet map.
2. Filter vehicles by emirate, route status, risk score.
3. Open a high-risk trip card to view violation causes.
4. Compare alternate legal route suggestions.
5. Dispatch updated route or instruction to driver.
6. Review end-of-day compliance analytics and recurring restriction hotspots.

---

## 3) Core data models (entities)

### `VehicleProfile`
- `vehicle_id` (string)
- `plate_number` (string)
- `vehicle_type` (enum: rigid, trailer, articulated)
- `gross_weight_kg` (number)
- `height_m` (number)
- `width_m` (number)
- `length_m` (number)
- `axle_count` (number)
- `axle_load_kg` (number)
- `cargo_type` (enum)
- `hazmat_flag` (boolean)
- `permit_ids` (array<string>)

### `RoadSegment`
- `segment_id` (string)
- `geometry` (LineString)
- `name` (string)
- `emirate` (enum)
- `base_speed_kph` (number)
- `truck_access` (enum: allowed/conditional/prohibited)
- `max_weight_kg` (nullable number)
- `max_height_m` (nullable number)
- `max_axle_load_kg` (nullable number)
- `corridor_priority` (number)

### `RestrictionRule`
- `rule_id` (string)
- `segment_id` (string or list)
- `rule_type` (enum: time_window, vehicle_type_ban, weight_limit, height_limit, axle_limit, hazmat)
- `applies_to` (JSON filter: vehicle/cargo/emirate)
- `time_windows` (array of day/time ranges)
- `severity` (enum: advisory/warning/prohibition)
- `legal_source` (string, e.g., municipality circular)
- `effective_from`, `effective_to` (datetime)

### `RouteRequest`
- `request_id` (string)
- `origin` (lat/lng)
- `destination` (lat/lng)
- `waypoints` (array)
- `departure_time` (datetime)
- `vehicle_profile_id` (string)
- `preferences` (JSON)

### `RouteOption`
- `route_id` (string)
- `polyline` (geometry)
- `distance_km` (number)
- `eta_min` (number)
- `compliance_status` (enum: compliant/conditional/non_compliant)
- `risk_score` (0–100)
- `triggered_rules` (array<rule_id>)
- `explanation` (array<string>)

### `AlertEvent`
- `alert_id` (string)
- `trip_id` (string)
- `alert_type` (enum: upcoming_restriction, time_window_close, weight_risk, height_risk)
- `segment_id` (string)
- `distance_to_event_m` (number)
- `severity` (enum)
- `message` (string)
- `created_at` (datetime)
- `acknowledged` (boolean)

### `Trip`
- `trip_id` (string)
- `vehicle_id` (string)
- `driver_id` (string)
- `planned_route_id` (string)
- `actual_trace` (LineString/time-series)
- `start_time`, `end_time` (datetime)
- `compliance_incidents` (count)

---

## 4) Routing decision logic (rule-based, high-level)

### Step 1: Build truck-legal graph
- Start from road network graph (OSM-derived).
- For each road segment, attach static metadata + restriction rules.
- Precompute segment legality states by time bucket (e.g., every 15 min):
  - `allowed`
  - `conditional`
  - `prohibited`

### Step 2: Validate vehicle against each segment
For candidate segment `s` and vehicle `v` at expected traversal time `t`:
- Reject `s` if any hard prohibition is true:
  - vehicle type banned,
  - weight > max_weight,
  - height > max_height,
  - axle load > max_axle,
  - time window closed.
- Mark as conditional if soft constraints apply (e.g., nearing window close).

### Step 3: Weighted pathfinding
Use Dijkstra/A* on legal graph with composite edge cost:

`cost = travel_time + alpha*risk_penalty + beta*restriction_buffer_penalty - gamma*corridor_priority`

Where:
- `risk_penalty` increases near conditional/time-critical segments.
- `restriction_buffer_penalty` discourages edges likely to become illegal before arrival.
- `corridor_priority` rewards known truck corridors.

### Step 4: Generate alternatives
- K-shortest legal paths.
- Remove near-duplicates (polyline overlap threshold).
- Label each option: fastest compliant, safest compliant, best fallback.

### Step 5: Explainability output
For selected route, return machine + human readable reasons:
- “Avoided Al X Road due to 06:00–09:00 truck ban.”
- “Selected E311 corridor because your vehicle exceeds 3.5t limit on local streets.”

### Step 6: Live monitoring loop
- Re-evaluate next N kilometers every 30–60 seconds or upon GPS update.
- If upcoming segment turns prohibited at ETA, trigger alert + reroute.

---

## 5) Future AI enhancements (post-rule engine)

1. **Predictive compliance risk model**
   - Learn where drivers are likely to deviate into restricted roads.
   - Proactively warn earlier based on behavior/context.

2. **ETA and congestion learning for trucks**
   - Train truck-specific travel-time model (not car-based).
   - Include port gate queues, industrial area bottlenecks, shift timings.

3. **Smart dispatch recommendations**
   - Multi-vehicle assignment optimization with legal constraints.
   - Suggest best vehicle-route pairing by dimensions/cargo/permit.

4. **Natural-language regulation assistant**
   - Query: “Can my 4.4m trailer enter this road at 7 PM in Dubai?”
   - AI translates legal rules into plain language + confidence.

5. **Dynamic rule extraction pipeline**
   - NLP on emirate circulars/notices to propose rule updates.
   - Human-in-the-loop approval before publishing to routing engine.

6. **Driver coaching & scoring**
   - Personalized driving/compliance scorecards.
   - Suggest habits that reduce violations and delay risk.

7. **Anomaly detection for map/rule quality**
   - Detect conflicts between observed truck traces and encoded restrictions.
   - Flag likely stale or incorrect map restrictions for review.

---

## Suggested MVP architecture (student-feasible)

- **Frontend:** React + Leaflet + Tailwind (mobile-first responsive UI).
- **Backend:** Node.js/Express (or FastAPI) with in-memory/PostgreSQL rule store.
- **Routing:** OSMnx/NetworkX preprocessing (offline) + runtime A*/Dijkstra service.
- **Data format:** GeoJSON for roads/zones; JSON/YAML for restriction rules.
- **Deployment:** Docker Compose (frontend + backend + db), no paid APIs.

This architecture keeps phase-1 realistic while allowing future migration to live traffic feeds and enterprise fleet integrations.
