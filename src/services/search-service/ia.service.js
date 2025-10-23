import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// --- Carga Dinámica de Perfiles ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const profilesDir = path.resolve(__dirname, '../../config/product_profiles'); // Ruta a la carpeta de perfiles
let categoryProfiles = {};

try {
    // Leemos todos los archivos .json de la carpeta y los cargamos en memoria
    const profileFiles = fs.readdirSync(profilesDir).filter(file => file.endsWith('.json'));
    profileFiles.forEach(file => {
        const categoryName = path.basename(file, '.json'); // ej: 'celular'
        const filePath = path.join(profilesDir, file);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        categoryProfiles[categoryName] = JSON.parse(fileContent);
        console.log(`[Analysis Profiles] Perfil cargado: ${categoryName}`);
    });
    // Aseguramos que siempre exista un perfil 'default'
    if (!categoryProfiles.default) {
        console.warn("[Analysis Profiles] No se encontró 'default.json'. Usando configuración genérica.");
        categoryProfiles.default = { weights: { relevance: 1, quality: 1, price: 1, brand: 1, recency: 1, discount: 1, completeness: 1, keyword: 1 }, brands: {}, positiveKeywords: {}, negativeKeywords: {} };
    }
} catch (error) {
    console.error("❌ Error al cargar los perfiles de producto:", error);
    // Si falla la carga, usamos un perfil default básico para no detener la app
    categoryProfiles = { default: { weights: { relevance: 1, quality: 1, price: 1, brand: 1, recency: 1, discount: 1, completeness: 1, keyword: 1 }, brands: {}, positiveKeywords: {}, negativeKeywords: {} } };
}

/**
 * Detecta la categoría principal del producto basándose en palabras clave en la consulta.
 */
function detectCategory(userQuery) {
    const queryLower = userQuery.toLowerCase();
    if (queryLower.includes('celular') || queryLower.includes('smartphone')) return 'celular';
    if (queryLower.includes('heladera') || queryLower.includes('refrigerador')) return 'heladera';
    if (queryLower.includes('notebook') || queryLower.includes('laptop')) return 'notebook';
    if (queryLower.includes('microondas') || queryLower.includes('horno microondas')) return 'microondas';
    if (queryLower.includes('robot de cocina') || queryLower.includes('procesadora') || queryLower.includes('batidora')) return 'robot_cocina';
    // Añade más categorías aquí...
    return 'default';
}

/**
 * Analiza una lista de resultados de Google Shopping aplicando ponderaciones por categoría.
 * RECIBE LOS DATOS ESTRUCTURADOS DE LA IA DE LIMPIEZA.
 * @param {string} userQuery
 * @param {Array<object>} shoppingResults - Datos originales (para precio, rating, etc.)
 * @param {Array<object>} structuredProducts - Datos limpios de la IA (para specs, marca, etc.)
 * @param {string} category - Categoría detectada
 */
