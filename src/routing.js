const fs = require('fs');
const path = require('path');

const segments = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'segments.geojson'), 'utf8'));
const rulesData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'rules.json'), 'utf8'));

const segmentById = new Map(segments.features.map((f) => [f.properties.id, f]));
const rulesBySegment = rulesData.restrictionRules.reduce((acc, rule) => {
  acc[rule.segmentId] = acc[rule.segmentId] || [];
  acc[rule.segmentId].push(rule);
  return acc;
}, {});

function parseTimeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function isWithinWindow(date, window) {
  const day = date.getDay();
  if (!window.days.includes(day)) return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= parseTimeToMinutes(window.start) && minutes <= parseTimeToMinutes(window.end);
}

function evaluateSegmentLegality(segment, vehicle, traverseDate) {
  const p = segment.properties;
  const segmentRules = rulesBySegment[p.id] || [];
  const reasons = [];

  if (vehicle.weightKg > p.maxWeightKg) {
    return { legal: false, conditional: false, reason: `Weight exceeds ${p.maxWeightKg} kg on ${p.name}.` };
  }
  if (vehicle.heightM > p.maxHeightM) {
    return { legal: false, conditional: false, reason: `Height exceeds ${p.maxHeightM} m on ${p.name}.` };
  }
  if (vehicle.axleLoadKg > p.maxAxleLoadKg) {
    return { legal: false, conditional: false, reason: `Axle load exceeds ${p.maxAxleLoadKg} kg on ${p.name}.` };
  }
  if (p.truckAccess === 'prohibited') {
    return { legal: false, conditional: false, reason: `${p.name} is prohibited for trucks.` };
  }

  let conditional = p.truckAccess === 'conditional';

  for (const rule of segmentRules) {
    if (rule.type === 'vehicle_type_ban' && rule.vehicleTypes?.includes(vehicle.type)) {
      return { legal: false, conditional: false, reason: rule.message };
    }

    if (rule.type === 'height_limit' && vehicle.heightM > rule.maxHeightM) {
      return { legal: false, conditional: false, reason: rule.message };
    }

    if (rule.type === 'time_window') {
      const blocked = (rule.timeWindows || []).some((w) => isWithinWindow(traverseDate, w));
      if (blocked) {
        return { legal: false, conditional: true, reason: rule.message };
      }
      const minutes = traverseDate.getHours() * 60 + traverseDate.getMinutes();
      const nearWindow = (rule.timeWindows || []).some((w) => {
        const start = parseTimeToMinutes(w.start);
        return Math.abs(start - minutes) <= 45;
      });
      if (nearWindow) {
        conditional = true;
        reasons.push('Approaching restricted time window.');
      }
    }
  }

  return { legal: true, conditional, reason: reasons.join(' ') };
}

function buildAdjacency() {
  const adj = {};
  for (const feature of segments.features) {
    const { from, to } = feature.properties;
    adj[from] = adj[from] || [];
    adj[to] = adj[to] || [];
    adj[from].push({ to, segment: feature });
    adj[to].push({ to: from, segment: feature });
  }
  return adj;
}

function estimateMinutes(segment) {
  const { distanceKm, baseSpeedKph } = segment.properties;
  return (distanceKm / baseSpeedKph) * 60;
}

function edgeCost(segment, legality) {
  const travel = estimateMinutes(segment);
  const p = segment.properties;
  const riskPenalty = legality.conditional ? 20 : 0;
  const corridorReward = p.corridorPriority * 1.5;
  return travel + riskPenalty - corridorReward;
}

function route(request) {
  const adjacency = buildAdjacency();
  const { originHub, destinationHub, vehicle, departureTime } = request;
  const startTime = new Date(departureTime || Date.now());

  if (!adjacency[originHub] || !adjacency[destinationHub]) {
    return { error: 'Invalid origin or destination hub.' };
  }

  const best = new Map();
  const prev = new Map();
  const queue = [{ node: originHub, cost: 0, time: startTime }];
  best.set(originHub, 0);

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (current.node === destinationHub) break;

    for (const edge of adjacency[current.node]) {
      const travelMins = estimateMinutes(edge.segment);
      const traverseDate = new Date(current.time.getTime() + travelMins * 60000);
      const legality = evaluateSegmentLegality(edge.segment, vehicle, traverseDate);
      if (!legality.legal) continue;

      const newCost = current.cost + edgeCost(edge.segment, legality);
      if (newCost < (best.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        best.set(edge.to, newCost);
        prev.set(edge.to, {
          node: current.node,
          segmentId: edge.segment.properties.id,
          legality,
          arrival: traverseDate
        });
        queue.push({ node: edge.to, cost: newCost, time: traverseDate });
      }
    }
  }

  if (!prev.has(destinationHub)) {
    return { error: 'No legally compliant route found for current truck profile/time.' };
  }

  const segmentIds = [];
  const explanations = [];
  let cursor = destinationHub;
  while (cursor !== originHub) {
    const step = prev.get(cursor);
    segmentIds.push(step.segmentId);
    if (step.legality.reason) explanations.push(step.legality.reason);
    cursor = step.node;
  }
  segmentIds.reverse();

  const selectedSegments = segmentIds.map((id) => segmentById.get(id));
  const distanceKm = selectedSegments.reduce((sum, s) => sum + s.properties.distanceKm, 0);
  const etaMin = Math.round(selectedSegments.reduce((sum, s) => sum + estimateMinutes(s), 0));
  const triggeredWarnings = explanations.filter(Boolean);

  return {
    routeId: `ROUTE-${Date.now()}`,
    segmentIds,
    distanceKm,
    etaMin,
    complianceStatus: triggeredWarnings.length ? 'conditional' : 'compliant',
    riskScore: Math.min(100, triggeredWarnings.length * 20),
    explanation: triggeredWarnings.length
      ? triggeredWarnings
      : ['Selected truck-approved corridors while avoiding restricted segments.'],
    alternatives: [
      {
        label: 'Safest fallback',
        note: 'Delay departure by 30-60 mins to reduce time-window exposure.'
      }
    ]
  };
}

function getStaticData() {
  return {
    segments,
    hubs: rulesData.hubs,
    rules: rulesData.restrictionRules
  };
}

module.exports = { route, getStaticData };
