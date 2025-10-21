import { saveSearchToFirebase } from "../search-service/firebaseService.service.js";
import { fetchGoogleShoppingResults } from "../search-service/googleSopphing.service.js";
import {getBestRecommendationFromGemini} from "../search-service/geminiService.service.js";
import logicFusion from "../../controllers/logis.controller.js";

/**
 * Orquesta el flujo completo de una búsqueda de producto.
 * Es el "motor" central que puede ser llamado tanto por la web como por el bot.
 * @param {object} searchParams - Contiene query, userId, minPrice, maxPrice, countryCode, etc.
 * @returns {Promise<object>} El resultado completo de la búsqueda, incluyendo el collectionId.
 */
export async function performSearchLogic(searchParams) {
  const { userId, query, countryCode, languageCode, currency, minPrice, maxPrice } = searchParams;

  // 1. Buscar en Google Shopping
  const { products: shoppingResults, totalResults } = await fetchGoogleShoppingResults(
    userId, query, countryCode, languageCode, currency, minPrice, maxPrice
  );
  if (!shoppingResults || shoppingResults.length === 0) {
    throw new Error("No se encontraron productos en Google Shopping.");
  }

  sendEvent({ status: 'Analizando productos con IA'});

  // 2. Analizar con IA para obtener la mejor recomendación
  const aiAnalysis = await getBestRecommendationFromGemini(query, shoppingResults);
  if (!aiAnalysis || !aiAnalysis.productos_analisis) {
    throw new Error("No se pudo obtener un análisis válido de la IA.");
  }

  sendEvent({ status: 'Preparando productos...'});

  // 3. Fusionar datos y marcar el producto recomendado
  const productosRecomendadosBase = logicFusion(shoppingResults, aiAnalysis);
  const recommendationMap = new Map(
    aiAnalysis.productos_analisis.map(p => [p.product_id, p.isRecommended])
  );
  const productosConRecomendacion = productosRecomendadosBase.map(product => ({
    ...product,
    isRecommended: recommendationMap.get(product.product_id) || false
  }));

  // 4. Estructura final para guardar
  const finalRecommendation = {
    recomendacion_final: aiAnalysis.recomendacion_final,
    productos: productosConRecomendacion,
    total_results: totalResults,
  };
  sendEvent({ status: 'Guardando productos...'});

  // 5. Guardar en Firebase para obtener el ID y la fecha
  const { id: searchId, createdAt } = await saveSearchToFirebase(query, userId, finalRecommendation);

  // 6. Devolver el objeto de resultado completo
  return {
    ...finalRecommendation,
    id: searchId,
    createdAt: createdAt,
  };
}