export function analyzeShoppingResults(userQuery, shoppingResults, structuredProducts, category = 'default') {
  if (!shoppingResults || shoppingResults.length === 0) {
        return {
          productos_analisis: [],
          recomendacion_final: "No se encontraron productos para analizar."
        };
   }

  // --- 1. Detección de Categoría y Selección de Perfil ---
  // Si la categoría no fue pre-seleccionada por el bot, la detecta.
  const finalCategory = (category && category !== 'default') ? category : detectCategory(userQuery);
  const profile = categoryProfiles[finalCategory] || categoryProfiles.default;
  console.log(`[Analysis] Categoría detectada: ${finalCategory}. Usando perfil '${profile === categoryProfiles.default ? 'default' : finalCategory}'.`);

  // --- 2. Pre-cálculos ---
  const queryWords = userQuery.toLowerCase().split(' ').filter(word => word.length > 2);
  let totalPrices = 0;
  let validPriceCount = 0;
  const currentYear = new Date().getFullYear();

  // Creamos un mapa de los datos estructurados para fácil acceso
  const structuredMap = new Map(structuredProducts.map(p => [p.product_id, p]));

  const productsWithParsedData = shoppingResults.map(product => {
      const price = parsePrice(product.price);
      if (price > 0) { totalPrices += price; validPriceCount++; }
      const extractedPriceNum = product.extracted_price ? parsePrice(product.extracted_price) : 0;
      
      // Obtenemos los datos limpios correspondientes
      const cleanData = structuredMap.get(product.product_id) || { brand: product.brand, specs: [], titleLower: product.title.toLowerCase() };
      
      return {
            ...product,
            numericPrice: price,
            extractedNumericPrice: extractedPriceNum > price ? extractedPriceNum : 0,
            rating: parseFloat(product.rating) || 0,
            reviews: parseInt(String(product.reviews).replace(/\D/g,'')) || 0,
            titleLower: cleanData.clean_title.toLowerCase(), // Usamos el título limpio
            brandLower: cleanData.brand.toLowerCase(),     // Usamos la marca limpia
            specs: cleanData.specs || []                   // Usamos las specs limpias
      };
  });

  const averagePrice = validPriceCount > 0 ? totalPrices / validPriceCount : 0;

  // --- 3. Lógica de Puntuación con Pesos Dinámicos ---
  const scoredProducts = productsWithParsedData.map(product => {
    let score = 0;
    let pros = [];
    let cons = [];
    const weights = profile.weights || {};
    const brands = profile.brands || {};
    const positiveKeywords = profile.positiveKeywords || {};
    const negativeKeywords = profile.negativeKeywords || {};

    // a) Relevancia del Título
    let relevanceScore = 0;
    queryWords.forEach(word => { if (product.titleLower.includes(word)) relevanceScore += 10; });
    score += relevanceScore * (weights.relevance || 1);
    if (relevanceScore >= 10) pros.push("Título relevante");

    // b) Calidad Percibida
    let qualityScore = 0;
    if (product.rating >= 4.7) qualityScore += 50; else if (product.rating >= 4.3) qualityScore += 35; else if (product.rating >= 4.0) qualityScore += 20; else if (product.rating >= 3.5) qualityScore += 5; else if (product.rating > 0) qualityScore -= 10; else qualityScore -= 15;
    if (product.reviews > 1000) qualityScore += 30; else if (product.reviews > 200) qualityScore += 20; else if (product.reviews > 50) qualityScore += 10; else if (product.rating > 0 && product.reviews < 10) qualityScore -= 15; else if (product.reviews === 0 && product.rating > 0) qualityScore -= 5;
    score += qualityScore * (weights.quality || 1);
    if (product.rating >= 4.3) pros.push(`Valoración (${product.rating}⭐)`);
    if (product.reviews > 200) pros.push(`Reseñas (${product.reviews})`);
    if (product.rating > 0 && product.rating < 4.0) cons.push(`Valoración mejorable (${product.rating}⭐)`);
    if (product.rating === 0) cons.push("Sin valoración");

    // c) Precio Relativo
    let priceScore = 0;
    if (averagePrice > 0 && product.numericPrice > 0) {
        const priceRatio = product.numericPrice / averagePrice;
        if (priceRatio <= 0.8) { priceScore += 30; pros.push("Precio competitivo"); }
        else if (priceRatio <= 1.05) { priceScore += 15; pros.push("Precio razonable"); }
        else if (priceRatio <= 1.3) { priceScore -= 10; cons.push("Precio elevado"); }
        else { priceScore -= 25; cons.push("Precio muy alto"); }
    } else if (product.numericPrice === 0) priceScore -= 15;
    score += priceScore * (weights.price || 1);

    // d) Ponderación de Marca
    let brandScore = brands[product.brandLower] || 0;
    score += brandScore * (weights.brand || 1);
    if (brandScore > 10) pros.push(`Marca: ${product.brand}`);

    // e) Análisis de Novedad
    let recencyScore = 0;
    if (product.titleLower.includes(currentYear.toString())) { recencyScore = 15; }
    else if (product.titleLower.includes((currentYear - 1).toString())) { recencyScore = 7; }
    score += recencyScore * (weights.recency || 1);
    if (recencyScore > 0) pros.push("Modelo reciente");

    // f) Detección de Ofertas
    let discountScore = 0;
    if (product.extractedNumericPrice > 0) {
        const discountPercentage = ((product.extractedNumericPrice - product.numericPrice) / product.extractedNumericPrice) * 100;
        if (discountPercentage >= 25) { discountScore = 30; pros.push(`¡Buena oferta! (${discountPercentage.toFixed(0)}% off)`); }
        else if (discountPercentage >= 15) { discountScore = 15; pros.push(`En oferta (${discountPercentage.toFixed(0)}% off)`); }
     }
    score += discountScore * (weights.discount || 1);

    // g) Penalización por Info Incompleta
    let completenessPenalty = 0;
    if (product.rating === 0 && product.reviews === 0) completenessPenalty += 10;
    if (product.numericPrice === 0) completenessPenalty += 15;
    score -= completenessPenalty * (weights.completeness || 1);
    if (completenessPenalty >= 10) cons.push("Faltan datos clave");

    // h) Análisis de Keywords (usa 'specs' limpias y el título)
    let keywordScore = 0;
    let foundNegativeKeywords = [];
    const productSpecs = product.specs.map(s => s.toLowerCase());
    const textToScan = product.titleLower + " " + productSpecs.join(" ");

    for (const keyword in positiveKeywords) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (regex.test(textToScan)) {
            keywordScore += positiveKeywords[keyword];
        }
    }
    for (const keyword in negativeKeywords) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (regex.test(textToScan)) {
            keywordScore += negativeKeywords[keyword];
            foundNegativeKeywords.push(keyword);
        }
    }
    score += keywordScore * (weights.keyword || 1);
    if (foundNegativeKeywords.length > 0) {
        cons.push(`Specs bajas/condición (${foundNegativeKeywords.join(', ')})`);
    }

    // Limpieza final de Pros/Contras
    const finalPros = [...new Set(pros)].slice(0, 3);
    const finalCons = [...new Set(cons)].slice(0, 3);

    return { ...product, score, pros: finalPros, cons: finalCons };
  });

  // Ordenar y seleccionar los 6 mejores
  scoredProducts.sort((a, b) => b.score - a.score);
  const topProducts = scoredProducts.slice(0, 6);

  // --- 4. Construcción de la Respuesta Final ---
  const productos_analisis = topProducts.map((product, index) => ({
      product_id: product.product_id,
      pros: product.pros,
      contras: product.cons,
      isRecommended: index === 0
   }));
  let recomendacion_final = "No pude determinar una recomendación clara...";
  if (topProducts.length > 0) {
      const bestProduct = topProducts[0];
      let reason = bestProduct.pros.length > 0 ? bestProduct.pros[0].toLowerCase() : 'su puntuación general';
      recomendacion_final = `Considerando "${userQuery}", te recomiendo el "${bestProduct.title}" principalmente por ${reason}.`;
      if (bestProduct.cons.length > 0) {
        recomendacion_final += ` Ten en cuenta que ${bestProduct.cons[0].toLowerCase()}.`;
      }
   }

  return { productos_analisis, recomendacion_final };
}

// Función auxiliar parsePrice
function parsePrice(priceString) {
    if (!priceString) return 0;
    const cleanedString = String(priceString)
        .replace(/[$\sA-Za-z]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const price = parseFloat(cleanedString);
    return isNaN(price) ? 0 : price;
}

