import { getBestRecommendationFromGemini } from '../services/search-service/geminiService.js';
import { fetchGoogleShoppingResults } from '../services/search-service/googleSopphing.js';
import { saveSearchToFirebase } from '../services/search-service/firebaseService.js';
import { getProductById } from './productDetails.controllers.js'; 
import logicFusion from './logis.controller.js';
import axios from 'axios';

// --- Tus variables de entorno ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

// --- GESTIÓN DE ESTADO DE CONVERSACIÓN ---
const conversationState = new Map();

// --- FUNCIONES AUXILIARES DE ENVÍO ---
function normalizePhoneNumber(phone) {
  if (phone.startsWith('549') && phone.length === 13) {
    return '54' + phone.substring(3);
  }
  return phone;
}

async function sendWhatsAppRequest(requestBody) {
  const recipientNumber = normalizePhoneNumber(requestBody.to);
  const finalBody = { ...requestBody, to: recipientNumber };
  try {
    await axios.post(WHATSAPP_API_URL, finalBody, {
      headers: { 
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error("❌ Error al enviar mensaje de WhatsApp:", error.response?.data || error.message);
  }
}

function sendTextMessage(to, text) {
  return sendWhatsAppRequest({ to, type: "text", text: { body: text }, messaging_product: "whatsapp" });
}

function sendImageMessage(to, imageUrl, caption = '') {
  return sendWhatsAppRequest({ to, type: "image", image: { link: imageUrl, caption }, messaging_product: "whatsapp" });
}

function sendListMessage(to, headerText, bodyText, buttonText, sections) {
  return sendWhatsAppRequest({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: headerText },
      body: { text: bodyText },
      action: { button: buttonText, sections },
    },
    messaging_product: "whatsapp"
  });
}

function sendReplyButtonsMessage(to, bodyText, buttons) {
  return sendWhatsAppRequest({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: { buttons },
    },
    messaging_product: "whatsapp"
  });
}

// --- LÓGICA DE BÚSQUEDA Y ENRIQUECIMIENTO ---

async function executeSearch(userPhone, searchData) {
  let thinkingTimeout = null;
  try {
    const { query, minPrice, maxPrice, userId } = searchData;
    await sendTextMessage(userPhone, `¡Entendido! Buscando "${query}"... 🕵️‍♂️`);
    
    const { products: shoppingResults, totalResults } = await fetchGoogleShoppingResults(null, query, 'ar', 'es', 'ARS', minPrice, maxPrice);
    if (!shoppingResults || shoppingResults.length === 0) {
      await sendTextMessage(userPhone, "Lo siento, no encontré productos con esos criterios.");
      conversationState.delete(userPhone);
      return;
    }

    await sendTextMessage(userPhone, "Encontré varios productos. Ahora, mi IA los está analizando... 🧠");

    thinkingTimeout = setTimeout(() => {
      sendTextMessage(userPhone, "El análisis está tardando un poco más de lo normal, pero sigo trabajando en ello... 🤓");
    }, 10000);

    const aiAnalysis = await getBestRecommendationFromGemini(query, shoppingResults);
    
    clearTimeout(thinkingTimeout);
    
    const productosRecomendados = logicFusion(shoppingResults, aiAnalysis).map(p => ({
        ...p,
        isRecommended: aiAnalysis.productos_analisis.find(a => a.product_id === p.product_id)?.isRecommended || false
    }));

    const finalRecommendation = {
        recomendacion_final: aiAnalysis.recomendacion_final,
        productos: productosRecomendados,
        total_results: totalResults,
    };
    
    const { id: collectionId } = await saveSearchToFirebase(query, userId, finalRecommendation);
    conversationState.set(userPhone, { state: 'AWAITING_PRODUCT_SELECTION', results: productosRecomendados, collectionId });

    const rows = productosRecomendados.slice(0, 10).map(prod => ({
      id: `select_product:${prod.product_id}`,
      title: prod.title.substring(0, 24),
      description: `Precio: ${prod.price}`.substring(0, 72)
    }));

    await sendListMessage(userPhone, `Análisis para "${query}"`, `¡Listo! Mi recomendación principal es:\n\n${aiAnalysis.recomendacion_final}\n\nSelecciona una opción para ver más detalles.`, "Ver Opciones", [{ title: "Productos Recomendados", rows }]);

  } catch (error) {
    if (thinkingTimeout) clearTimeout(thinkingTimeout);
    console.error("Error en executeSearch:", error);
    await sendTextMessage(userPhone, "Lo siento, ocurrió un error inesperado durante la búsqueda.");
    conversationState.delete(userPhone);
  }
}

// --- LÓGICA CONVERSACIONAL (ROUTER) ---

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
    const product = results?.find(p => p.product_id === payload);
    if (!product) return;
    await sendTextMessage(userPhone, `Buscando detalles para *${product.title}*...`);
    try {
      let enrichedProduct;
      const mockReq = { params: { idCollection: collectionId, idProduct: payload } };
      const mockRes = {
        status: () => mockRes,
        json: (data) => { enrichedProduct = data; }
      };
      await getProductById(mockReq, mockRes);
      
      const updatedResults = results.map(p => p.product_id === payload ? enrichedProduct : p);
      conversationState.set(userPhone, { ...currentStateData, results: updatedResults });

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
    const product = results?.find(p => p.product_id === payload);
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
        executeSearch(userPhone, searchData);
        break;
      default:
        if (['hola', 'hey', 'buenas'].includes(userText)) {
          conversationState.set(userPhone, { state: 'AWAITING_QUERY' });
          await sendTextMessage(userPhone, "¡Hola! 👋 Soy tu asistente de compras. ¿Qué producto te gustaría que analice por ti?");
        } else {
          conversationState.set(userPhone, { state: 'SEARCHING' });
          executeSearch(userPhone, { query: message.text.body, userId: userPhone });
        }
        break;
    }
  }
}

export function verifyWhatsAppWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

