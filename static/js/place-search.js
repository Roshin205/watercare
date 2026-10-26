(function (root) {
  function coordinates(lat, lng) {
    if ([lat, lng].some(value => value === "" || value == null)) return null;
    const latitude = Number(lat), longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return [latitude, longitude];
  }
  // Accepts "25.2854, 51.531" or "25.2854 51.531", the way map apps copy a point.
  function coordinatePair(text) {
    const match = String(text || "").trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    return match ? coordinates(match[1], match[2]) : null;
  }
  function distinct(parts, exclude) {
    return [...new Set(parts.filter(Boolean).map(String))].filter(part => part !== exclude);
  }
  function readable(value) { return String(value || "").replaceAll("_", " "); }
  function usable(place) { return Boolean(place.label) && coordinates(place.lat, place.lng) !== null; }
  function withoutDuplicates(places) {
    const seen = new Set();
    return places.filter(place => {
      const key = `${place.label}|${place.lat.toFixed(4)}|${place.lng.toFixed(4)}`;
      return !seen.has(key) && seen.add(key);
    });
  }
  function fromPhoton(body) {
    return withoutDuplicates((body?.features || []).map(feature => {
      const details = feature.properties || {}, [lng, lat] = feature.geometry?.coordinates || [];
      const street = [details.housenumber, details.street].filter(Boolean).join(" ");
      const label = details.name || street || details.city || details.state || details.country || "";
      return {
        label,
        detail: distinct([details.name ? street : "", details.district, details.city, details.county, details.state, details.country], label).join(", "),
        // OpenStreetMap tags like building=yes carry the meaning in the key, not the value.
        type: readable(details.osm_value === "yes" ? details.osm_key : details.osm_value || details.type), lat: Number(lat), lng: Number(lng),
      };
    }).filter(usable));
  }
  function fromNominatim(body) {
    return withoutDuplicates((Array.isArray(body) ? body : []).map(item => {
      const [label, ...rest] = String(item.display_name || "").split(", ");
      return { label, detail: rest.join(", "), type: readable(item.type), lat: Number(item.lat), lng: Number(item.lon) };
    }).filter(usable));
  }
  function fullName(place) { return [place.label, place.detail].filter(Boolean).join(", "); }
  const api = { coordinates, coordinatePair, fromPhoton, fromNominatim, fullName };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WaterCarePlaces = api;
})(this);
