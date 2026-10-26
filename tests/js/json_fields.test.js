const assert = require("node:assert/strict");
const test = require("node:test");

const jsonFields = require("../../static/js/json-fields.js");

test("saved JSON values are shown as editable JSON, not [object Object]", () => {
  assert.equal(jsonFields.toText({ pH: 7.2 }), '{\n  "pH": 7.2\n}');
  assert.equal(jsonFields.toText(["pH", "chlorine"]), '[\n  "pH",\n  "chlorine"\n]');
  assert.equal(jsonFields.toText({}), "");
  assert.equal(jsonFields.toText([]), "");
  assert.equal(jsonFields.toText(null), "");
});

test("an edited record round-trips back to the objects the API expects", () => {
  const saved = { test_results: { pH: 7.2 }, test_parameters: ["pH"] };
  const values = {
    test_results: jsonFields.toText(saved.test_results),
    test_parameters: jsonFields.toText(saved.test_parameters),
    notes: "unchanged text",
  };
  assert.equal(jsonFields.parseInto(values), "");
  assert.deepEqual(values, { ...saved, notes: "unchanged text" });
});

test("invalid or non-object JSON is reported instead of being sent", () => {
  assert.match(jsonFields.parseInto({ test_results: "[object Object]" }), /test results must be valid JSON/);
  assert.match(jsonFields.parseInto({ reference_limits: "7.2" }), /reference limits must be a JSON object or list/);
});
