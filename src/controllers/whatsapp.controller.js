import { executeWhatsAppSearch } from '../services/orchestor/whatsapp.orchestrator.js';
import { getEnrichedProductDetails } from '../services/search-service/productDetail.service.js';
import { sendTextMessage, sendImageMessage, sendReplyButtonsMessage, sendListMessage } from '../services/search-service/whatsapp.service.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// --- GESTIÓN DE ESTADO DE CONVERSACIÓN ---
const conversationState = new Map();

// --- CARGA DE CONFIGURACIÓN DE DIÁLOGO ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Ajusta la ruta a tu archivo .json si es diferente
const configPath = path.resolve(__dirname, '../config/dialog.config.json'); 
let dialogConfig = { categories: [], brandSuggestions: {}, default: [] };
try {
    const fileContent = fs.readFileSync(configPath, 'utf8');
    dialogConfig = JSON.parse(fileContent);
    console.log("[Dialog Config] Configuración de diálogo cargada.");
} catch (error) {
    console.error("❌ Error al cargar dialog.config.json:", error);
}

// --- FUNCIONES AUXILIARES ---

function parsePriceFromText(text) {
  const priceRegex = /(\d{1,3}(?:[.,]\d{3})*)/g;
  const numbers = (text.match(priceRegex) || []).map(n => parseInt(n.replace(/[.,]/g, '')));
  if (text.includes("entre") && numbers.length >= 2) return { minPrice: Math.min(...numbers), maxPrice: Math.max(...numbers) };
  if ((text.includes("menos de") || text.includes("hasta")) && numbers.length >= 1) return { maxPrice: numbers[0] };
  if ((text.includes("más de") || text.includes("desde")) && numbers.length >= 1) return { minPrice: numbers[0] };
  return {};
}

/**
 * Pregunta por el rango de precios (Paso 4)
 */
async function askForPrice(userPhone, currentStateData) {
  conversationState.set(userPhone, { ...currentStateData, state: 'AWAITING_PRICE_RANGE' });
  await sendTextMessage(userPhone, `¡Anotado! ¿Tienes algún rango de precios en mente? (ej: "hasta 150000", o "no")`);
}

/**
 * Pregunta por la marca, mostrando botones sugeridos (Paso 3)
 */
async function askForBrand(userPhone, currentStateData) {
  const category = currentStateData.data.category || 'default';
  // Lee las sugerencias desde el config cargado
  const suggestions = dialogConfig.brandSuggestions[category] || dialogConfig.brandSuggestions.default;
  const buttons = suggestions.map(brand => ({
      type: 'reply', 
      reply: { id: `select_brand:${brand.id}`, title: brand.title }
  })).slice(0, 3); // Max 3 botones
  
  conversationState.set(userPhone, { ...currentStateData, state: 'AWAITING_BRAND' });

  if (buttons.length > 0) {
    await sendReplyButtonsMessage(userPhone, `¡Perfecto! Buscaremos en *${category.toUpperCase()}*. ¿Tienes alguna marca en mente?`, buttons);
  } else {
    await sendTextMessage(userPhone, `¡Perfecto! Buscaremos en *${category.toUpperCase()}*. ¿Tienes alguna marca en mente? (Escribe "ninguna" si no tienes preferencia)`);
  }
}

/**
 * Maneja las respuestas a botones y listas interactivas.
 */
