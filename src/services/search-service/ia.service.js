/**
 * Detecta la categoría principal del producto basándose en palabras clave en la consulta.
 * @param {string} userQuery - La consulta del usuario.
 * @returns {string} - La categoría detectada ('celular', 'heladera', 'notebook', 'default').
 */
function detectCategory(userQuery) {
    const queryLower = userQuery.toLowerCase();
    if (queryLower.includes('celular') || queryLower.includes('smartphone') || queryLower.includes('iphone') || queryLower.includes('galaxy')) return 'celular';
    if (queryLower.includes('heladera') || queryLower.includes('refrigerador') || queryLower.includes('nevera')) return 'heladera';
    if (queryLower.includes('notebook') || queryLower.includes('laptop') || queryLower.includes('portatil')) return 'notebook';
    if (queryLower.includes('microondas') || queryLower.includes('horno microondas')) return 'microondas';
    if (queryLower.includes('robot de cocina') || queryLower.includes('procesadora') || queryLower.includes('batidora')) return 'robot_cocina';
    // Añade más categorías aquí...
    return 'default'; // Categoría genérica si no se detecta una específica
}

/**
 * Define los perfiles de ponderación para diferentes categorías de productos.
 * Cada perfil ajusta la importancia de los distintos criterios.
 */
const categoryProfiles = {
    celular: {
        relevanceWeight: 1.2, // Título un poco más importante
        qualityWeight: 1.1,   // Rating/Reviews importantes
        priceWeight: 0.8,     // Precio relativo un poco menos importante
        brandWeight: 1.5,     // Marca muy importante
        recencyWeight: 1.3,   // Novedad importante
        discountWeight: 1.0,
        completenessWeight: 1.0,
        keywordWeight: 1.2,
        // Marcas específicas para celulares
        brands: { 'apple': 25, 'samsung': 20, 'xiaomi': 15, 'motorola': 10, 'google': 18 },
        positiveKeywords: ['pro', 'max', 'ultra', 'plus', 'nuevo', 'generacion', 'gen'],
        negativeKeywords: ['refurbished', 'usado', 'reacondicionado']
    },
    heladera: {
        relevanceWeight: 1.0,
        qualityWeight: 1.0,
        priceWeight: 1.2,     // Precio más importante
        brandWeight: 1.3,     // Marca importante
        recencyWeight: 0.8,   // Novedad menos crítica
        discountWeight: 1.1,
        completenessWeight: 1.2, // Info completa es más relevante
        keywordWeight: 1.1,
        brands: { 'lg': 18, 'samsung': 15, 'whirlpool': 16, 'gafa': 10, 'patrick': 8 },
        positiveKeywords: ['inverter', 'no frost', 'dispenser', 'acero inoxidable', 'nueva'],
        negativeKeywords: ['exhibicion', 'usado']
    },
    notebook: {
        relevanceWeight: 1.1,
        qualityWeight: 1.0,
        priceWeight: 1.0,
        brandWeight: 1.2,
        recencyWeight: 1.2,
        discountWeight: 1.0,
        completenessWeight: 1.1,
        keywordWeight: 1.3, // Keywords como RAM, procesador, etc. son importantes
        brands: { 'apple': 20, 'dell': 15, 'hp': 12, 'lenovo': 14, 'asus': 13 },
        positiveKeywords: ['i7', 'i9', 'ryzen 7', 'ryzen 9', '16gb', '32gb', 'rtx', 'ssd', 'oled', 'nueva'],
        negativeKeywords: ['refurbished', 'usado', 'i3', 'celeron', '4gb'] // Penalizar specs bajas
    },
    // Añade perfiles para 'microondas', 'robot_cocina', etc.
    default: { // Perfil genérico si no se detecta categoría
        relevanceWeight: 1.0,
        qualityWeight: 1.0,
        priceWeight: 1.0,
        brandWeight: 1.0,
        recencyWeight: 1.0,
        discountWeight: 1.0,
        completenessWeight: 1.0,
        keywordWeight: 1.0,
        brands: { 'samsung': 15, 'apple': 20, 'lg': 10, 'sony': 12 }, // Marcas genéricas
        positiveKeywords: ['pro', 'plus', 'max', 'nuevo'],
        negativeKeywords: ['refurbished', 'usado']
    }
};

