import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Usamos Flash para que sea rápido y económico
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * Define la estructura de datos limpia que queremos que la IA devuelva.
 */
const cleanProductSchema = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      "product_id": { "type": "STRING" },
      "clean_title": { "type": "STRING" },
      "brand": { "type": "STRING" },
      "model": { "type": "STRING" },
      "specs": { // Un array de características clave extraídas
        "type": "ARRAY",
        "items": { "type": "STRING" }
      }
    },
    required: ["product_id", "clean_title", "brand", "model", "specs"]
  }
};

/**
 * Usa Gemini-Flash para "limpiar" y "estructurar" los títulos sucios de Google Shopping.
 * @param {Array<object>} shoppingResults - La lista de productos de SerpApi.
 * @returns {Promise<Array<object>>} Un array de productos con datos estructurados.
 */
export async function structureProductDataWithAI(shoppingResults) {
  console.log(`[AI Cleaner] Iniciando limpieza de ${shoppingResults.length} productos...`);
  
  // Mapeamos los resultados a un formato más simple solo con lo que la IA necesita
  const simplifiedResults = shoppingResults.map(p => ({
    product_id: p.product_id,
    title: p.title
  }));

  const prompt = `
    Tu tarea es actuar como un experto en "Extracción de Entidades" (Entity Extraction) para e-commerce.
    Analiza el siguiente array de títulos de productos (que vienen de una búsqueda en Google Shopping) y extrae la información clave.
    
    Quiero que extraigas:
    1.  "product_id": El ID original, sin cambios.
    2.  "clean_title": El título limpio (ej: "Samsung Galaxy S24 Ultra 512GB").
    3.  "brand": La marca (ej: "Samsung"). Si no puedes identificarla, usa "Genérico".
    4.  "model": El modelo principal (ej: "Galaxy S24 Ultra").
    5.  "specs": Un array de strings con las especificaciones clave (ej: ["512gb", "12gb ram", "snapdragon 8 gen 3"]).
    
    Si una especificación no es obvia, déjala como un array vacío. No inventes datos.
    
    Resultados de Google Shopping:
    ${JSON.stringify(simplifiedResults)}
  `;

  try {
    const result = await model.generateContent({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: cleanProductSchema,
      },
    });

    const response = result.response;
    const cleanData = JSON.parse(response.text());
    console.log(`[AI Cleaner] Limpieza completada. ${cleanData.length} productos estructurados.`);
    return cleanData;

  } catch (error) {
    console.error("❌ Error en el servicio de limpieza de Gemini:", error);
    // Fallback: si la limpieza falla, devuelve los datos originales con un formato similar
    return simplifiedResults.map(p => ({
      product_id: p.product_id,
      clean_title: p.title,
      brand: p.brand || "Desconocida",
      model: p.title,
      specs: []
    }));
  }
}

