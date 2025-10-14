import { getProductFromFirebase, updateProductInFirebase } from '../services/search-service/firebaseService.js';
import { fetchImmersiveProductDetails } from '../services/search-service/googleInmersive.js';

export async function getProductById(req, res) {
    
    const { idCollection, idProduct } = req.params;

    if (!idCollection || !idProduct) {
        return res.status(400).json({ error: 'Missing collectionId or productId' });
    }

    try {
        // 1. Obtener el producto de Firestore
        const product = await getProductFromFirebase(idCollection, idProduct);

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // 2. Verificar si ya tiene los detalles inmersivos (caché)
        if (product.immersive_details) {
            return res.status(200).json(product);
        }

        if (!product.serpapi_immersive_product_api) {
            return res.status(400).json({ error: 'Immersive API link not found for this product' });
        }

        const immersiveDetails = await fetchImmersiveProductDetails(product.serpapi_immersive_product_api);

        // 4. Construir el objeto de producto actualizado
        const updatedProduct = {
            ...product,
            immersive_details: immersiveDetails,
            // Aquí también podrías añadir los pros y contras si los extraes por separado
        };

        // 5. Guardar los nuevos detalles en Firestore para futuras peticiones (actualizar caché)
        await updateProductInFirebase(idCollection, idProduct, { 
            immersive_details: immersiveDetails 
        });

        // 6. Devolver el producto completo y actualizado al frontend
        res.status(200).json(updatedProduct);

    } catch (err) {
        console.error(`Error al obtener detalles para el producto ${idProduct}:`, err);
        res.status(500).json({ error: 'Failed to fetch product details' });
    }
}
