import { executeWhatsAppSearch } from '../services/orchestor/whatsapp.orchestrator.js';
import { getProductById } from './productDetails.controller.js'; 
import { sendTextMessage, sendImageMessage, sendReplyButtonsMessage } from '../services/search-service/whatsapp.service.js'
import { getEnrichedProductDetails } from '../services/search-service/productDetail.service.js';
const conversationState = new Map();


function parsePriceFromText(text) {
  const priceRegex = /(\d{1,3}(?:[.,]\d{3})*)/g;
  const numbers = (text.match(priceRegex) || []).map(n => parseInt(n.replace(/[.,]/g, '')));
  
  if (text.includes("entre") && numbers.length >= 2) return { minPrice: Math.min(...numbers), maxPrice: Math.max(...numbers) };
  if ((text.includes("menos de") || text.includes("hasta")) && numbers.length >= 1) return { maxPrice: numbers[0] };
  if ((text.includes("más de") || text.includes("desde")) && numbers.length >= 1) return { minPrice: numbers[0] };
  return {};
}

async function handleInteractiveReply(userPhone, message, currentStateData) {
  const { results, collectionId } = currentStateData;
  const replyId = message.interactive.list_reply?.id || message.interactive.button_reply?.id;
  if (!replyId) return;

  const [action, payload] = replyId.split(':');
  
  const setClosingState = async () => {
    await sendTextMessage(userPhone, "¿Puedo ayudarte en algo más?");
    conversationState.set(userPhone, { ...currentStateData, state: 'AWAITING_CLOSING' });
  };
  
  if (action === 'select_product') {
    const product = results?.find(p => p.product_id == payload);
    
    if (!product) return;
    await sendTextMessage(userPhone, `Buscando detalles para *${product.title}*...`);
    try {

      const enrichedProduct = await getEnrichedProductDetails(collectionId, payload);
      
      if (!enrichedProduct) throw new Error("El servicio no devolvió un producto enriquecido.");

      conversationState.set(userPhone, { ...currentStateData, results: enrichedProduct });

      const buttons = [
        { type: 'reply', reply: { id: `show_details:${payload}`, title: 'Pros y Contras' } },
        { type: 'reply', reply: { id: `show_stores:${payload}`, title: 'Opciones de Compra' } },
        { type: 'reply', reply: { id: `show_images:${payload}`, title: 'Ver Imágenes' } },
      ];
      await sendReplyButtonsMessage(userPhone, `¡Listo! Seleccionaste: *${product.title}*.\n\n¿Qué te gustaría ver?`, buttons);

    } catch (error) {
      console.error("Error al obtener detalles inmersivos:", error);
      await sendTextMessage(userPhone, "Lo siento, no pude obtener los detalles completos para este producto.");
    }
  } 
  else {
    const product = results?.find(p => p.product_id == payload);
    if (!product) return;
    
    if (action === 'show_details') {
      let detailsText = `*Análisis para ${product.title}*:\n\n*✅ PROS:*\n${product.pros?.map(p => `- ${p}`).join('\n') || "No disponibles"}\n\n*❌ CONTRAS:*\n${product.contras?.map(c => `- ${c}`).join('\n') || "No disponibles"}`;
      await sendTextMessage(userPhone, detailsText);
      await setClosingState();
    } else if (action === 'show_stores') {
      let storesText = `*Opciones de Compra para ${product.title}:*\n\n`;
      const stores = product.immersive_details?.stores;
      if (stores && Array.isArray(stores) && stores.length > 0) {
        stores.forEach((link, index) => { storesText += `${index + 1}. ${link}\n`; });
      } else { storesText = "Lo siento, no encontré opciones de compra para este producto."; }
      await sendTextMessage(userPhone, storesText);
      await setClosingState();
    } else if (action === 'show_images') {
      await sendTextMessage(userPhone, `Aquí tienes las imágenes para *${product.title}*:`);
      const images = product.immersive_details?.thumbnails || [product.thumbnail];
      if (images && images.length > 0) {
        for (const img of images.slice(0, 4)) { if (img) await sendImageMessage(userPhone, img); }
      } else { await sendTextMessage(userPhone, "Lo siento, no encontré imágenes adicionales."); }
      await setClosingState();
    }
  }
}

/**
 * Controlador principal del webhook que actúa como router conversacional.
 */
export async function handleWhatsAppWebhook(req, res) {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return res.sendStatus(200);
  res.sendStatus(200);

  const userPhone = message.from;
  const currentStateData = conversationState.get(userPhone) || { state: 'GREETING' };

  if (message.type === 'interactive') {
    handleInteractiveReply(userPhone, message, currentStateData);
    return;
  }

  if (message.type === 'text') {
    const userText = message.text.body.toLowerCase();
    if (currentStateData.state === 'AWAITING_CLOSING') {
      const negativeKeywords = ['no', 'gracias', 'nada mas', 'eso es todo', 'chau'];
      if (negativeKeywords.some(keyword => userText.includes(keyword))) {
        await sendTextMessage(userPhone, "¡De nada! Estoy aquí si necesitas algo más. 😊");
        conversationState.delete(userPhone);
        return;
      }
    }

    switch (currentStateData.state) {
      case 'AWAITING_QUERY':
        conversationState.set(userPhone, { state: 'AWAITING_PRICE_RANGE', data: { query: message.text.body, userId: userPhone } });
        await sendTextMessage(userPhone, `¡Entendido! ¿Tienes algún rango de precios en mente? (ej: "hasta 150000", o "no")`);
        break;
      
      case 'AWAITING_PRICE_RANGE':
        const priceData = parsePriceFromText(userText);
        const searchData = { ...currentStateData.data, ...priceData };
        conversationState.set(userPhone, { state: 'SEARCHING' });
        executeWhatsAppSearch(userPhone, searchData, conversationState);
        break;

      default:
        if (['hola', 'hey', 'buenas'].includes(userText)) {
          conversationState.set(userPhone, { state: 'AWAITING_QUERY' });
          await sendTextMessage(userPhone, "¡Hola! 👋 Soy tu asistente de compras. ¿Qué producto te gustaría que analice por ti?");
        } else {
          conversationState.set(userPhone, { state: 'SEARCHING' });
          executeWhatsAppSearch(userPhone, { query: message.text.body, userId: userPhone }, conversationState);
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

