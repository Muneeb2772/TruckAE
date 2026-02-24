const state = {
  data: null,
  map: null,
  segmentLayer: null,
  routeLayer: null
};

function styleForAccess(access) {
  if (access === 'allowed') return { color: '#34d399', weight: 5 };
  if (access === 'conditional') return { color: '#fbbf24', weight: 5, dashArray: '6,8' };
  return { color: '#f87171', weight: 5 };
}

function setDefaultDeparture() {
  const input = document.getElementById('departureTime');
  const now = new Date(Date.now() + 15 * 60000);
  input.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function populateHubs() {
  const origin = document.getElementById('originHub');
  const dest = document.getElementById('destinationHub');

  state.data.hubs.forEach((hub) => {
    const o = document.createElement('option');
    o.value = hub.id;
    o.textContent = hub.name;
    origin.appendChild(o);

    const d = document.createElement('option');
    d.value = hub.id;
    d.textContent = hub.name;
    dest.appendChild(d);
  });

  origin.value = 'JEBEL_ALI_PORT';
  dest.value = 'SHARJAH_HUB';
}

function initMap() {
  state.map = L.map('map').setView([25.18, 55.28], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(state.map);

  state.segmentLayer = L.geoJSON(state.data.segments, {
    style: (feature) => styleForAccess(feature.properties.truckAccess),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindPopup(`<strong>${p.name}</strong><br/>Access: ${p.truckAccess}<br/>Weight max: ${p.maxWeightKg} kg<br/>Height max: ${p.maxHeightM} m`);
    }
  }).addTo(state.map);

  state.data.hubs.forEach((hub) => {
    L.marker([hub.lat, hub.lng]).addTo(state.map).bindPopup(`${hub.name} (${hub.type})`);
  });
}

function updateAlerts(messages) {
  const alerts = document.getElementById('alertsList');
  alerts.innerHTML = '';

  if (!messages.length) {
    alerts.innerHTML = '<li>No active alerts on selected route.</li>';
    return;
  }

  messages.forEach((msg) => {
    const li = document.createElement('li');
    li.textContent = msg;
    alerts.appendChild(li);
  });
}

function showRoute(result) {
  const resultDiv = document.getElementById('routeResult');
  resultDiv.innerHTML = `
    <strong>Route: ${result.routeId}</strong><br/>
    Distance: ${result.distanceKm.toFixed(1)} km<br/>
    ETA: ${result.etaMin} min<br/>
    Compliance: ${result.complianceStatus}<br/>
    Risk score: ${result.riskScore}<br/>
    <br/><strong>Why this route:</strong>
    <ul>${result.explanation.map((e) => `<li>${e}</li>`).join('')}</ul>
  `;

  updateAlerts(result.explanation.filter((x) => x.toLowerCase().includes('restricted') || x.toLowerCase().includes('approaching')));

  if (state.routeLayer) state.map.removeLayer(state.routeLayer);
  const selected = state.data.segments.features.filter((f) => result.segmentIds.includes(f.properties.id));
  state.routeLayer = L.geoJSON({ type: 'FeatureCollection', features: selected }, {
    style: { color: '#40a9ff', weight: 8 }
  }).addTo(state.map);
  state.map.fitBounds(state.routeLayer.getBounds(), { padding: [20, 20] });
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const payload = {
    originHub: document.getElementById('originHub').value,
    destinationHub: document.getElementById('destinationHub').value,
    departureTime: document.getElementById('departureTime').value,
    vehicle: {
      type: document.getElementById('vehicleType').value,
      weightKg: Number(document.getElementById('weightKg').value),
      heightM: Number(document.getElementById('heightM').value),
      axleLoadKg: Number(document.getElementById('axleLoadKg').value)
    }
  };

  const res = await fetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();
  if (!res.ok) {
    document.getElementById('routeResult').innerHTML = `<strong>Error:</strong> ${result.error}`;
    updateAlerts([result.error]);
    return;
  }

  showRoute(result);
}

async function init() {
  const response = await fetch('/api/data');
  state.data = await response.json();
  populateHubs();
  setDefaultDeparture();
  initMap();
  document.getElementById('routeForm').addEventListener('submit', handleFormSubmit);
}

init();
