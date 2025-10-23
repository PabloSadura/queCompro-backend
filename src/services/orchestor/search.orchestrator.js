// Importamos el motor de reglas local
import { analyzeShoppingResults } from '../services/search-service/analysisService.js';
// ✅ Importamos el nuevo servicio de limpieza
import { structureProductDataWithAI } from '../services/search-service/geminiCleaner.service.js';
// Resto de importaciones
import { fetchGoogleShoppingResults } from '../services/search-service/googleSopphing.js';
import { saveSearchToFirebase } from '../services/search-service/firebaseService.js';
import logicFusion from './logis.controller.js';

/**
 * Orquesta el flujo de búsqueda principal.
 * AHORA INCLUYE UN PASO DE LIMPIEZA CON IA.
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
      category = 'default'
  } = searchData;

  // 1. Obtener resultados "sucios" de Google Shopping
  const { products: shoppingResults, totalResults } = await fetchGoogleShoppingResults(
      userId, query, countryCode, languageCode, currency, minPrice, maxPrice, ratingFilter
  );

  if (!shoppingResults || shoppingResults.length === 0) {
    throw new Error("No se encontraron productos en Google Shopping.");
  }

  // ✅ 2. NUEVO PASO: Limpiar y estructurar los datos con la IA
  const structuredProducts = await structureProductDataWithAI(shoppingResults);

  // 3. Analizar con el MOTOR DE REGLAS LOCAL
  //    Ahora le pasamos los datos "limpios" y "sucios"
  console.log(`[Local Engine] Ejecutando análisis local para categoría: ${category}`);
  const localAnalysis = analyzeShoppingResults(query, shoppingResults, structuredProducts, category);

  if (!localAnalysis || !localAnalysis.productos_analisis) {
    throw new Error("No se pudo obtener un análisis local válido.");
  }

  // 4. Fusionar datos (fusiona los datos "sucios" con el análisis)
  const productosRecomendados = logicFusion(shoppingResults, localAnalysis).map(p => ({
    ...p,
    isRecommended: localAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.isRecommended || false,
    pros: localAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.pros,
    contras: localAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.contras,
  }));

  // 5. Preparar el objeto de recomendación final
  const finalRecommendation = {
    recomendacion_final: localAnalysis.recomendacion_final,
    productos: productosRecomendados,
    total_results: totalResults,
  };

  // 6. Guardar en Firebase
  const { id: collectionId, createdAt } = await saveSearchToFirebase(query, userId, finalRecommendation);

  // 7. Devolver el resultado completo
  return {
    ...finalRecommendation,
    id: collectionId,
    createdAt: createdAt
  };
}

