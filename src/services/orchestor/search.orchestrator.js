// ✅ Importamos el motor de reglas local
import { analyzeShoppingResults } from '../search-service/ia.service.js';
// ❌ Quitamos la importación de getBestRecommendationFromAI (Gemini)
import { fetchGoogleShoppingResults } from '../search-service/googleSopphing.service.js';
import { saveSearchToFirebase } from '../search-service/firebaseService.service.js';
import logicFusion from '../../controllers/logis.controller.js';

/**
 * Orquesta el flujo de búsqueda principal.
 * AHORA SOLO USA EL MOTOR DE REGLAS LOCAL.
 * @param {object} searchData - Contiene query, userId, minPrice, maxPrice, etc.
 * @returns {Promise<object>} El resultado analizado localmente.
 */
export async function performSearchLogic(searchData) {
  const { 
      query, 
      userId, 
      minPrice, 
      maxPrice, 
      countryCode = 'ar', 
      languageCode = 'es', 
      currency = 'ARS',
      ratingFilter,
      category = 'default' // Recibe la categoría
  } = searchData;

  // 1. Obtener resultados de Google Shopping
  const { products: shoppingResults, totalResults } = await fetchGoogleShoppingResults(
      userId, query, countryCode, languageCode, currency, minPrice, maxPrice, ratingFilter
  );

  if (!shoppingResults || shoppingResults.length === 0) {
    throw new Error("No se encontraron productos en Google Shopping.");
  }

  // 2. Analizar con el MOTOR DE REGLAS LOCAL
  console.log(`[Local Engine] Ejecutando análisis local para categoría: ${category}`);
  const localAnalysis = analyzeShoppingResults(query, shoppingResults, category);

  if (!localAnalysis || !localAnalysis.productos_analisis) {
    throw new Error("No se pudo obtener un análisis local válido.");
  }

  // 3. Fusionar datos y marcar el recomendado
  const productosRecomendados = logicFusion(shoppingResults, localAnalysis).map(p => ({
    ...p,
    isRecommended: localAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.isRecommended || false,
    pros: localAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.pros,
    contras: localAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.contras,
  }));

  // 4. Preparar el objeto de recomendación final
  const finalRecommendation = {
    recomendacion_final: localAnalysis.recomendacion_final,
    productos: productosRecomendados,
    total_results: totalResults,
  };

  // 5. Guardar en Firebase para obtener el ID de la colección
  const { id: collectionId, createdAt } = await saveSearchToFirebase(query, userId, finalRecommendation);

  // 6. Devolver el resultado completo
  return {
    ...finalRecommendation,
    id: collectionId,
    createdAt: createdAt
  };
}

