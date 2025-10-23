// Importa todos los servicios de lógica de negocio
import { getBestRecommendationFromGemini } from '../search-service/geminiService.service.js';
import { analyzeShoppingResults } from '../search-service/ia.service.js';
import { fetchGoogleShoppingResults } from '../search-service/googleSopphing.service.js';
import { saveSearchToFirebase } from '../search-service/firebaseService.service.js';
import logicFusion from '../../controllers/logis.controller.js';
// Importa los servicios de envío de WhatsApp
import { sendTextMessage, sendReplyButtonsMessage, sendListMessage } from '../search-service/whatsapp.service.js';

/**
 * PASO 5: Busca, analiza con el motor de reglas local y pregunta si se desea análisis IA.
 */
export async function executeLocalAnalysisSearch(userPhone, searchData, conversationState) {
  let thinkingTimeout = null;
  try {
    const {
        query,
        userId,
        minPrice,
        maxPrice,
        category, // Categoría seleccionada por el usuario
        brandPreference,
        ratingFilter,
        featureKeyword
    } = searchData;

    // --- Construcción de la Consulta Enriquecida ---
    let finalQuery = query;
    if (brandPreference && brandPreference.toLowerCase() !== 'ninguna') {
        finalQuery += ` ${brandPreference}`;
    }
    if (featureKeyword) finalQuery += ` ${featureKeyword}`;
    
    let searchingText = `¡Entendido! Buscando "${finalQuery}"`;
    if (maxPrice) searchingText += ` hasta $${maxPrice}`;
    if (minPrice) searchingText += ` desde $${minPrice}`;
    if (ratingFilter) searchingText += ` con buena valoración`;
    searchingText += `... 🕵️‍♂️`;
    
    await sendTextMessage(userPhone, searchingText);
    
    // --- LÓGICA DE BÚSQUEDA LOCAL ---
    const { products: shoppingResults, totalResults } = await fetchGoogleShoppingResults(
        userId, finalQuery, 'ar', 'es', 'ARS', minPrice, maxPrice, ratingFilter
    );

    if (!shoppingResults || shoppingResults.length === 0) {
      await sendTextMessage(userPhone, "Lo siento, no encontré productos con esos criterios.");
      conversationState.delete(userPhone);
      return;
    }

    await sendTextMessage(userPhone, "Encontré varios productos. Realizando un análisis rápido...");
    const localAnalysis = analyzeShoppingResults(finalQuery, shoppingResults, category);

    if (!localAnalysis || !localAnalysis.productos_analisis || localAnalysis.productos_analisis.length === 0) {
        await sendTextMessage(userPhone, "No pude realizar un análisis preliminar. ¿Quieres intentar con otra búsqueda?");
        conversationState.delete(userPhone);
        return;
    }

    const locallyAnalyzedProducts = logicFusion(shoppingResults, localAnalysis).map(p => ({
        ...p,
        isRecommended: localAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.isRecommended || false,
        pros: localAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.pros,
        contras: localAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.contras,
    }));
    
    const finalRecommendation = {
        recomendacion_final: localAnalysis.recomendacion_final,
        productos: locallyAnalyzedProducts,
        total_results: totalResults,
    };
    
    const { id: collectionId } = await saveSearchToFirebase(finalQuery, userId, finalRecommendation);

    // Guarda el estado para el siguiente paso (Confirmación de IA)
    conversationState.set(userPhone, {
      state: 'AWAITING_AI_CONFIRMATION',
      results: locallyAnalyzedProducts,
      originalShoppingResults: shoppingResults, // Guardamos los resultados crudos para la IA
      collectionId: collectionId,
      data: searchData
    });

    // Envía el resultado local y la pregunta de confirmación
    let preliminaryResultText = `*Análisis Preliminar para "${query}":*\n\n`;
    preliminaryResultText += `Basado en mi motor de reglas, te recomiendo:\n*${localAnalysis.recomendacion_final}*\n\n`;
    preliminaryResultText += "Top 5 Productos que encontré:\n";
    locallyAnalyzedProducts.slice(0, 5).forEach((p, i) => {
        preliminaryResultText += `${i + 1}. ${p.title} (${p.price})\n`;
    });
    
    const confirmationButtons = [
      { type: 'reply', reply: { id: `ai_confirm:yes`, title: 'Sí, utilizá la IA ✨' } },
      { type: 'reply', reply: { id: `ai_confirm:no`, title: 'No, gracias 👋' } },
    ];
    await sendTextMessage(userPhone, preliminaryResultText);
    await sendReplyButtonsMessage(userPhone, "¿Quieres que mi IA avanzada (Gemini) analice estos productos para darte una recomendación más detallada?", confirmationButtons.slice(0,3));

  } catch (error) {
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
    console.error("Error en executeLocalAnalysisSearch:", error.message);
    await sendTextMessage(userPhone, `Lo siento, ocurrió un error inesperado durante la búsqueda inicial.`);
    conversationState.delete(userPhone);
  }
}

/**
 * PASO 7: Ejecuta el análisis avanzado con Gemini/IA.
 */
export async function executeAdvancedAIAnalysis(userPhone, currentStateData) {
    const { originalShoppingResults, data: searchData, collectionId } = currentStateData;
    const { query } = searchData;
    let thinkingTimeout = null;

    try {
        await sendTextMessage(userPhone, "¡Perfecto! Iniciando el análisis avanzado con IA... Esto puede tardar unos segundos... 🧠");
        thinkingTimeout = setTimeout(() => {
          sendTextMessage(userPhone, "El análisis de IA está tardando un poco más, pero sigo trabajando... 🤓");
        }, 20000);

        const aiAnalysis = await getBestRecommendationFromGemini(query, originalShoppingResults);
        clearTimeout(thinkingTimeout);

        if (!aiAnalysis || !aiAnalysis.productos_analisis) {
          throw new Error("No se pudo obtener un análisis válido de la IA externa.");
        }

        const finalProducts = logicFusion(originalShoppingResults, aiAnalysis).map(p => ({
            ...p,
            isRecommended: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.isRecommended || false,
            pros: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.pros,
            contras: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.contras,
        }));

        // TODO Opcional: Actualizar los productos en Firebase con los datos de la IA
        // await updateProductsInFirebase(collectionId, finalProducts);

        conversationState.set(userPhone, {
            state: 'AWAITING_PRODUCT_SELECTION',
            results: finalProducts,
            collectionId: collectionId,
            data: searchData
        });

        const rows = finalProducts.slice(0, 10).map(prod => ({
          id: `select_product:${prod.product_id}`,
          title: prod.title.substring(0, 24),
          description: `Precio: ${prod.price}`.substring(0, 72)
        }));
        await sendListMessage(userPhone, `Análisis IA para "${query}"`, `¡Listo! Mi recomendación final de IA es:\n\n${aiAnalysis.recomendacion_final}\n\nSelecciona una opción para ver más detalles.`, "Ver Opciones", [{ title: "Productos Analizados por IA", rows }]);

    } catch (error) {
        if (thinkingTimeout) clearTimeout(thinkingTimeout);
        console.error("Error en executeAdvancedAIAnalysis:", error.message);
        await sendTextMessage(userPhone, `Lo siento, ocurrió un error durante el análisis avanzado.`);
        conversationState.delete(userPhone);
    }
}

