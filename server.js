const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, "data");
const catalogFile = path.join(root, "data", "products.json");
const cartsFile = path.join(dataDir, "carts.json");
const ordersFile = path.join(dataDir, "orders.json");
const port = Number(process.env.PORT || 5501);
const DELIVERY_FEE = 500;
const MAX_QUANTITY = 1000;

const productCatalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
const productsById = new Map(productCatalog.map(product => [product.id, product]));

function ensureStore(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, "{}\n");
}

ensureStore(cartsFile);
ensureStore(ordersFile);

function readStore(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { return {}; }
}

function writeStore(file, value) {
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function validateCartItem(item) {
    if (!item || typeof item.id !== "string") return null;

    const product = productsById.get(item.id);
    const quantity = item.quantity;
    if (!product || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) return null;
    if (product.category === "snack" && quantity % 2 !== 0) return null;

    return { id: product.id, quantity };
}

function validateSubmittedCart(items) {
    if (!Array.isArray(items)) return { error: "Cart items must be an array." };

    const seen = new Set();
    const selections = [];
    for (const item of items) {
        if (item?.id && seen.has(item.id)) return { error: `Duplicate product ID: ${item.id}.` };

        const selection = validateCartItem(item);
        if (!selection) return { error: "Each cart item must have a valid product ID and quantity." };
        seen.add(selection.id);
        if (selection.quantity > 0) selections.push(selection);
    }

    return { selections };
}

function canonicalizeStoredCart(items) {
    if (!Array.isArray(items)) return [];

    const seen = new Set();
    const selections = [];
    for (const item of items) {
        const selection = validateCartItem(item);
        if (!selection || seen.has(selection.id) || selection.quantity === 0) continue;
        seen.add(selection.id);
        selections.push(selection);
    }
    return selections;
}

function hydrateCart(selections) {
    return selections.map(selection => ({
        ...productsById.get(selection.id),
        quantity: selection.quantity
    }));
}

function readCanonicalCart(carts, cartId) {
    const stored = carts[cartId] || [];
    const selections = canonicalizeStoredCart(stored);
    if (JSON.stringify(stored) !== JSON.stringify(selections)) {
        carts[cartId] = selections;
        writeStore(cartsFile, carts);
    }
    return selections;
}

function sendJson(res, status, payload) {
    res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(payload));
}

function body(request) {
    return new Promise((resolve, reject) => {
        let raw = "";
        request.on("data", chunk => { raw += chunk; });
        request.on("end", () => {
            try { resolve(raw ? JSON.parse(raw) : {}); }
            catch { reject(new Error("Invalid JSON")); }
        });
        request.on("error", reject);
    });
}

function eligibleLocation(location) {
    return /oyingbo|ebute\s*metta/i.test(String(location || ""));
}

function totals(items, location) {
    const subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
    const deliveryFee = eligibleLocation(location) ? DELIVERY_FEE : 0;
    return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

async function initializePayment(provider, order, origin) {
    const reference = order.id;
    const callbackUrl = `${origin}/checkout.html?order=${encodeURIComponent(reference)}`;

    if (provider === "paystack" && process.env.PAYSTACK_SECRET_KEY) {
        const response = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                email: order.customer.email,
                amount: order.total * 100,
                currency: "NGN",
                reference,
                callback_url: callbackUrl,
                channels: ["card", "bank", "ussd", "bank_transfer", "mobile_money"]
            })
        });
        const result = await response.json();
        if (!response.ok || !result.status) throw new Error(result.message || "Paystack initialization failed");
        return { checkoutUrl: result.data.authorization_url, mock: false };
    }

    if (provider === "flutterwave" && process.env.FLW_SECRET_KEY) {
        const response = await fetch("https://api.flutterwave.com/v3/payments", {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                tx_ref: reference,
                amount: order.total,
                currency: "NGN",
                redirect_url: callbackUrl,
                payment_options: "card,banktransfer,ussd,opay",
                customer: order.customer,
                customizations: { title: "Alhaja Puff-Puff Hub", description: "Combo order" }
            })
        });
        const result = await response.json();
        if (!response.ok || result.status !== "success") throw new Error(result.message || "Flutterwave initialization failed");
        return { checkoutUrl: result.data.link, mock: false };
    }

    return { checkoutUrl: null, mock: true, message: "Payment credentials are not configured. This order was saved in mock mode." };
}

