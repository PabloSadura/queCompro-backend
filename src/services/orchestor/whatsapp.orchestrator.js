// Importamos el orquestador principal que contiene la lógica de búsqueda
import { performSearchLogic as runSearchAndRecommendation} from './search.orchestrator.js'; // Ajusta la ruta si es necesario
// Importamos los servicios de envío de WhatsApp
import { sendTextMessage, sendListMessage } from '../search-service/whatsapp.service.js'; // Ajusta la ruta si es necesario

/**
 * Orquesta el flujo completo de una búsqueda de producto iniciada desde WhatsApp.
 * Ahora acepta más parámetros de búsqueda recolectados en la conversación.
 * @param {string} userPhone - El número de teléfono del usuario.
 * @param {object} searchData - Contiene query, userId, minPrice, maxPrice, usage, brandPreference, ratingFilter, featureKeyword.
 * @param {Map} conversationState - El mapa del estado de la conversación para guardar el resultado.
 */
export async function executeWhatsAppSearch(userPhone, searchData, conversationState) {
  let thinkingTimeout = null;
  try {
    const {
        query,
        userId, // Asegúrate de que el userId se pase correctamente desde el controller
        minPrice,
        maxPrice,
        usage, // Uso específico (ej: gaming)
        brandPreference, // Marca preferida/evitada
        ratingFilter, // Booleano para filtrar por rating
        featureKeyword // Palabra clave de característica
    } = searchData;

    // --- Construcción de la Consulta Enriquecida ---
    let finalQuery = query;
    if (usage) finalQuery += ` para ${usage}`;
    if (brandPreference && brandPreference.toLowerCase() !== 'ninguna') {
        finalQuery += ` ${brandPreference}`; // Podría mejorarse para manejar exclusión ("evitar X")
    }
    if (featureKeyword) finalQuery += ` ${featureKeyword}`;
    // --- Fin Construcción ---

    let searchingText = `¡Entendido! Buscando "${finalQuery}"`; // Usamos la query enriquecida
    if (maxPrice) searchingText += ` hasta $${maxPrice}`;
    if (minPrice) searchingText += ` desde $${minPrice}`;
    if (ratingFilter) searchingText += ` con buena valoración`;
    searchingText += `... 🕵️‍♂️`;

    await sendTextMessage(userPhone, searchingText);

    thinkingTimeout = setTimeout(() => {
      sendTextMessage(userPhone, "El análisis está tardando un poco más de lo normal, pero sigo trabajando en ello... 🤓");
    }, 20000); // 20 segundos

    // --- DELEGACIÓN AL ORQUESTADOR PRINCIPAL ---
    // Pasamos todos los datos recolectados, incluyendo los nuevos filtros
    const searchResult = await runSearchAndRecommendation({
      query: finalQuery, // Usamos la query enriquecida
      userId,
      minPrice,
      maxPrice,
      countryCode: 'ar', // Fijo para WhatsApp por ahora
      languageCode: 'es',// Fijo para WhatsApp por ahora
      currency: 'ARS',   // Fijo para WhatsApp por ahora
      ratingFilter // Pasamos el filtro de rating si el usuario lo seleccionó
    });
    // --- Fin Delegación ---

    clearTimeout(thinkingTimeout);

    // Guarda el resultado en el estado de la conversación para usarlo en handleInteractiveReply
    conversationState.set(userPhone, {
      state: 'AWAITING_PRODUCT_SELECTION',
      results: searchResult.productos, // Array de productos ya analizados y marcados
      collectionId: searchResult.id,   // ID de la búsqueda guardada
      data: searchData // Guardamos los criterios originales por si los necesitamos
    });

    // Formatea y envía una lista interactiva al usuario
    const rows = searchResult.productos.slice(0, 10).map(prod => ({ // WhatsApp soporta máx 10 items en lista
      id: `select_product:${prod.product_id}`,
      title: prod.title.substring(0, 24), // Título corto para la lista
      description: `Precio: ${prod.price}`.substring(0, 72) // Descripción corta
    }));

    await sendListMessage(userPhone, `Análisis para "${query}"`, `¡Listo! Mi recomendación principal es:\n\n${searchResult.recomendacion_final}\n\nSelecciona una opción para ver más detalles.`, "Ver Opciones", [{ title: "Productos Recomendados", rows }]);

  } catch (error) {
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
    console.error("Error en executeWhatsAppSearch:", error.message);
    await sendTextMessage(userPhone, `Lo siento, ocurrió un error inesperado durante la búsqueda: ${error.message}`);
    // Limpiamos el estado si la búsqueda falla para evitar bucles
    conversationState.delete(userPhone);
  }
}

/**
 * Ejecuta el análisis avanzado con la IA externa (Gemini/OpenAI).
 * Esta función se llama desde el controlador cuando el usuario confirma.
 */
export async function executeAdvancedAIAnalysis(userPhone, currentStateData) {
    const { originalShoppingResults, data: searchData, collectionId } = currentStateData;
    const { query } = searchData; // Usa la query original para la IA
    let thinkingTimeout = null;

    try {
        await sendTextMessage(userPhone, "¡Perfecto! Iniciando el análisis avanzado con IA... Esto puede tardar unos segundos... 🧠");
        thinkingTimeout = setTimeout(() => {
          sendTextMessage(userPhone, "El análisis IA está tardando un poco más, pero sigo trabajando... 🤓");
        }, 20000); // 20 segundos

        // Llama al servicio de IA externo (Gemini con fallback)
        // Le pasamos los resultados ORIGINALES de shopping
        const aiAnalysis = await getBestRecommendationFromAI(query, originalShoppingResults);

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

        // Actualiza Firebase con los detalles de la IA (opcional, pero recomendado)
        // await updateProductsInFirebase(collectionId, finalProducts); // Necesitarías esta función

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

