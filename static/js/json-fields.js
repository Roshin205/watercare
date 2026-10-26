(function (root) {
  const fields = ["test_parameters", "test_results", "reference_limits"];
  function toText(value) {
    if (value == null || (typeof value === "object" && !Object.keys(value).length)) return "";
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
  function parseInto(values) {
    for (const field of fields.filter(key => key in values)) {
      const label = field.replaceAll("_", " ");
      try { values[field] = JSON.parse(values[field]); }
      catch { return `${label} must be valid JSON, for example {"pH": 7.2}.`; }
      if (typeof values[field] !== "object" || values[field] === null) return `${label} must be a JSON object or list.`;
    }
    return "";
  }
  const api = { fields, toText, parseInto };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WaterCareJsonFields = api;
})(this);
