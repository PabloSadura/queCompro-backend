import { getBestRecommendationFromGemini } from '../search-service/geminiService.service.js';
import { fetchGoogleShoppingResults } from '../search-service/googleSopphing.service.js';
import { saveSearchToFirebase } from '../search-service/firebaseService.service.js';
import logicFusion from '../../controllers/logis.controller.js';
import { sendTextMessage, sendListMessage } from '../search-service/whatsapp.service.js';

/**
 * Orquesta el flujo completo de una búsqueda simple para WhatsApp.
 * Llama a Google Shopping y luego a Gemini.
 * @param {string} userPhone - El número de teléfono del usuario.
 * @param {object} searchData - Contiene query y userId.
 * @param {Map} conversationState - El mapa de estado de la conversación.
 */
export async function executeWhatsAppSearch(userPhone, searchData, conversationState) {
  let thinkingTimeout = null;
  try {
    const { query, userId, minPrice, maxPrice, ratingFilter } = searchData; // Recibe precios y filtros
    
    let searchingText = `¡Entendido! Buscando "${query}"`;
    if (maxPrice) searchingText += ` hasta $${maxPrice}`;
    if (minPrice) searchingText += ` desde $${minPrice}`;
    if (ratingFilter) searchingText += ` con buena valoración`;
    searchingText += `... 🕵️‍♂️`;
    
    await sendTextMessage(userPhone, searchingText);

    thinkingTimeout = setTimeout(() => {
      sendTextMessage(userPhone, "El análisis está tardando un poco más de lo normal, pero sigo trabajando en ello... 🤓");
    }, 20000); // 20 segundos

    // 1. Buscar en Google Shopping (con parámetros fijos)
    const { products: shoppingResults, totalResults } = await fetchGoogleShoppingResults(
        userId, query, 'ar', 'es', 'ARS', minPrice, maxPrice, ratingFilter
    );

    if (!shoppingResults || shoppingResults.length === 0) {
      await sendTextMessage(userPhone, "Lo siento, no encontré productos con esos criterios.");
      conversationState.delete(userPhone);
      return;
    }

    await sendTextMessage(userPhone, "Encontré varios productos. Analizando con IA (Gemini)... 🧠");

    // 2. Analizar con Gemini
    const aiAnalysis = await getBestRecommendationFromGemini(query, shoppingResults);
    
    clearTimeout(thinkingTimeout); // Detenemos el mensaje de "sigo pensando"

    if (!aiAnalysis || !aiAnalysis.productos_analisis) {
      throw new Error("No se pudo obtener un análisis válido de la IA.");
    }

    // 3. Fusionar y procesar resultados
    const productosRecomendados = logicFusion(shoppingResults, aiAnalysis).map(p => ({
        ...p,
        isRecommended: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.isRecommended || false,
        pros: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.pros,
        contras: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.contras,
    }));

    const finalRecommendation = {
        recomendacion_final: aiAnalysis.recomendacion_final,
        productos: productosRecomendados,
        total_results: totalResults,
    };
    
    // 4. Guardar en Firebase
    const { id: collectionId } = await saveSearchToFirebase(query, userId, finalRecommendation);

    // 5. Guardar estado para el siguiente paso (selección de producto)
    conversationState.set(userPhone, {
      state: 'AWAITING_PRODUCT_SELECTION',
      results: productosRecomendados,
      collectionId: collectionId,
      data: searchData
    });

    // 6. Enviar lista interactiva al usuario
    const rows = productosRecomendados.slice(0, 10).map(prod => ({
      id: `select_product:${prod.product_id}`,
      title: prod.title.substring(0, 24),
      description: `Precio: ${prod.price}`.substring(0, 72)
    }));

    await sendListMessage(userPhone, `Análisis para "${query}"`, `¡Listo! Mi recomendación final de IA es:\n\n${finalRecommendation.recomendacion_final}\n\nSelecciona una opción para ver más detalles.`, "Ver Opciones", [{ title: "Productos Recomendados", rows }]);

  } catch (error) {
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
    console.error("Error en executeWhatsAppSearch:", error.message);
    await sendTextMessage(userPhone, `Lo siento, ocurrió un error inesperado durante la búsqueda.`);
    conversationState.delete(userPhone);
  }
}