async function handleInteractiveReply(userPhone, message, currentStateData) {
  const { results, collectionId, state, data: searchContext } = currentStateData;
  const reply = message.interactive.list_reply || message.interactive.button_reply; 
  if (!reply || !reply.id) return;

  const replyId = reply.id;
  const [action, payload] = replyId.split(':');
  
  const setClosingState = async () => {
    const buttons = [
        { type: 'reply', reply: { id: `post_action:new_search`, title: 'Buscar algo más 🔎' } },
        { type: 'reply', reply: { id: `post_action:end`, title: 'No, gracias 👋' } },
    ];
    await sendReplyButtonsMessage(userPhone, "¿Qué te pareció este producto? ¿Te gustaría ver otra opción de la lista o buscar algo diferente?", buttons.slice(0,3));
    conversationState.set(userPhone, { ...currentStateData, state: 'AWAITING_POST_DETAIL_ACTION' });
  };
  
  // --- Manejo de Acciones Interactivas ---

  // PASO 2: Respuesta a la selección de categoría
  if (state === 'AWAITING_CATEGORY' && action === 'select_category') {
      const category = payload;
      // Busca la configuración de la categoría en el JSON cargado
      const categoryConfig = dialogConfig.categories.find(c => c.id === category);
      
      if (category === 'otros') {
        conversationState.set(userPhone, {
            state: 'AWAITING_CUSTOM_QUERY', 
            data: { category: 'default', userId: userPhone } 
        });
        await sendTextMessage(userPhone, `¡Entendido! Por favor, dime qué producto te gustaría buscar (ej: "zapatillas para correr")`);
      } else if (categoryConfig) {
        // Si se encuentra la categoría, pasa a preguntar la MARCA
        conversationState.set(userPhone, {
            state: 'AWAITING_BRAND', // PASO 3
            data: { 
                query: categoryConfig.query, // Usa la query base del config
                category: category, 
                userId: userPhone 
            }
        });
        // Llama a la función que muestra botones de marca dinámicos
        await askForBrand(userPhone, conversationState.get(userPhone));
      }
      return;
  }

  // PASO 3: Respuesta a la selección de marca
  if (state === 'AWAITING_BRAND' && action === 'select_brand') {
      searchContext.brandPreference = payload;
      searchContext.query += ` ${payload}`;
      askForPrice(userPhone, { state: 'AWAITING_PRICE_RANGE', data: searchContext }); // PASO 4
      return;
  }

  // PASO 6: Respuesta a la confirmación de análisis IA
  else if (state === 'AWAITING_AI_CONFIRMATION' && action === 'ai_confirm') {
      if (payload === 'yes') {
          // Si dice SÍ, ejecutamos el análisis avanzado (PASO 7)
          executeAdvancedAIAnalysis(userPhone, currentStateData);
      } else {
          // Si dice NO, le mostramos los resultados locales para que elija
          await sendTextMessage(userPhone, "Entendido. ¡Aquí tienes los mejores 5 productos de mi análisis rápido! Puedes seleccionar uno para ver sus detalles.");
          const locallyAnalyzedProducts = currentStateData.results;
          const rows = locallyAnalyzedProducts.slice(0, 5).map(prod => ({
            id: `select_product:${prod.product_id}`,
            title: prod.title.substring(0, 24),
            description: `Precio: ${prod.price}`.substring(0, 72)
          }));
          conversationState.set(userPhone, { ...currentStateData, state: 'AWAITING_PRODUCT_SELECTION' });
          await sendListMessage(userPhone, `Análisis Rápido`, "Resultados del análisis local:", "Ver Opciones", [{ title: "Productos (Análisis Rápido)", rows }]);
      }
      return;
  }
  // Selección de producto de la lista (después del análisis)
  else if (action === 'select_product') {
    const product = results?.find(p => p.product_id == payload);
    if (!product) return;
    await sendTextMessage(userPhone, `Buscando detalles para *${product.title}*...`);
    try {
      const enrichedProduct = await getEnrichedProductDetails(collectionId, payload);
      if (!enrichedProduct) throw new Error("Producto no enriquecido.");
      const updatedResults = results.map(p => p.product_id == payload ? enrichedProduct : p);
      conversationState.set(userPhone, { ...currentStateData, results: updatedResults });
      const buttons = [
        { type: 'reply', reply: { id: `show_details:${payload}`, title: 'Pros y Contras' } },
        { type: 'reply', reply: { id: `show_stores:${payload}`, title: 'Opciones de Compra' } },
        { type: 'reply', reply: { id: `show_features:${payload}`, title: 'Características' } },
      ];
      await sendReplyButtonsMessage(userPhone, `¡Listo! Seleccionaste: *${product.title}*.\n\n¿Qué te gustaría ver?`, buttons.slice(0,3));
    } catch (error) {
       console.error("Error al obtener detalles inmersivos:", error);
       await sendTextMessage(userPhone, "Lo siento, no pude obtener los detalles completos para este producto.");
     }
  }
  // Acciones para mostrar detalles específicos
  else if (action.startsWith('show_')) {
      const product = Array.isArray(results) ? results.find(p => p.product_id == payload) : null;
      if (!product) { await sendTextMessage(userPhone, "Hubo un problema. Por favor, selecciona el producto de nuevo."); return; }

      if (action === 'show_details') {
          let detailsText = `*Análisis para ${product.title}*:\n\n*✅ PROS:*\n${product.pros?.map(p => `- ${p}`).join('\n') || "No disponibles"}\n\n*❌ CONTRAS:*\n${product.contras?.map(c => `- ${c}`).join('\n') || "No disponibles"}`;
          await sendTextMessage(userPhone, detailsText);
      }
      else if (action === 'show_stores') {
          let storesText = `*Opciones de Compra para ${product.title}:*\n\n`;
          const stores = product.immersive_details?.stores;
          if (stores && Array.isArray(stores) && stores.length > 0) {
            stores.forEach((store, index) => {
              storesText += `*${index + 1}. ${store.name || 'Tienda desconocida'}*\n`;
              storesText += `   Precio: *${store.price || 'No disponible'}*\n`;
              storesText += `   Ver: ${store.link || 'No disponible'}\n\n`;
            });
          } else { storesText = "Lo siento, no encontré opciones de compra específicas."; }
          await sendTextMessage(userPhone, storesText);
      }
      else if (action === 'show_features') {
          let featuresText = `*Características de ${product.title}:*\n\n`;
          const features = product.immersive_details?.about_the_product?.features;
          if(features && Array.isArray(features) && features.length > 0) {
              features.forEach(feature => {
                  featuresText += `*${feature.title || 'Característica'}*: ${feature.value || 'No disponible'}\n`;
              });
          } else { featuresText = "Lo siento, no encontré características detalladas."; }
          await sendTextMessage(userPhone, featuresText);
      }
      await setClosingState();
  }
  // Acciones después de ver detalles
  else if (action === 'post_action') {
      if (payload === 'new_search') {
          handleGreeting(userPhone, userPhone);
      } else if (payload === 'end') {
          await sendTextMessage(userPhone, "¡De nada! Estoy aquí si necesitas algo más. 😊");
          conversationState.delete(userPhone);
      }
  }
}

