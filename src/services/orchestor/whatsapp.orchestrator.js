// ✅ Importamos TODOS los servicios necesarios
import { getBestRecommendationFromGemini } from '../search-service/geminiService.service.js';
import { analyzeShoppingResults } from '../search-service/ia.service.js';
import { structureProductDataWithAI } from '../search-service/geminiClean.service.js'; // El nuevo servicio de limpieza
import { fetchGoogleShoppingResults } from '../search-service/googleSopphing.service.js';
import { saveSearchToFirebase } from '../search-service/firebaseService.service.js';
import logicFusion from '../../controllers/logis.controller.js';
import { sendTextMessage, sendReplyButtonsMessage, sendListMessage } from '../search-service/whatsapp.service.js';

/**
 * PASO 5: Busca, limpia con IA, analiza con motor de reglas local y pregunta.
 */
export async function executeWhatsAppSearch(userPhone, searchData, conversationState) {
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
    if (featureKeyword) {
        finalQuery += ` ${featureKeyword}`;
    }
    
    let searchingText = `¡Entendido! Buscando "${finalQuery}"`;
    if (maxPrice) searchingText += ` hasta $${maxPrice}`;
    if (minPrice) searchingText += ` desde $${minPrice}`;
    if (ratingFilter) searchingText += ` con buena valoración`;
    searchingText += `... 🕵️‍♂️`;
    
    await sendTextMessage(userPhone, searchingText);

    // 1. Obtener resultados "sucios" de Google Shopping
    const { products: shoppingResults, totalResults } = await fetchGoogleShoppingResults(
        userId, finalQuery, 'ar', 'es', 'ARS', minPrice, maxPrice, ratingFilter
    );

    if (!shoppingResults || shoppingResults.length === 0) {
      await sendTextMessage(userPhone, "Lo siento, no encontré productos con esos criterios.");
      conversationState.delete(userPhone);
      return;
    }

    await sendTextMessage(userPhone, "Encontré varios productos. Limpiando y estructurando datos con IA...");

    // 2. NUEVO PASO: Limpiar y estructurar los datos con la IA
    const structuredProducts = await structureProductDataWithAI(shoppingResults);

    await sendTextMessage(userPhone, "Realizando análisis rápido con motor de reglas...");

    // 3. CORRECCIÓN: Pasamos 'structuredProducts' y 'category'
    const localAnalysis = analyzeShoppingResults(finalQuery, shoppingResults, structuredProducts, category);
    
    if (!localAnalysis || !localAnalysis.productos_analisis || localAnalysis.productos_analisis.length === 0) {
        await sendTextMessage(userPhone, "No pude realizar un análisis preliminar. ¿Quieres intentar con otra búsqueda?");
        conversationState.delete(userPhone);
        return;
    }

    // 4. Fusionar resultados (logicFusion usa el análisis para obtener pros/contras)
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
    
    // 5. Guardar resultado preliminar en Firebase
    const { id: collectionId } = await saveSearchToFirebase(finalQuery, userId, finalRecommendation);

    // 6. Guardar estado para el siguiente paso (Confirmación de IA)
    conversationState.set(userPhone, { 
      state: 'AWAITING_AI_CONFIRMATION', 
      results: locallyAnalyzedProducts, // Productos con análisis local
      originalShoppingResults: shoppingResults, // Guardamos los resultados crudos para la IA
      collectionId: collectionId,
      data: searchData 
    });

    // 7. Enviar resultado local y pregunta de confirmación
    let preliminaryResultText = `*Análisis Preliminar para "${query}":*\n\n`;
    preliminaryResultText += `Basado en mi motor de reglas, te recomiendo:\n*${localAnalysis.recomendacion_final}*\n\n`;
    preliminaryResultText += "Top 5 Productos que encontré:\n";
    locallyAnalyzedProducts.slice(0, 5).forEach((p, i) => {
        preliminaryResultText += `${i + 1}. ${p.title} (${p.price})\n`;
    });
    
    const confirmationButtons = [
      { type: 'reply', reply: { id: `ai_confirm:yes`, title: 'Sí, analizar con IA ✨' } },
      { type: 'reply', reply: { id: `ai_confirm:no`, title: 'No, gracias 👋' } },
    ];
    await sendTextMessage(userPhone, preliminaryResultText);
    await sendReplyButtonsMessage(userPhone, "¿Quieres que mi IA avanzada (Gemini) analice estos productos para darte una recomendación más detallada?", confirmationButtons.slice(0,3));

  } catch (error) {
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
    console.error("Error en executeLocalAnalysisSearch (análisis local):", error.message);
    await sendTextMessage(userPhone, `Lo siento, ocurrió un error inesperado durante la búsqueda inicial.`);
    conversationState.delete(userPhone);
  }
}

/**
 * PASO 7: Ejecuta el análisis avanzado con Gemini/IA.
 */
export async function executeAdvancedAIAnalysis(userPhone, currentStateData) {
    // Obtenemos los resultados ORIGINALES que guardamos, no los analizados localmente
    const { originalShoppingResults, data: searchData, collectionId } = currentStateData;
    const { query } = searchData;
    let thinkingTimeout = null;

    try {
        await sendTextMessage(userPhone, "¡Perfecto! Iniciando el análisis avanzado con IA... Esto puede tardar unos segundos... 🧠");
        thinkingTimeout = setTimeout(() => {
          sendTextMessage(userPhone, "El análisis de IA está tardando un poco más, pero sigo trabajando... 🤓");
        }, 20000);

        // Llama al servicio de IA externo (Gemini con fallback)
        const aiAnalysis = await getBestRecommendationFromGemini(query, originalShoppingResults);
        clearTimeout(thinkingTimeout);

        if (!aiAnalysis || !aiAnalysis.productos_analisis) {
          throw new Error("No se pudo obtener un análisis válido de la IA externa.");
        }

        // Fusiona los resultados originales con el análisis PROFUNDO de la IA
        const finalProducts = logicFusion(originalShoppingResults, aiAnalysis).map(p => ({
            ...p,
            isRecommended: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.isRecommended || false,
            pros: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.pros,
            contras: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.contras,
        }));

        // Opcional: Actualizar los productos en Firebase con los datos de la IA
        // await updateProductsInFirebase(collectionId, finalProducts);

        // Guarda el resultado final en el estado
        conversationState.set(userPhone, {
            state: 'AWAITING_PRODUCT_SELECTION',
            results: finalProducts, // Ahora guarda los productos analizados por la IA
            collectionId: collectionId,
            data: searchData
        });

        // Envía la lista interactiva con los resultados finales
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