async function handleApi(request, response, url) {
    const parts = url.pathname.split("/").filter(Boolean);

    if (request.method === "GET" && parts[1] === "products" && parts.length === 2) {
        return sendJson(response, 200, productCatalog);
    }

    if (request.method === "GET" && parts[1] === "cart" && parts[2]) {
        const carts = readStore(cartsFile);
        const selections = readCanonicalCart(carts, parts[2]);
        return sendJson(response, 200, hydrateCart(selections));
    }

    if (request.method === "PUT" && parts[1] === "cart" && parts[2]) {
        const input = await body(request);
        const validated = validateSubmittedCart(input.items);
        if (validated.error) return sendJson(response, 400, { error: validated.error });

        const carts = readStore(cartsFile);
        carts[parts[2]] = validated.selections;
        writeStore(cartsFile, carts);
        return sendJson(response, 200, hydrateCart(validated.selections));
    }

    if (request.method === "POST" && parts[1] === "checkout") {
        const input = await body(request);
        const carts = readStore(cartsFile);
        const selections = readCanonicalCart(carts, input.cartId);
        const items = hydrateCart(selections);
        if (!items.length) return sendJson(response, 400, { error: "Your cart is empty." });
        if (!input.customer?.email || !input.customer?.name || !input.customer?.phone) {
            return sendJson(response, 400, { error: "Name, email, and phone are required." });
        }
        if (!eligibleLocation(input.deliveryLocation)) {
            return sendJson(response, 400, { error: "Delivery is currently available only within Oyingbo and Ebute Metta." });
        }

        const order = {
            id: `PPH-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
            createdAt: new Date().toISOString(),
            items,
            customer: input.customer,
            deliveryLocation: input.deliveryLocation,
            provider: input.provider === "flutterwave" ? "flutterwave" : "paystack",
            paymentStatus: "pending",
            ...totals(items, input.deliveryLocation)
        };
        const orders = readStore(ordersFile);
        orders[order.id] = order;
        writeStore(ordersFile, orders);

        try {
            const payment = await initializePayment(order.provider, order, `http://${request.headers.host}`);
            order.payment = payment;
            orders[order.id] = order;
            writeStore(ordersFile, orders);
            return sendJson(response, 200, { order, ...payment });
        } catch (error) {
            return sendJson(response, 502, { error: error.message });
        }
    }

    sendJson(response, 404, { error: "Not found" });
}

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };

// Keep the static surface explicit. Files such as server.js, .env, package files,
// Git metadata, and customer/order storage are intentionally absent from this list.
const publicFiles = new Map([
    "index.html",
    "combo.html",
    "checkout.html",
    "output.css",
    "data/products.js",
    "data/herodata.js",
    "scripts/header.js",
    "scripts/hero.js",
    "scripts/combo.js",
    "scripts/cartcombo.js",
    "scripts/checkout.js",
    "images/7up.png",
    "images/akara.png",
    "images/american-cola.png",
    "images/bigicola.png",
    "images/buns.png",
    "images/cocacola.png",
    "images/dough.png",
    "images/eggroll.png",
    "images/fanta.png",
    "images/maltina.png",
    "images/puff-puff1.png"
].map(relativePath => [`/${relativePath}`, path.join(root, relativePath)]));

function getPublicFile(requestPath) {
    let decodedPath;
    try { decodedPath = decodeURIComponent(requestPath); }
    catch { return null; }

    if (decodedPath.includes("\0") || decodedPath.includes("\\")) return null;
    if (decodedPath.split("/").some(segment => segment === "." || segment === "..")) return null;

    const normalizedPath = decodedPath === "/" ? "/index.html" : decodedPath;
    return publicFiles.get(normalizedPath) || null;
}

function isSafeRawRequestPath(rawRequestUrl) {
    const rawPath = String(rawRequestUrl || "").split("?", 1)[0];
    if (!rawPath.startsWith("/")) return false;

    let decodedPath;
    try { decodedPath = decodeURIComponent(rawPath); }
    catch { return false; }

    if (rawPath.includes("\\") || rawPath.includes("\0")) return false;
    if (decodedPath.includes("\\") || decodedPath.includes("\0")) return false;
    return !decodedPath.split("/").some(segment => segment === "." || segment === "..");
}

const server = http.createServer(async (request, response) => {
    if (!isSafeRawRequestPath(request.url)) {
        response.writeHead(404); response.end("Not found"); return;
    }

    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
        try { await handleApi(request, response, url); }
        catch (error) { sendJson(response, 500, { error: error.message }); }
        return;
    }
    const file = getPublicFile(url.pathname);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        response.writeHead(404); response.end("Not found"); return;
    }
    response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
});

server.listen(port, () => console.log(`Puff-Puff Hub running at http://localhost:${port}`));
