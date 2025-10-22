// ✅ Importamos el servicio de IA y el análisis local
import { getBestRecommendationFromGemini } from '../search-service/geminiService.service.js';
import { analyzeShoppingResults } from '../search-service/ia.service.js';
// Resto de importaciones
import { fetchGoogleShoppingResults } from '../search-service/googleSopphing.service.js';
import { saveSearchToFirebase } from '../search-service/firebaseService.service.js';
import logicFusion from '../../controllers/logis.controller.js';
import { sendTextMessage, sendReplyButtonsMessage, sendListMessage } from '../search-service/whatsapp.service.js';

/**
 * Orquesta el flujo inicial de búsqueda: obtiene resultados de Shopping y realiza el análisis local.
 * Luego pregunta al usuario si desea un análisis más profundo con IA.
 */
export async function executeWhatsAppSearch(userPhone, searchData, conversationState) {
  let initialSearchTimeout = null;
  try {
    const { query, minPrice, maxPrice, userId, usage, brandPreference, ratingFilter, featureKeyword } = searchData;
    let finalQuery = query;
    // ... (construcción de finalQuery como antes) ...
    if (usage) finalQuery += ` para ${usage}`;
    if (brandPreference && brandPreference.toLowerCase() !== 'ninguna') finalQuery += ` ${brandPreference}`;
    if (featureKeyword) finalQuery += ` ${featureKeyword}`;

    await sendTextMessage(userPhone, `¡Entendido! Buscando "${finalQuery}"... 🕵️‍♂️`);

    // 1. Obtener resultados de Google Shopping
    const { products: shoppingResults, totalResults } = await fetchGoogleShoppingResults(
        userId, finalQuery, 'ar', 'es', 'ARS', minPrice, maxPrice, ratingFilter
    );

    if (!shoppingResults || shoppingResults.length === 0) {
      await sendTextMessage(userPhone, "Lo siento, no encontré productos con esos criterios.");
      conversationState.delete(userPhone);
      return;
    }

    // 2. Ejecutar el ANÁLISIS LOCAL con el motor de reglas
    await sendTextMessage(userPhone, "Encontré varios productos. Realizando un análisis rápido...");
    const localAnalysis = analyzeShoppingResults(finalQuery, shoppingResults);

    if (!localAnalysis || !localAnalysis.productos_analisis || localAnalysis.productos_analisis.length === 0) {
        await sendTextMessage(userPhone, "No pude realizar un análisis preliminar. ¿Quieres intentar con otra búsqueda?");
        conversationState.delete(userPhone);
        return;
    }

    // 3. Fusionar resultados de Shopping con el análisis local para tener todos los datos
    const locallyAnalyzedProducts = logicFusion(shoppingResults, localAnalysis);

    // 4. Guardar ESTE resultado preliminar en Firebase
    const preliminarySaveData = {
        recomendacion_final: localAnalysis.recomendacion_final,
        productos: locallyAnalyzedProducts,
        total_results: totalResults,
    };
    const { id: collectionId } = await saveSearchToFirebase(finalQuery, userId, preliminarySaveData);

    // 5. Preparar mensaje con resultados preliminares y pregunta de confirmación
    let preliminaryResultText = `*Análisis Preliminar para "${query}":*\n\n`;
    preliminaryResultText += `Basado en reglas, te recomiendo:\n*${localAnalysis.recomendacion_final}*\n\n`;
    preliminaryResultText += "Top 5 Productos:\n";
    locallyAnalyzedProducts.slice(0, 5).forEach((p, i) => {
        preliminaryResultText += `${i + 1}. ${p.title} (${p.price})\n`;
    });

    // Guarda el estado actual Y los productos analizados localmente
    conversationState.set(userPhone, {
      state: 'AWAITING_AI_CONFIRMATION',
      results: locallyAnalyzedProducts, // Productos con análisis local
      originalShoppingResults: shoppingResults, // Guardamos los resultados originales por si los necesita la IA
      collectionId: collectionId,
      data: searchData
    });

    // 6. Enviar mensaje con botones de Sí/No
    const confirmationButtons = [
      { type: 'reply', reply: { id: `ai_confirm:yes`, title: 'Sí, analizar con IA ✨' } },
      { type: 'reply', reply: { id: `ai_confirm:no`, title: 'No, gracias 👋' } },
    ];
    await sendTextMessage(userPhone, preliminaryResultText);
    await sendReplyButtonsMessage(userPhone, "¿Quieres que mi IA avanzada analice estos productos para darte una recomendación más detallada con Pros y Contras?", confirmationButtons);

  } catch (error) {
    console.error("Error en executeWhatsAppSearch (paso 1):", error.message);
    await sendTextMessage(userPhone, `Lo siento, ocurrió un error inesperado durante la búsqueda inicial.`);
    conversationState.delete(userPhone);
  }
}

/**
 * Ejecuta el análisis avanzado con la IA externa (Gemini/OpenAI).
 */
export async function executeAdvancedAIAnalysis(userPhone, currentStateData) {
  const { originalShoppingResults, data: searchData, collectionId } = currentStateData;
  const { query } = searchData;
  let thinkingTimeout = null;

  try {
    await sendTextMessage(userPhone, "¡Perfecto! Iniciando el análisis avanzado con IA... Esto puede tardar unos segundos... 🧠");

    thinkingTimeout = setTimeout(() => {
      sendTextMessage(userPhone, "El análisis IA está tardando un poco más, pero sigo trabajando... 🤓");
    }, 20000);

    // ✅ Llama al servicio de IA externo (CORREGIDO EL NOMBRE)
    const aiAnalysis = await getBestRecommendationFromGemini(query, originalShoppingResults);

    clearTimeout(thinkingTimeout);

    if (!aiAnalysis || !aiAnalysis.productos_analisis) {
      throw new Error("No se pudo obtener un análisis válido de la IA externa.");
    }

    // Fusiona los resultados originales con el análisis PROFUNDO de la IA
    const finalProducts = logicFusion(originalShoppingResults, aiAnalysis).map(p => ({
        ...p,
        isRecommended: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.isRecommended || false,
         // Añadimos pros/contras de la IA
        pros: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.pros,
        contras: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.contras,
    }));

    // Actualiza los productos en Firebase con los detalles de la IA (opcional, pero recomendado)
    // Podrías necesitar una función 'updateProductsInFirebase(collectionId, finalProducts)'
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

    await sendListMessage(userPhone, `Análisis IA para "${query}"`, `¡Listo! Mi recomendación final es:\n\n${aiAnalysis.recomendacion_final}\n\nSelecciona una opción para ver más detalles.`, "Ver Opciones", [{ title: "Productos Analizados por IA", rows }]);

  } catch (error) {
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
    console.error("Error en executeAdvancedAIAnalysis:", error.message);
    await sendTextMessage(userPhone, `Lo siento, ocurrió un error durante el análisis avanzado.`);
    conversationState.delete(userPhone); // Limpia estado en caso de error grave
  }
}

