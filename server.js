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
const PAYSTACK_API_BASE = process.env.PAYSTACK_API_BASE_URL || "https://api.paystack.co";
const FLW_API_BASE = process.env.FLW_API_BASE_URL || "https://api.flutterwave.com";
const MAX_REQUEST_BYTES = 256 * 1024;

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

function saveOrder(order) {
    const orders = readStore(ordersFile);
    orders[order.id] = order;
    writeStore(ordersFile, orders);
}

function rawBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let rejected = false;
        request.on("data", chunk => {
            if (rejected) return;
            size += chunk.length;
            if (size > MAX_REQUEST_BYTES) {
                rejected = true;
                request.resume();
                const error = new Error("Request body too large.");
                error.statusCode = 413;
                reject(error);
                return;
            }
            chunks.push(chunk);
        });
        request.on("end", () => {
            if (!rejected) resolve(Buffer.concat(chunks));
        });
        request.on("error", reject);
    });
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
        rawBody(request).then(raw => {
            try { resolve(raw.length ? JSON.parse(raw.toString("utf8")) : {}); }
            catch { reject(new Error("Invalid JSON")); }
        }).catch(reject);
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

function timingSafeEqualText(left, right) {
    if (typeof left !== "string" || typeof right !== "string") return false;
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function paymentResult(order, status, details = {}) {
    return {
        status,
        invalid: Boolean(details.invalid),
        temporary: Boolean(details.temporary),
        provider: order.provider,
        reference: details.reference || order.id,
        transactionId: details.transactionId || null,
        providerStatus: details.providerStatus || null,
        amount: details.amount ?? null,
        currency: details.currency || null,
        error: details.error || null
    };
}

function invalidPaymentResult(order, details = {}) {
    return paymentResult(order, null, { ...details, invalid: true });
}

function temporaryPaymentResult(order, details = {}) {
    return paymentResult(order, "pending", { ...details, temporary: true });
}

async function verifyPaystack(order, reference) {
    if (order.provider !== "paystack") return invalidPaymentResult(order, { error: "Payment provider mismatch." });
    if (reference !== order.id) return invalidPaymentResult(order, { reference, error: "Payment reference mismatch." });
    if (!process.env.PAYSTACK_SECRET_KEY) return temporaryPaymentResult(order, { error: "Paystack credentials are not configured." });

    let response;
    try {
        response = await fetch(`${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
        });
    } catch {
        return temporaryPaymentResult(order, { reference, error: "Paystack verification is unavailable." });
    }

    let result;
    try { result = await response.json(); }
    catch { return temporaryPaymentResult(order, { reference, error: "Invalid Paystack verification response." }); }
    if (!response.ok || !result.status || !result.data) {
        return temporaryPaymentResult(order, { reference, error: result.message || "Paystack verification failed." });
    }

    const data = result.data;
    const amount = Number(data.amount);
    const currency = String(data.currency || "").toUpperCase();
    const details = {
        reference: data.reference,
        transactionId: data.id,
        providerStatus: data.status,
        amount,
        currency
    };
    if (data.reference !== order.id || currency !== "NGN" || amount !== order.total * 100) {
        return invalidPaymentResult(order, { ...details, error: "Paystack transaction details do not match the order." });
    }
    if (data.status === "success") return paymentResult(order, "paid", details);
    if (["failed", "abandoned", "reversed"].includes(data.status)) return paymentResult(order, "failed", details);
    return paymentResult(order, "pending", details);
}

async function verifyFlutterwave(order, transactionId, reference = order.id) {
    if (order.provider !== "flutterwave") return invalidPaymentResult(order, { error: "Payment provider mismatch." });
    if (reference !== order.id) return invalidPaymentResult(order, { reference, transactionId, error: "Payment reference mismatch." });
    if (!transactionId) return invalidPaymentResult(order, { reference, error: "Flutterwave transaction ID is missing." });
    if (!process.env.FLW_SECRET_KEY) return temporaryPaymentResult(order, { reference, transactionId, error: "Flutterwave credentials are not configured." });

    let response;
    try {
        response = await fetch(`${FLW_API_BASE}/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
            headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` }
        });
    } catch {
        return temporaryPaymentResult(order, { reference, transactionId, error: "Flutterwave verification is unavailable." });
    }

    let result;
    try { result = await response.json(); }
    catch { return temporaryPaymentResult(order, { reference, transactionId, error: "Invalid Flutterwave verification response." }); }
    if (!response.ok || result.status !== "success" || !result.data) {
        return temporaryPaymentResult(order, { reference, transactionId, error: result.message || "Flutterwave verification failed." });
    }

    const data = result.data;
    const amount = Number(data.amount);
    const currency = String(data.currency || "").toUpperCase();
    const details = {
        reference: data.tx_ref,
        transactionId: data.id,
        providerStatus: data.status,
        amount,
        currency
    };
    if (String(data.id) !== String(transactionId) || data.tx_ref !== order.id || currency !== "NGN" || amount !== order.total) {
        return invalidPaymentResult(order, { ...details, error: "Flutterwave transaction details do not match the order." });
    }
    if (data.status === "successful") return paymentResult(order, "paid", details);
    if (["failed", "cancelled", "canceled"].includes(data.status)) return paymentResult(order, "failed", details);
    return paymentResult(order, "pending", details);
}

async function verifyOrderPayment(order, details = {}) {
    if (order.payment?.mock) return temporaryPaymentResult(order, { error: "Mock payments are never marked as paid." });
    if (order.paymentStatus === "paid") {
        const verification = order.paymentVerification || {};
        if (details.reference && details.reference !== order.id) {
            return invalidPaymentResult(order, { reference: details.reference, transactionId: details.transactionId, error: "Payment reference mismatch." });
        }
        if (details.transactionId && verification.transactionId && String(details.transactionId) !== String(verification.transactionId)) {
            return invalidPaymentResult(order, { reference: details.reference || order.id, transactionId: details.transactionId, error: "Payment transaction ID mismatch." });
        }
        return paymentResult(order, "paid", verification);
    }
    if (order.provider === "paystack") return verifyPaystack(order, details.reference || order.id);
    return verifyFlutterwave(order, details.transactionId, details.reference || order.id);
}

function persistPaymentResult(order, result, source) {
    const orders = readStore(ordersFile);
    const latest = orders[order.id];
    if (!latest || result.invalid || latest.paymentStatus === "paid") return latest || order;
    if (latest.paymentStatus === "failed" && result.status === "pending") return latest;

    latest.paymentStatus = result.status;
    latest.paymentVerification = {
        provider: result.provider,
        reference: result.reference,
        transactionId: result.transactionId,
        providerStatus: result.providerStatus,
        amount: result.amount,
        currency: result.currency,
        source,
        error: result.error,
        verifiedAt: new Date().toISOString()
    };
    orders[latest.id] = latest;
    writeStore(ordersFile, orders);
    return latest;
}

function minimalPaymentStatus(order) {
    return {
        orderId: order.id,
        provider: order.provider,
        paymentStatus: order.paymentStatus,
        verification: order.paymentVerification ? {
            providerStatus: order.paymentVerification.providerStatus,
            verifiedAt: order.paymentVerification.verifiedAt,
            error: order.paymentVerification.error || null
        } : null
    };
}

function callbackUrl(order, origin, provider) {
    const hasCredentials = provider === "paystack" ? Boolean(process.env.PAYSTACK_SECRET_KEY) : Boolean(process.env.FLW_SECRET_KEY);
    const configuredBase = process.env.PUBLIC_BASE_URL;
    if (hasCredentials && (!configuredBase || !/^https:\/\/[^/]+/i.test(configuredBase))) {
        throw new Error("PUBLIC_BASE_URL must be an HTTPS URL when real payment credentials are configured.");
    }
    const base = (configuredBase || origin).replace(/\/+$/, "");
    return `${base}/checkout.html?order=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.callbackToken)}`;
}

async function initializePayment(provider, order, origin) {
    const reference = order.id;
    const callback = callbackUrl(order, origin, provider);

    if (provider === "paystack" && process.env.PAYSTACK_SECRET_KEY) {
        const response = await fetch(`${PAYSTACK_API_BASE}/transaction/initialize`, {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                email: order.customer.email,
                amount: order.total * 100,
                currency: "NGN",
                reference,
                callback_url: callback,
                channels: ["card", "bank", "ussd", "bank_transfer", "mobile_money"]
            })
        });
        const result = await response.json();
        if (!response.ok || !result.status) throw new Error(result.message || "Paystack initialization failed");
        return { checkoutUrl: result.data.authorization_url, mock: false };
    }

    if (provider === "flutterwave" && process.env.FLW_SECRET_KEY) {
        const response = await fetch(`${FLW_API_BASE}/v3/payments`, {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                tx_ref: reference,
                amount: order.total,
                currency: "NGN",
                redirect_url: callback,
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

function checkoutResponse(order, payment = {}) {
    const responseOrder = { ...order };
    if (order.payment) responseOrder.payment = { ...order.payment };
    const responsePayment = { ...payment };
    if (order.paymentStatus === "paid") {
        delete responseOrder.payment?.checkoutUrl;
        delete responsePayment.checkoutUrl;
    }
    return { order: responseOrder, ...responsePayment };
}

async function handleApi(request, response, url) {
    const parts = url.pathname.split("/").filter(Boolean);

    if (request.method === "GET" && parts[1] === "payment" && parts[2] === "verify" && parts.length === 3) {
        const orderId = url.searchParams.get("order");
        const token = url.searchParams.get("token");
        const orders = readStore(ordersFile);
        const order = orders[orderId];
        if (!order || !timingSafeEqualText(order.callbackToken, token)) {
            return sendJson(response, 404, { error: "Payment verification request not found." });
        }

        const provider = url.searchParams.get("provider");
        if (provider && provider !== order.provider) {
            return sendJson(response, 400, { ...minimalPaymentStatus(order), error: "Payment provider mismatch." });
        }

        const result = await verifyOrderPayment(order, {
            reference: url.searchParams.get("reference") || url.searchParams.get("tx_ref") || order.id,
            transactionId: url.searchParams.get("transaction_id") || url.searchParams.get("transactionId")
        });
        const latest = persistPaymentResult(order, result, "callback");
        const status = result.invalid ? 400 : (result.temporary && latest.paymentStatus !== "paid" ? 502 : 200);
        return sendJson(response, status, { ...minimalPaymentStatus(latest), error: result.error || null });
    }

    if (request.method === "POST" && parts[1] === "webhooks" && parts.length === 3) {
        const provider = parts[2];
        if (provider !== "paystack" && provider !== "flutterwave") {
            return sendJson(response, 404, { error: "Not found" });
        }

        const raw = await rawBody(request);
        const signature = provider === "paystack"
            ? request.headers["x-paystack-signature"]
            : request.headers["verif-hash"];
        const expected = provider === "paystack"
            ? (process.env.PAYSTACK_SECRET_KEY ? crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(raw).digest("hex") : null)
            : process.env.FLW_SECRET_HASH;
        if (!expected || !timingSafeEqualText(String(signature || ""), expected)) {
            return sendJson(response, 401, { error: "Invalid webhook signature." });
        }

        let payload;
        try { payload = raw.length ? JSON.parse(raw.toString("utf8")) : {}; }
        catch { return sendJson(response, 400, { error: "Invalid webhook payload." }); }

        const reference = provider === "paystack" ? payload.data?.reference : payload.data?.tx_ref;
        const transactionId = provider === "flutterwave" ? payload.data?.id : payload.data?.id;
        const orders = readStore(ordersFile);
        const order = orders[reference];
        if (!order || order.provider !== provider) return sendJson(response, 404, { error: "Order not found." });
        const result = await verifyOrderPayment(order, { reference, transactionId });
        const latest = persistPaymentResult(order, result, "webhook");
        const status = result.invalid ? 400 : (result.temporary && latest.paymentStatus !== "paid" ? 502 : 200);
        return sendJson(response, status, { ...minimalPaymentStatus(latest), error: result.error || null });
    }

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
            callbackToken: crypto.randomBytes(24).toString("hex"),
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
            const latestOrders = readStore(ordersFile);
            const latest = latestOrders[order.id] || order;
            latest.payment = payment;
            latestOrders[latest.id] = latest;
            writeStore(ordersFile, latestOrders);
            return sendJson(response, 200, checkoutResponse(latest, payment));
        } catch (error) {
            const latest = readStore(ordersFile)[order.id] || order;
            if (latest.paymentStatus === "paid") {
                return sendJson(response, 200, checkoutResponse(latest, latest.payment || {}));
            }
            return sendJson(response, 502, { error: error.message, order: latest });
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
        catch (error) { sendJson(response, error.statusCode || 500, { error: error.message }); }
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
