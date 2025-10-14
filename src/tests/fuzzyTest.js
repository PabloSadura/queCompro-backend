const { fuzzySearchFirebase } = require("../services/search-services/fuzzySearch");

(async () => {
  const result = await fuzzySearchFirebase("notebook hp", "demoUser");
  console.log("🔍 Resultado fuzzy:", result);
})();


const { handleSearch } = require("../controllers/search.controller");

(async () => {
  const req = { body: { query: "notebook hp", userId: "demoUser" } };
  const res = { json: console.log, status: () => ({ json: console.log }) };
  await handleSearch(req, res);
})();
