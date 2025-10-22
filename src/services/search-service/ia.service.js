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
 * (Esta función se mantiene igual)
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
 * Analiza una lista de resultados de Google Shopping aplicando ponderaciones por categoría
 * cargadas desde archivos JSON externos, con puntajes específicos por keyword.
 */
export function analyzeShoppingResults(userQuery, shoppingResults) {
  if (!shoppingResults || shoppingResults.length === 0) {
        return {
          productos_analisis: [],
          recomendacion_final: "No se encontraron productos para analizar."
        };
   }

  // --- 1. Detección de Categoría y Selección de Perfil ---
  const category = detectCategory(userQuery);
  const profile = categoryProfiles[category] || categoryProfiles.default;
  console.log(`[Analysis] Categoría detectada: ${category}. Usando perfil '${profile === categoryProfiles.default ? 'default' : category}'.`);

  // --- 2. Pre-cálculos (sin cambios) ---
  const queryWords = userQuery.toLowerCase().split(' ').filter(word => word.length > 2);
  let totalPrices = 0;
  let validPriceCount = 0;
  const currentYear = new Date().getFullYear();

  const productsWithParsedData = shoppingResults.map(product => {
      const price = parsePrice(product.price);
      if (price > 0) { totalPrices += price; validPriceCount++; }
      const extractedPriceNum = product.extracted_price ? parsePrice(product.extracted_price) : 0;
      return {
            ...product,
            numericPrice: price,
            extractedNumericPrice: extractedPriceNum > price ? extractedPriceNum : 0,
            rating: parseFloat(product.rating) || 0,
            reviews: parseInt(String(product.reviews).replace(/\D/g,'')) || 0,
            titleLower: product.title ? product.title.toLowerCase() : '',
            brandLower: product.brand ? product.brand.toLowerCase() : ''
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
    if (product.titleLower.length < (userQuery.length + 10) && relevanceScore > 0) relevanceScore += 5;
    score += relevanceScore * (weights.relevance || 1);
    if (relevanceScore >= 20) pros.push("Título relevante");
    else if (relevanceScore < 10 && queryWords.length > 0) cons.push("Título poco relevante");

    // b) Calidad Percibida
    let qualityScore = 0;
    if (product.rating >= 4.7) qualityScore += 50; else if (product.rating >= 4.3) qualityScore += 35; else if (product.rating >= 4.0) qualityScore += 20; else if (product.rating >= 3.5) qualityScore += 5; else if (product.rating > 0) qualityScore -= 10; else qualityScore -= 15;
    if (product.reviews > 1000) qualityScore += 30; else if (product.reviews > 200) qualityScore += 20; else if (product.reviews > 50) qualityScore += 10; else if (product.rating > 0 && product.reviews < 10) qualityScore -= 15; else if (product.reviews === 0 && product.rating > 0) qualityScore -= 5;
    score += qualityScore * (weights.quality || 1);
    if (product.rating >= 4.3) pros.push(`Valoración (${product.rating}⭐)`);
    if (product.reviews > 200) pros.push(`Reseñas (${product.reviews})`);
    if (product.rating > 0 && product.rating < 4.0) cons.push(`Valoración mejorable (${product.rating}⭐)`);
    if (product.rating > 0 && product.reviews < 50) cons.push("Pocas reseñas");
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

    // --- ✅ h) Análisis de Keywords con Puntuación Específica ---
    let keywordScore = 0;
    let foundNegativeKeywords = []; // Para los 'cons'

    // Iteramos sobre las keywords positivas del perfil
    for (const keyword in positiveKeywords) {
        // Usamos una expresión regular para buscar la palabra completa o variaciones comunes
        // ej: busca "i7", "i7-", "i7 " para evitar coincidencias parciales como en "Ryzen 7i"
        const regex = new RegExp(`\\b${keyword}\\b|${keyword}-|${keyword}\\s`, 'i'); 
        if (regex.test(product.titleLower)) {
            keywordScore += positiveKeywords[keyword]; // Sumamos el puntaje específico
            console.log(`[Keyword Score] +${positiveKeywords[keyword]} for "${keyword}" in "${product.title}"`);
        }
    }
    // Iteramos sobre las keywords negativas del perfil
    for (const keyword in negativeKeywords) {
        const regex = new RegExp(`\\b${keyword}\\b|${keyword}-|${keyword}\\s`, 'i');
        if (regex.test(product.titleLower)) {
            keywordScore += negativeKeywords[keyword]; // Sumamos el puntaje negativo (resta)
            foundNegativeKeywords.push(keyword); // Guardamos la keyword negativa encontrada
            console.log(`[Keyword Score] ${negativeKeywords[keyword]} for "${keyword}" in "${product.title}"`);
        }
    }
    score += keywordScore * (weights.keyword || 1);
    // Añadimos un 'con' genérico si se encontraron keywords negativas importantes
    if (foundNegativeKeywords.length > 0 && keywordScore <= -10) { // Umbral ajustable
        cons.push(`Specs bajas/condición (${foundNegativeKeywords.join(', ')})`);
    }
    // --- Fin de la corrección ---

    // Limpieza final de Pros/Contras
    const finalPros = [...new Set(pros)].slice(0, 3);
    const finalCons = [...new Set(cons)].slice(0, 3);

    return { ...product, score, pros: finalPros, cons: finalCons };
  });

  // Ordenar y seleccionar los 6 mejores (sin cambios)
  scoredProducts.sort((a, b) => b.score - a.score);
  const topProducts = scoredProducts.slice(0, 6);

  // --- 4. Construcción de la Respuesta Final (sin cambios) ---
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

// Función auxiliar parsePrice (sin cambios)
function parsePrice(priceString) {
    if (!priceString) return 0;
    const cleanedString = String(priceString)
        .replace(/[$\sA-Za-z]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const price = parseFloat(cleanedString);
    return isNaN(price) ? 0 : price;
}

