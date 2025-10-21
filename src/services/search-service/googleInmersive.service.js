import axios from 'axios';

export async function fetchImmersiveProductDetails(apiUrl) {
    
    const apiKey  = process.env.SERPAPI_KEY1;
    let finalUrl = apiUrl;

    if (!apiUrl) return null;
    if (apiKey && !apiUrl.includes('api_key=')) {
        const separator = apiUrl.includes('?') ? '&' : '?';
        finalUrl = `${apiUrl}${separator}api_key=${apiKey}`;
    }

    try {
        const response = await axios.get(finalUrl);
        if (response.status !== 200) {
            console.warn(`SerpApi Immersive Fetch Warning: HTTP status: ${response.status}`);
            return null;
        }
        return response.data.product_results || null;
    } catch (error) {
        console.error("❌ Error fetching Immersive Product API:", error);
        return null;
    }
}