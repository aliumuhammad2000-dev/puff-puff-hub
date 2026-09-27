const cartId = localStorage.getItem("puffPuffCartId");
const form = document.getElementById("checkout-form");
const message = document.getElementById("checkout-message");
let items = [];

function showMessage(text, error = false, pending = false) {
    message.textContent = text;
    message.className = `mt-4 rounded-lg p-4 ${error ? "bg-red-100 text-red-800" : pending ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-800"}`;
}

function render(itemsToRender, deliveryFee = 0) {
    items = itemsToRender;
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    renderItems(items);
    document.getElementById("subtotal").textContent = subtotal;
    document.getElementById("delivery-fee").textContent = deliveryFee;
    document.getElementById("total").textContent = subtotal + deliveryFee;
}

function renderItems(itemsToRender) {
    const container = document.getElementById("checkout-items");
    container.replaceChildren(...itemsToRender.map(item => {
        const row = document.createElement("div");
        row.className = "flex justify-between gap-4";
        const description = document.createElement("span");
        description.textContent = `${item.name} × ${item.quantity}`;
        const price = document.createElement("span");
        price.textContent = `₦${item.price * item.quantity}`;
        row.append(description, price);
        return row;
    }));
}

async function load() {
    const returnedOrder = new URLSearchParams(window.location.search).get("order");
    if (returnedOrder) {
        disableCheckoutForm();
        await verifyPaymentReturn();
        return;
    }
    if (!cartId) return showMessage("Your cart is empty. Return to the combo page to add items.", true);
    const response = await fetch(`/api/cart/${cartId}`);
    const saved = await response.json();
    if (!saved.length) return showMessage("Your cart is empty. Return to the combo page to add items.", true);
    render(saved);
}

function disableCheckoutForm() {
    form.setAttribute("aria-disabled", "true");
    form.querySelectorAll("input, button, select, textarea").forEach(control => { control.disabled = true; });
}

function returnStateKey(orderId) {
    return `puffPuffReturn:${orderId}`;
}

function readReturnState(orderId) {
    try { return JSON.parse(sessionStorage.getItem(returnStateKey(orderId)) || "{}"); }
    catch { return {}; }
}

async function verifyPaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const orderId = params.get("order");
    const storedState = readReturnState(orderId);
    const legacyToken = orderId ? sessionStorage.getItem(`puffPuffReceiptToken:${orderId}`) : null;
    const storedToken = token || storedState.token || legacyToken;
    if (!orderId || !storedToken) return showMessage("We could not securely verify this payment return.", true);

    const transactionId = params.get("transaction_id") || params.get("transactionId") || storedState.transactionId || null;
    const reference = params.get("reference") || params.get("tx_ref") || storedState.reference || null;
    sessionStorage.setItem(returnStateKey(orderId), JSON.stringify({ token: storedToken, transactionId, reference }));
    if (token) window.history.replaceState({}, document.title, `checkout.html?order=${encodeURIComponent(orderId)}`);

    showMessage("Verifying your payment with the payment provider...", false, true);
    const query = new URLSearchParams({ order: orderId, token: storedToken });
    if (reference) query.set("reference", reference);
    if (transactionId) query.set("transaction_id", transactionId);

    let verificationUnavailable = false;
    try {
        const verificationResponse = await fetch(`/api/payment/verify?${query}`);
        verificationUnavailable = verificationResponse.status === 502;
    }
    catch { verificationUnavailable = true; }

    try {
        const receiptResponse = await fetch(`/api/orders/${encodeURIComponent(orderId)}/receipt`, {
            headers: { Authorization: `Bearer ${storedToken}` }
        });
        if (!receiptResponse.ok) throw new Error("Receipt unavailable");
        const receipt = await receiptResponse.json();
        renderReceipt(receipt);
        if (receipt.paymentStatus === "paid") {
            return showMessage(`Payment verified successfully. Order ${receipt.orderId} is confirmed.`);
        }
        if (receipt.paymentStatus === "failed") {
            return showMessage(`Payment verification failed for order ${receipt.orderId}. Please contact us if you were charged.`, true);
        }
        if (receipt.provider === "flutterwave" && !transactionId) {
            return showMessage(`Order ${receipt.orderId} is still pending. Flutterwave did not return a transaction ID, so payment cannot be independently verified yet.`, false, true);
        }
        if (verificationUnavailable) {
            return showMessage(`Order ${receipt.orderId} is still pending. Payment verification is temporarily unavailable; please try again later.`, false, true);
        }
        showMessage(`Order ${receipt.orderId} is still pending. We have not confirmed payment yet.`, false, true);
    } catch {
        showMessage("We could not load your authorized receipt. Your order remains unchanged.", true);
    }
}

function renderReceipt(receipt) {
    renderItems(receipt.items || []);
    document.getElementById("subtotal").textContent = receipt.subtotal;
    document.getElementById("delivery-fee").textContent = receipt.deliveryFee;
    document.getElementById("total").textContent = receipt.total;
}

form.addEventListener("submit", async event => {
    event.preventDefault();
    if (new URLSearchParams(window.location.search).get("order")) return;
    const data = Object.fromEntries(new FormData(form));
    const response = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cartId, customer: { name: data.name, email: data.email, phone: data.phone }, deliveryLocation: data.deliveryLocation, provider: data.provider }) });
    const result = await response.json();
    if (!response.ok) return showMessage(result.error || "Unable to start checkout.", true);
    if (result.order?.paymentStatus === "paid") {
        return showMessage("Payment confirmed. Your order is already paid and does not need another checkout.");
    }
    render(items, result.order.deliveryFee);
    if (result.checkoutUrl) return window.location.href = result.checkoutUrl;
    if (result.mock === true) {
        return showMessage(`Order ${result.order.id} saved. Payment is in mock mode until payment credentials are configured.`);
    }
    showMessage(`Order ${result.order.id} saved. Payment setup is still pending.`);
});

load().catch(() => showMessage("Unable to load your saved cart. Start the backend with npm start.", true));