/**
 * Analiza una lista de resultados de Google Shopping aplicando ponderaciones por categoría.
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
  console.log(`[Analysis] Categoría detectada: ${category}`);

  // --- 2. Pre-cálculos ---
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
            extractedNumericPrice: extractedPriceNum > price ? extractedPriceNum : 0, // Asegura que el precio original sea mayor
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

    // a) Relevancia del Título (con peso)
    let relevanceScore = 0;
    queryWords.forEach(word => { if (product.titleLower.includes(word)) relevanceScore += 10; });
    // Bonus si el título es corto y relevante
    if (product.titleLower.length < (userQuery.length + 10) && relevanceScore > 0) relevanceScore += 5; 
    score += relevanceScore * profile.relevanceWeight; 
    if (relevanceScore >= 20) pros.push("Título relevante");
    else if (relevanceScore < 10 && queryWords.length > 0) cons.push("Título poco relevante");

    // b) Calidad Percibida (con peso)
    let qualityScore = 0;
    if (product.rating >= 4.7) qualityScore += 50;
    else if (product.rating >= 4.3) qualityScore += 35;
    else if (product.rating >= 4.0) qualityScore += 20;
    else if (product.rating >= 3.5) qualityScore += 5;
    else if (product.rating > 0) qualityScore -= 10; // Penalización por rating bajo
    else qualityScore -= 15; // Penalización mayor si no hay rating

    if (product.reviews > 1000) qualityScore += 30;
    else if (product.reviews > 200) qualityScore += 20;
    else if (product.reviews > 50) qualityScore += 10;
    else if (product.rating > 0 && product.reviews < 10) qualityScore -= 15; // Penalización fuerte por pocas reviews
    else if (product.reviews === 0 && product.rating > 0) qualityScore -= 5; // Hay rating pero 0 reviews
    score += qualityScore * profile.qualityWeight; 
    if (product.rating >= 4.3) pros.push(`Valoración (${product.rating}⭐)`);
    if (product.reviews > 200) pros.push(`Reseñas (${product.reviews})`);
    if (product.rating > 0 && product.rating < 4.0) cons.push(`Valoración mejorable (${product.rating}⭐)`);
    if (product.rating > 0 && product.reviews < 50) cons.push("Pocas reseñas");
    if (product.rating === 0) cons.push("Sin valoración");

    // c) Precio Relativo (con peso)
    let priceScore = 0;
    if (averagePrice > 0 && product.numericPrice > 0) {
        const priceRatio = product.numericPrice / averagePrice;
        if (priceRatio <= 0.8) { priceScore += 30; pros.push("Precio competitivo"); }
        else if (priceRatio <= 1.05) { priceScore += 15; pros.push("Precio razonable"); }
        else if (priceRatio <= 1.3) { priceScore -= 10; cons.push("Precio elevado"); }
        else { priceScore -= 25; cons.push("Precio muy alto"); }
    } else if (product.numericPrice === 0) priceScore -= 15; // Penalización por precio faltante
    score += priceScore * profile.priceWeight; 


    // d) Ponderación de Marca (usando profile.brands y peso)
    let brandScore = profile.brands[product.brandLower] || 0; // Usa marcas del perfil
    score += brandScore * profile.brandWeight; 
    if (brandScore > 10) pros.push(`Marca reconocida (${product.brand})`);

    // e) Análisis de Novedad (con peso)
    let recencyScore = 0;
    if (product.titleLower.includes(currentYear.toString())) { recencyScore = 15; }
    else if (product.titleLower.includes((currentYear - 1).toString())) { recencyScore = 7; }
    score += recencyScore * profile.recencyWeight; 
    if (recencyScore > 0) pros.push("Modelo reciente");

    // f) Detección de Ofertas (con peso)
    let discountScore = 0;
    if (product.extractedNumericPrice > 0) { 
        const discountPercentage = ((product.extractedNumericPrice - product.numericPrice) / product.extractedNumericPrice) * 100;
        if (discountPercentage >= 25) { discountScore = 30; pros.push(`¡Buena oferta! (${discountPercentage.toFixed(0)}% off)`); }
        else if (discountPercentage >= 15) { discountScore = 15; pros.push(`En oferta (${discountPercentage.toFixed(0)}% off)`); }
     }
    score += discountScore * profile.discountWeight; 

    // g) Penalización por Info Incompleta (con peso)
    let completenessPenalty = 0;
    if (product.rating === 0 && product.reviews === 0) completenessPenalty += 10; 
    if (product.numericPrice === 0) completenessPenalty += 15; 
    score -= completenessPenalty * profile.completenessWeight; 
    if (completenessPenalty >= 10) cons.push("Faltan datos clave");

    // h) Análisis de Keywords (usando profile.keywords y peso)
    let keywordScore = 0;
    profile.positiveKeywords.forEach(kw => { if (product.titleLower.includes(kw)) keywordScore += 7; });
    profile.negativeKeywords.forEach(kw => { if (product.titleLower.includes(kw)) keywordScore -= 30; });
    score += keywordScore * profile.keywordWeight; 
    if (profile.negativeKeywords.some(kw => product.titleLower.includes(kw))) cons.push("Podría ser usado/reacondicionado");

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
  let recomendacion_final = "No pude determinar una recomendación clara basada en los criterios.";
  if (topProducts.length > 0) { 
      const bestProduct = topProducts[0];
      let reason = bestProduct.pros.length > 0 ? bestProduct.pros[0] : 'su puntuación general'; // Usa el primer pro como razón principal
      recomendacion_final = `Considerando "${userQuery}", te recomiendo el "${bestProduct.title}" principalmente por ${reason}.`;
      if (bestProduct.cons.length > 0) {
        recomendacion_final += ` Ten en cuenta que ${bestProduct.cons[0]}.`; // Menciona el primer contra
      }
   }

  return { productos_analisis, recomendacion_final };
}

// Función auxiliar parsePrice (sin cambios)
function parsePrice(priceString) {
    if (!priceString) return 0;
    // Elimina símbolos de moneda ($, ARS, USD, etc.), espacios, y usa punto como separador decimal
    const cleanedString = String(priceString)
        .replace(/[$\sA-Za-z]/g, '') // Elimina símbolos de moneda y espacios
        .replace(/\./g, '') // Elimina separadores de miles (si usan punto)
        .replace(',', '.'); // Reemplaza la coma decimal por punto
    const price = parseFloat(cleanedString);
    return isNaN(price) ? 0 : price;
}

