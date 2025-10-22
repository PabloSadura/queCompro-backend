import { getProductFromFirebase, updateProductInFirebase } from '../services/search-service/firebaseService.service.js';
import { fetchImmersiveProductDetails } from '../services/search-service/googleInmersive.service.js';
import { getEnrichedProductDetails } from '../services/search-service/productDetail.service.js';

export async function getProductById(req, res) { 
    const { idCollection, idProduct } = req.params;
    try{

        const updatedProduct = await getEnrichedProductDetails(idCollection, idProduct);
        
        res.status(200).json(updatedProduct);
    }   
     catch (err) {
        console.error(`Error al obtener detalles para el producto ${idProduct}:`, err);
        res.status(500).json({ error: 'Failed to fetch product details' });
    }
}
