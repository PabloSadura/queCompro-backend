
       
  export default function logicFusion(shoppingResults, geminiAnalysis){

 // --- LÓGICA DE FUSIÓN DE DATOS ---
        // 1. Crear un mapa de los resultados originales para buscar por product_id (CRUCIAL)
        const shoppingMap = new Map();
        shoppingResults.forEach(product => {
            if (product.product_id) { // Usamos product_id para la clave
                shoppingMap.set(product.product_id, product);
            }
        });

          // 2. Fusionar los datos de Gemini con los datos originales de Google Shopping
        const productosRecomendadosFinales = [];
        geminiAnalysis.productos_analisis.forEach(analisisItem => {
            const originalProductData = shoppingMap.get(analisisItem.product_id);
            if (originalProductData) {
                productosRecomendadosFinales.push({
                    ...originalProductData, 
                    pros: analisisItem.pros || [],
                    contras: analisisItem.contras || [],
                })
            } else {
                console.warn(`Producto no encontrado en el mapa con ID: ${analisisItem.product_id}`);
            }
        });

        return productosRecomendadosFinales;
  }     
      