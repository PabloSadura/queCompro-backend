const express = require('express');
const router = express.Router();
const googleSearch = require('../search-service/services/googleSearchService');
const gemini = require('../search-service/services/geminiService');
const findSimilarSearchResult = require('../search-service/services/firebaseService');
const saveSearchResult = require('../search-service/services/firebaseService');



// POST /api/search
// body: { query: string, userContext?: { uid, email } }
router.post("/", async (req, res, next) => {
  try {
    const { query } = req.body;

    // 🔎 1. Buscar en Firestore con fuzzy
    const existing = await findSimilarSearchResult(query);
    if (existing) {
      return res.json({
        query,
        results: existing.aiResponse,
        cached: true,
        fuzzy: true
      });
    }

    // 🌍 2. Buscar en Google (si no hay similar guardado)
    const googleResults = await googleSearch(query);

    // 🤖 3. Pasar por AI
    const aiResponse = await gemini(query, googleResults);

    // 💾 4. Guardar en Firestore
    await saveSearchResult(query, googleResults, aiResponse);

    res.json({ query, results: aiResponse, cached: false, fuzzy: false });
  } catch (err) {
      next(err);
  }
});



module.exports = router;