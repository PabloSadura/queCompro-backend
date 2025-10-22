import { executeWhatsAppSearch } from '../services/orchestor/whatsapp.orchestrator.js'; 
import { getEnrichedProductDetails } from '../services/search-service/productDetail.service.js'; 
import { sendTextMessage, sendImageMessage, sendReplyButtonsMessage, sendListMessage } from '../services/search-service/whatsapp.service.js'; 

const conversationState = new Map();


function parsePriceFromText(text) {
  // ... (sin cambios)
  const priceRegex = /(\d{1,3}(?:[.,]\d{3})*)/g;
  const numbers = (text.match(priceRegex) || []).map(n => parseInt(n.replace(/[.,]/g, '')));
  if (text.includes("entre") && numbers.length >= 2) return { minPrice: Math.min(...numbers), maxPrice: Math.max(...numbers) };
  if ((text.includes("menos de") || text.includes("hasta")) && numbers.length >= 1) return { maxPrice: numbers[0] };
  if ((text.includes("más de") || text.includes("desde")) && numbers.length >= 1) return { minPrice: numbers[0] };
  return {};
}

async function handleInteractiveReply(userPhone, message, currentStateData) {
  const { results, collectionId, data: searchContext } = currentStateData;
  const replyId = message.interactive.list_reply?.id || message.interactive.button_reply?.id;
  if (!replyId) return;

  const [action, payload] = replyId.split(':');

  const setClosingState = async () => {
    // Pregunta Post-Detalles
    const buttons = [
        { type: 'reply', reply: { id: `post_action:next_option`, title: 'Ver otra opción 📄' } },
        { type: 'reply', reply: { id: `post_action:new_search`, title: 'Buscar algo más 🔎' } },
        { type: 'reply', reply: { id: `post_action:end`, title: 'No, gracias 👋' } },
    ];
    await sendReplyButtonsMessage(userPhone, "¿Qué te pareció este producto? ¿Te gustaría ver otra opción de la lista o buscar algo diferente?", buttons);
    conversationState.set(userPhone, { ...currentStateData, state: 'AWAITING_POST_DETAIL_ACTION' });
  };

  // --- Manejo de Acciones Interactivas ---

  if (action === 'clarify_usage') { // Respuesta a pregunta de aclaración
    searchContext.usage = payload; // Guarda el uso (ej: 'gaming')
    conversationState.set(userPhone, { state: 'AWAITING_BRAND', data: searchContext });
    await sendTextMessage(userPhone, '¡Perfecto! ¿Tienes alguna marca preferida o alguna que quieras evitar? (O escribe "ninguna")');
  } 
  else if (action === 'add_filter') { // Respuesta a filtros adicionales
    if (payload === 'rating') {
      searchContext.ratingFilter = true; // Marca para añadir tbs=rt:4.5
    }
    // Si elige 'features', pedimos la característica
    if (payload === 'features') {
        conversationState.set(userPhone, { state: 'AWAITING_FEATURE_KEYWORD', data: searchContext });
        await sendTextMessage(userPhone, 'Ok, dime qué característica es importante para ti (ej: "resistente al agua", "pantalla OLED", "16GB RAM").');
    } else {
        // Si no es 'features' o elige 'buscar ahora', iniciamos la búsqueda
        conversationState.set(userPhone, { state: 'SEARCHING', data: searchContext });
        executeWhatsAppSearch(userPhone, searchContext, conversationState);
    }
  }
  else if (action === 'select_product') { // Selección de producto de la lista
    const product = results?.find(p => p.product_id == payload);
    if (!product) return;
    await sendTextMessage(userPhone, `Buscando detalles para *${product.title}*...`);
    try {
      const enrichedProduct = await getEnrichedProductDetails(collectionId, payload);
      if (!enrichedProduct) throw new Error("Producto no enriquecido.");
      const updatedResults = results.map(p => p.product_id == payload ? enrichedProduct : p);
      conversationState.set(userPhone, { ...currentStateData, results: updatedResults });
      const buttons = [ /* Botones: Pros/Contras, Tiendas, Características, Imágenes */ ];
      await sendReplyButtonsMessage(userPhone, `¡Listo! Seleccionaste: *${product.title}*.\n\n¿Qué te gustaría ver?`, buttons);
    } catch (error) { /* ... manejo de error ... */ }
  }
  else if (action.startsWith('show_')) { // Acciones para mostrar detalles
      const product = Array.isArray(results) ? results.find(p => p.product_id == payload) : null;
      if (!product) { /* ... manejo si no encuentra producto ... */ return; }

      if (action === 'show_details') { /* ... enviar pros/contras ... */ }
      else if (action === 'show_stores') { /* ... enviar tiendas ... */ }
      else if (action === 'show_features') { /* ... enviar características ... */ }
      else if (action === 'show_images') { /* ... enviar imágenes ... */ }
      await setClosingState(); // Llama a la nueva pregunta post-detalles
  }
  else if (action === 'post_action') { // Acciones después de ver detalles
      if (payload === 'next_option') {
          // Lógica para mostrar el siguiente producto o volver a la lista (simplificado)
          await sendTextMessage(userPhone, "Lo siento, la opción 'Ver otra opción' aún no está implementada. ¿Quieres buscar algo más?");
          conversationState.set(userPhone, { state: 'AWAITING_QUERY' });
      } else if (payload === 'new_search') {
          conversationState.set(userPhone, { state: 'AWAITING_QUERY' });
          await sendTextMessage(userPhone, "¿Qué otro producto te gustaría buscar?");
      } else if (payload === 'end') {
          await sendTextMessage(userPhone, "¡De nada! Estoy aquí si necesitas algo más. 😊");
          conversationState.delete(userPhone);
      }
  }
}