/**
 * Función separada para manejar el saludo (PASO 1)
 */
async function handleGreeting(userPhone, userId) {
    // PASO 2: Presenta la lista de categorías leída del config
    conversationState.set(userPhone, { state: 'AWAITING_CATEGORY', data: { userId: userId } });
    
    // Lee las categorías desde el config cargado
    const rows = dialogConfig.categories.map(cat => ({ 
        id: `select_category:${cat.id}`, 
        title: cat.title 
    })).slice(0, 10); // WhatsApp soporta máx 10 filas

    await sendTextMessage(userPhone, "¡Hola! 👋 Soy tu asistente de compras.");
    await sendListMessage(userPhone, "Elige una Categoría", "¿En qué tipo de producto estás interesado hoy?", "Categorías", [{ title: "Categorías Populares", rows }]);
}

/**
 * Controlador principal del webhook
 */
export async function handleWhatsAppWebhook(req, res) {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) return res.sendStatus(200);
  res.sendStatus(200);

  const userPhone = message.from;
  const currentStateData = conversationState.get(userPhone) || { state: 'GREETING', data: { userId: userPhone } };
  const currentSearchData = currentStateData.data || { userId: userPhone };

  if (message.type === 'interactive') {
    handleInteractiveReply(userPhone, message, currentStateData);
    return;
  }

  if (message.type === 'text') {
    const userText = message.text.body;

    // Manejo del cierre explícito
    if (currentStateData.state === 'AWAITING_CLOSING' || currentStateData.state === 'AWAITING_POST_DETAIL_ACTION') {
       const negativeKeywords = ['no', 'gracias', 'nada mas', 'eso es todo', 'chau'];
        if (negativeKeywords.some(keyword => userText.toLowerCase().includes(keyword))) {
            await sendTextMessage(userPhone, "¡De nada! Estoy aquí si necesitas algo más. 😊");
            conversationState.delete(userPhone);
            return;
        }
       handleGreeting(userPhone, userPhone);
       return;
    }

    // --- Flujo conversacional guiado ---
    switch (currentStateData.state) {
        case 'AWAITING_CATEGORY':
             // Usuario escribe la categoría
             const categoryText = userText.toLowerCase();
             const foundCategory = dialogConfig.categories.find(c => c.title.toLowerCase().includes(categoryText) || c.id === categoryText);
             const categoryId = foundCategory ? foundCategory.id : 'default';

             conversationState.set(userPhone, {
                state: 'AWAITING_BRAND', // PASO 3
                data: { 
                    ...currentSearchData, 
                    query: userText, 
                    category: categoryId
                }
            });
            await askForBrand(userPhone, conversationState.get(userPhone));
            break;

        case 'AWAITING_CUSTOM_QUERY': // Después de presionar "Otros"
            currentSearchData.query = userText;
            currentSearchData.category = 'default';
            await askForBrand(userPhone, { state: 'AWAITING_BRAND', data: currentSearchData });
            break;
            
        // (Este estado ya no es necesario, pero lo dejamos por si acaso)
        case 'AWAITING_PRODUCT_NAME':
            currentSearchData.query = `${currentSearchData.query || ''} ${userText}`.trim();
            conversationState.set(userPhone, { state: 'AWAITING_BRAND', data: currentSearchData });
            await askForBrand(userPhone, conversationState.get(userPhone));
            break;

        // PASO 3: Usuario escribe la marca
        case 'AWAITING_BRAND':
            currentSearchData.brandPreference = userText;
            // No añadimos la marca a la query aquí, lo hace el orquestador
            await askForPrice(userPhone, { state: 'AWAITING_PRICE_RANGE', data: currentSearchData }); // PASO 4
            break;

        // PASO 4: Usuario escribe el precio
        case 'AWAITING_PRICE_RANGE':
            const priceData = parsePriceFromText(userText.toLowerCase());
            const searchDataWithPrice = { ...currentSearchData, ...priceData };
            conversationState.set(userPhone, { state: 'SEARCHING', data: searchDataWithPrice });
            // PASO 5: Ejecutar búsqueda y análisis
            executeLocalAnalysisSearch(userPhone, searchDataWithPrice, conversationState);
            break;
        
        default: // GREETING (PASO 1)
            if (['hola', 'hey', 'buenas'].includes(userText.toLowerCase())) {
                handleGreeting(userPhone, userPhone);
            } else {
                // Búsqueda directa (como fallback)
                const directPriceData = parsePriceFromText(userText.toLowerCase());
                const directSearchData = { 
                    ...currentSearchData, 
                    query: userText, 
                    ...directPriceData, 
                    category: 'default' 
                };
                conversationState.set(userPhone, { state: 'SEARCHING', data: directSearchData });
                executeLocalAnalysisSearch(userPhone, directSearchData, conversationState);
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

