# TruckAE MVP (Web App)

TruckAE is a truck-first UAE freight routing MVP focused on legal compliance and operational clarity.

## Features implemented
- Interactive map with truck legality layers (allowed/conditional/prohibited)
- Truck-aware route planner (vehicle dimensions/weight/axle + departure time)
- Rule-based backend routing engine
- Compliance alerts surfaced from triggered rules
- Basic fleet dashboard summary cards

## Tech stack
- Frontend: Vanilla JS + Leaflet + OpenStreetMap tiles
- Backend: Node.js HTTP server (no external dependencies)
- Data: Static GeoJSON/JSON restriction datasets

## Run locally
```bash
npm install
npm start
```
Open: `http://localhost:3000`

## API
- `GET /api/data` => map segments, hubs, restriction rules
- `POST /api/route` => compliant route response based on truck profile + departure time