/**
 * Controlador principal del webhook
 */
export async function handleWhatsAppWebhook(req, res) {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return res.sendStatus(200);
  res.sendStatus(200);

  const userPhone = message.from;
  const currentStateData = conversationState.get(userPhone) || { state: 'GREETING', data: {} };

  if (message.type === 'interactive') {
    handleInteractiveReply(userPhone, message, currentStateData);
    return;
  }

  if (message.type === 'text') {
    const userText = message.text.body.toLowerCase();
    const currentSearchData = currentStateData.data || {};

    // Manejo del cierre explícito
    if (currentStateData.state === 'AWAITING_CLOSING' || currentStateData.state === 'AWAITING_POST_DETAIL_ACTION') {
      const negativeKeywords = ['no', 'gracias', 'nada mas', 'eso es todo', 'chau'];
      if (negativeKeywords.some(keyword => userText.includes(keyword))) {
        await sendTextMessage(userPhone, "¡De nada! Estoy aquí si necesitas algo más. 😊");
        conversationState.delete(userPhone);
        return;
      }
      // Si no es negativo, asumimos que es una nueva búsqueda
      conversationState.set(userPhone, { state: 'SEARCHING', data: { query: message.text.body, userId: userPhone } });
      executeWhatsAppSearch(userPhone, conversationState.get(userPhone).data, conversationState);
      return;
    }

    switch (currentStateData.state) {
      case 'AWAITING_QUERY':
        // Comprobar si la consulta es ambigua (ej. solo "notebook")
        if (userText === 'notebook' || userText === 'laptop') {
            conversationState.set(userPhone, { state: 'AWAITING_CLARIFICATION', data: { query: userText, userId: userPhone } });
            const buttons = [
                { type: 'reply', reply: { id: `clarify_usage:work`, title: 'Trabajo/Estudio 🧑‍💻' } },
                { type: 'reply', reply: { id: `clarify_usage:gaming`, title: 'Gaming 🎮' } },
                { type: 'reply', reply: { id: `clarify_usage:portable`, title: 'Liviana/Portátil 🎒' } },
                // Limitamos a 3 botones
            ];
            await sendReplyButtonsMessage(userPhone, `Entendido, buscas '${userText}'. Para darte mejores recomendaciones, ¿podrías decirme un poco más? 🤔 ¿La necesitas para algo en particular?`, buttons);
        } else {
            // Si no es ambigua, pasamos a preguntar por la marca
            conversationState.set(userPhone, { state: 'AWAITING_BRAND', data: { query: message.text.body, userId: userPhone } });
            await sendTextMessage(userPhone, '¡Perfecto! ¿Tienes alguna marca preferida o alguna que quieras evitar? (O escribe "ninguna")');
        }
        break;
      
      case 'AWAITING_BRAND':
        if (userText !== 'ninguna') {
            currentSearchData.brandPreference = userText; // Guarda la preferencia de marca
        }
        conversationState.set(userPhone, { state: 'AWAITING_PRICE_RANGE', data: currentSearchData });
        await sendTextMessage(userPhone, `¡Anotado! ¿Tienes algún rango de precios en mente? (ej: "hasta 150000", o "no")`);
        break;

      case 'AWAITING_PRICE_RANGE':
        const priceData = parsePriceFromText(userText);
        const searchDataWithPrice = { ...currentSearchData, ...priceData };
        conversationState.set(userPhone, { state: 'AWAITING_EXTRA_FILTERS', data: searchDataWithPrice });
        // Pregunta por filtros adicionales
        const filterButtons = [
            { type: 'reply', reply: { id: `add_filter:rating`, title: 'Mejor Valoración ⭐' } },
            { type: 'reply', reply: { id: `add_filter:features`, title: 'Caract. Clave ✨' } },
            { type: 'reply', reply: { id: `add_filter:search_now`, title: 'Buscar Ahora 🚀' } },
        ];
        await sendReplyButtonsMessage(userPhone, "Perfecto. Antes de buscar, ¿quieres que filtre por algo más?", filterButtons);
        break;
        
      case 'AWAITING_FEATURE_KEYWORD':
        currentSearchData.featureKeyword = userText; // Guarda la característica clave
        conversationState.set(userPhone, { state: 'SEARCHING', data: currentSearchData });
        executeWhatsAppSearch(userPhone, currentSearchData, conversationState);
        break;

      default: // GREETING u otro estado
        if (['hola', 'hey', 'buenas'].includes(userText)) {
          conversationState.set(userPhone, { state: 'AWAITING_QUERY' });
          await sendTextMessage(userPhone, "¡Hola! 👋 Soy tu asistente de compras. ¿Qué producto buscas hoy? _Te hare algunas preguntas extras para poder ayudarte mejor_ 😉");
        } else {
          // Búsqueda directa (menos conversacional pero funcional)
          const directSearchData = { query: message.text.body, userId: userPhone };
          conversationState.set(userPhone, { state: 'SEARCHING', data: directSearchData });
          executeWhatsAppSearch(userPhone, directSearchData, conversationState);
        }
        break;
    }
  }
}


/**
 * Verificación del Webhook.
 */
export function verifyWhatsAppWebhook(req, res) {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

