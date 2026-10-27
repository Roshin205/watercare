const assert = require("node:assert/strict");
const test = require("node:test");

const places = require("../../static/js/place-search.js");

test("manually typed coordinates are accepted only when both are in range", () => {
  assert.deepEqual(places.coordinates("25.2854", "51.531"), [25.2854, 51.531]);
  assert.deepEqual(places.coordinates(-33.86, 151.2), [-33.86, 151.2]);
  assert.equal(places.coordinates("", "51.5"), null);
  assert.equal(places.coordinates("25.2", null), null);
  assert.equal(places.coordinates("95", "51.5"), null);
  assert.equal(places.coordinates("25.2", "181"), null);
  assert.equal(places.coordinates("north", "51.5"), null);
});

test("coordinates pasted into the search box become a point to apply", () => {
  assert.deepEqual(places.coordinatePair("25.2854, 51.531"), [25.2854, 51.531]);
  assert.deepEqual(places.coordinatePair(" -33.86 151.2 "), [-33.86, 151.2]);
  assert.equal(places.coordinatePair("Doha Corniche"), null);
  assert.equal(places.coordinatePair("25.28, 251.5"), null);
});

test("search suggestions are listed with a name, details and the exact point", () => {
  const found = places.fromPhoton({
    features: [
      { geometry: { coordinates: [51.531, 25.2854] }, properties: { name: "Doha Corniche", osm_value: "pedestrian_way", city: "Doha", country: "Qatar" } },
      { geometry: { coordinates: [51.531, 25.2854] }, properties: { name: "Doha Corniche", osm_value: "pedestrian_way", city: "Doha", country: "Qatar" } },
      { geometry: { coordinates: [55.27, 25.2] }, properties: { housenumber: "12", street: "Sheikh Zayed Road", city: "Dubai", country: "United Arab Emirates" } },
      { geometry: { coordinates: [] }, properties: { name: "No point" } },
    ],
  });
  assert.deepEqual(found, [
    { label: "Doha Corniche", detail: "Doha, Qatar", type: "pedestrian way", lat: 25.2854, lng: 51.531 },
    { label: "12 Sheikh Zayed Road", detail: "Dubai, United Arab Emirates", type: "", lat: 25.2, lng: 55.27 },
  ]);
  assert.equal(places.fullName(found[0]), "Doha Corniche, Doha, Qatar");
  const [building] = places.fromPhoton({ features: [
    { geometry: { coordinates: [55.2744, 25.1972] }, properties: { name: "Burj Khalifa", osm_key: "building", osm_value: "yes", city: "Dubai" } },
  ] });
  assert.equal(building.type, "building");
});

test("explicit-search fallback results use the same shape", () => {
  assert.deepEqual(places.fromNominatim([
    { display_name: "Dubai Marina, Dubai, United Arab Emirates", type: "neighbourhood", lat: "25.0786", lon: "55.1352" },
    { display_name: "", lat: "1", lon: "1" },
  ]), [{ label: "Dubai Marina", detail: "Dubai, United Arab Emirates", type: "neighbourhood", lat: 25.0786, lng: 55.1352 }]);
  assert.deepEqual(places.fromNominatim({ error: "unavailable" }), []);
});

test("a pin's address lookup result becomes a readable address", () => {
  assert.deepEqual(places.fromNominatimReverse({ display_name: "Al Marasi Drive, Business Bay, Dubai, United Arab Emirates", type: "road", lat: "25.18", lon: "55.26" }),
    [{ label: "Al Marasi Drive", detail: "Business Bay, Dubai, United Arab Emirates", type: "road", lat: 25.18, lng: 55.26 }]);
  assert.deepEqual(places.fromNominatimReverse({ error: "Unable to geocode" }), []);
  assert.deepEqual(places.fromNominatimReverse(null), []);
});
