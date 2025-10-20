import { getBestRecommendationFromAI } from '../services/search-service/aiService.js';
import { fetchGoogleShoppingResults } from '../services/search-service/googleSopphing.js';
import logicFusion from './logis.controller.js';
import axios from 'axios';

// --- DEBES CONFIGURAR ESTAS VARIABLES EN TU .env ---
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

/**
 * Función para enviar un mensaje de texto de vuelta al usuario.
 */
async function sendWhatsAppMessage(to, text) {
  try {
    await axios.post(WHATSAPP_API_URL, {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: text },
    }, {
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
    });
  } catch (error) {
    console.error("Error al enviar mensaje de WhatsApp:", error.response?.data || error.message);
  }
}

/**
 * Controlador principal para el webhook de WhatsApp.
 */
export async function handleWhatsAppWebhook(req, res) {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  // Si no es un mensaje de texto o es un mensaje de estado, lo ignoramos.
  if (!message || message.type !== 'text') {
    return res.sendStatus(200);
  }

  const userPhone = message.from;
  const userQuery = message.text.body;

  console.log(`Mensaje recibido de ${userPhone}: "${userQuery}"`);

  try {
    // 1. Envía un mensaje de confirmación inmediato al usuario.
    await sendWhatsAppMessage(userPhone, `¡Hola! 👋 Recibí tu búsqueda: "${userQuery}". Dame un momento mientras analizo las mejores opciones para ti...`);

    // 2. Reutiliza tu lógica de búsqueda y análisis de IA.
    // (Aquí usamos valores por defecto para simplificar, pero podrías usar IA para extraer precios, etc.)
    const { products: shoppingResults, totalResults } = await fetchGoogleShoppingResults(null, userQuery, 'ar', 'es', 'ARS');
    if (!shoppingResults || shoppingResults.length === 0) {
      await sendWhatsAppMessage(userPhone, "Lo siento, no encontré productos para tu búsqueda. ¿Podrías intentar con otros términos?");
      return res.sendStatus(200);
    }

    const aiAnalysis = await getBestRecommendationFromAI(userQuery, shoppingResults);
    const productosRecomendados = logicFusion(shoppingResults, aiAnalysis);

    // 3. Formatea la respuesta para WhatsApp.
    let responseText = `🤖 *Análisis Completado para "${userQuery}"*\n\n`;
    responseText += `*Recomendación de la IA:* ${aiAnalysis.recomendacion_final}\n\n`;
    responseText += "Aquí están las mejores opciones que encontré:\n\n";

    productosRecomendados.forEach((prod, index) => {
      responseText += `*${index + 1}. ${prod.title}*\n`;
      responseText += `Precio: *${prod.price}*\n`;
      responseText += `Rating: ${prod.rating || 'N/A'} ⭐\n`;
      responseText += `Ver más: ${prod.product_link}\n\n`;
    });

    // 4. Envía la respuesta final al usuario.
    await sendWhatsAppMessage(userPhone, responseText);
    
    res.sendStatus(200);

  } catch (error) {
    console.error("Error procesando la búsqueda de WhatsApp:", error);
    await sendWhatsAppMessage(userPhone, "Lo siento, ocurrió un error inesperado al procesar tu búsqueda. Por favor, intenta de nuevo más tarde.");
    res.sendStatus(500);
  }
}

/**
 * Verificación del Webhook (requerido por Meta una sola vez).
 */
export function verifyWhatsAppWebhook(req, res) {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
}
