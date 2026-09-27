export const products = [];

export async function loadProducts() {
    const response = await fetch("/api/products");
    if (!response.ok) throw new Error("Unable to load products");

    const catalog = await response.json();
    products.splice(0, products.length, ...catalog.map(product => ({ ...product, quantity: 0 })));
    return products;
}
