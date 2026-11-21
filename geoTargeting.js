'use strict';
// Local businesses need local delivery. The planner names places in plain words
// (e.g. "רחובות", 15 km); the server resolves them to Meta location keys before
// the plan is hashed and shown for approval, so what the owner approves is exactly
// the area that will be targeted.
const MIN_KM = 17, MAX_KM = 80, MAX_PLACES = 10;
const clampKm = (v) => Math.min(MAX_KM, Math.max(MIN_KM, Math.round(Number(v) || 20)));

function checkPlaces(places) {
  if (!Array.isArray(places) || !places.length || places.length > MAX_PLACES) throw Error('INVALID_TARGET_PLACES');
  for (const p of places) if (!p || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || Object.keys(p).some((k) => !['name', 'radiusKm'].includes(k))) throw Error('INVALID_TARGET_PLACES');
}

async function resolvePlaces(places, search) {
  checkPlaces(places);
  const cities = [], regions = [];
  for (const place of places) {
    const q = place.name.trim();
    const found = ((await search({ type: 'adgeolocation', location_types: JSON.stringify(['city', 'region']), q, country_code: 'IL', limit: 5 })).data || [])
      .filter((x) => x && /^\d+$/.test(String(x.key)) && ['city', 'region'].includes(x.type));
    const hit = found.find((x) => x.type === 'city') || found.find((x) => x.type === 'region');
    if (!hit) throw Object.assign(Error('TARGET_PLACE_NOT_FOUND'), { place: q });
    if (hit.type === 'city') cities.push({ key: String(hit.key), name: String(hit.name || q).slice(0, 60), radius: clampKm(place.radiusKm), distance_unit: 'kilometer' });
    else regions.push({ key: String(hit.key), name: String(hit.name || q).slice(0, 60) });
  }
  return { ...(cities.length ? { cities } : {}), ...(regions.length ? { regions } : {}) };
}

// Replace targeting.places with resolved geo_locations (countries are dropped: overlapping locations are rejected by Meta).
async function resolveTargeting(targeting, search) {
  if (!targeting || targeting.places === undefined) return targeting;
  const { places, ...rest } = targeting;
  return { ...rest, geo_locations: await resolvePlaces(places, search) };
}

function validGeo(geo) {
  if (!geo || typeof geo !== 'object' || Object.keys(geo).some((k) => !['countries', 'cities', 'regions'].includes(k))) return false;
  const countries = geo.countries, cities = geo.cities, regions = geo.regions;
  if (!countries?.length && !cities?.length && !regions?.length) return false;
  if (countries !== undefined && (!Array.isArray(countries) || countries.some((c) => !/^[A-Z]{2}$/.test(c)))) return false;
  if (cities !== undefined && (!Array.isArray(cities) || cities.length > MAX_PLACES || cities.some((c) => !/^\d+$/.test(String(c?.key)) || c.distance_unit !== 'kilometer' || !Number.isInteger(c.radius) || c.radius < MIN_KM || c.radius > MAX_KM))) return false;
  if (regions !== undefined && (!Array.isArray(regions) || regions.length > MAX_PLACES || regions.some((r) => !/^\d+$/.test(String(r?.key))))) return false;
  return true;
}

// Display names stay in the approved plan; Meta receives only keys and radius.
function forMeta(targeting) {
  if (!targeting?.geo_locations) return targeting;
  const g = targeting.geo_locations;
  return { ...targeting, geo_locations: { ...(g.countries ? { countries: g.countries } : {}), ...(g.cities ? { cities: g.cities.map((c) => ({ key: c.key, radius: c.radius, distance_unit: c.distance_unit })) } : {}), ...(g.regions ? { regions: g.regions.map((r) => ({ key: r.key })) } : {}) } };
}

module.exports = { forMeta, resolvePlaces, resolveTargeting, validGeo, clampKm, MIN_KM, MAX_KM };
