/**
 * Analiza una lista de resultados de Google Shopping y simula una recomendación de IA
 * basada en reglas predefinidas (rating, reviews, precio).
 * @param {string} userQuery - La consulta original del usuario (para contexto).
 * @param {Array<object>} shoppingResults - Array de productos de fetchGoogleShoppingResults.
 * @returns {object} - Objeto similar al de la IA, con productos_analisis y recomendacion_final.
 */
export function analyzeShoppingResults(userQuery, shoppingResults) {
  if (!shoppingResults || shoppingResults.length === 0) {
    return {
      productos_analisis: [],
      recomendacion_final: "No se encontraron productos para analizar."
    };
  }

  // --- Lógica de Puntuación ---
  const scoredProducts = shoppingResults.map(product => {
    let score = 0;
    const rating = parseFloat(product.rating) || 0;
    const reviews = parseInt(String(product.reviews).replace(/\D/g,'')) || 0; // Limpia y convierte a número

    // Puntos por rating (más peso a ratings altos)
    if (rating >= 4.5) score += 50;
    else if (rating >= 4.0) score += 30;
    else if (rating >= 3.5) score += 10;

    // Puntos por número de reviews (más reviews = más confianza)
    if (reviews > 1000) score += 30;
    else if (reviews > 100) score += 20;
    else if (reviews > 10) score += 10;
    
    // Podrías añadir lógica de precio aquí si quisieras (ej. penalizar muy caros o premiar baratos con buen rating)

    return { ...product, score };
  });

  // Ordenar por puntuación descendente
  scoredProducts.sort((a, b) => b.score - a.score);

  // Seleccionar los 6 mejores (o menos si hay menos)
  const topProducts = scoredProducts.slice(0, 6);

  // --- Construcción de la Respuesta ---
  const productos_analisis = topProducts.map((product, index) => ({
    product_id: product.product_id,
    pros: [`Rating: ${product.rating || 'N/A'}`, `Reviews: ${product.reviews || 0}`], // Pros simples basados en datos
    contras: [], // Podrías añadir contras si el rating es bajo, etc.
    isRecommended: index === 0 // El primero de la lista ordenada es el recomendado
  }));

  // Generar recomendación final basada en el mejor producto
  let recomendacion_final = "No pude determinar una recomendación clara.";
  if (topProducts.length > 0) {
    const bestProduct = topProducts[0];
    recomendacion_final = `Basado en el rating y las reseñas, te recomiendo el "${bestProduct.title}".`;
    if (bestProduct.rating >= 4.5) recomendacion_final += " Tiene una excelente valoración.";
    if (parseInt(String(bestProduct.reviews).replace(/\D/g,'')) > 500) recomendacion_final += " Y muchos usuarios lo han calificado.";
  }

  return {
    productos_analisis,
    recomendacion_final
  };
}
