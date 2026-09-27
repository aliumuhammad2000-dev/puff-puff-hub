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
    document.getElementById("checkout-items").innerHTML = items.map(item => `<div class="flex justify-between gap-4"><span>${item.name} × ${item.quantity}</span><span>₦${item.price * item.quantity}</span></div>`).join("");
    document.getElementById("subtotal").textContent = subtotal;
    document.getElementById("delivery-fee").textContent = deliveryFee;
    document.getElementById("total").textContent = subtotal + deliveryFee;
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

async function verifyPaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) return showMessage("We could not securely verify this payment return.", true);

    showMessage("Verifying your payment with the payment provider...", false, true);
    const query = new URLSearchParams({ order: params.get("order"), token });
    ["reference", "tx_ref", "transaction_id", "transactionId"].forEach(name => {
        if (params.get(name)) query.set(name, params.get(name));
    });

    try {
        const response = await fetch(`/api/payment/verify?${query}`);
        const result = await response.json();
        if (!response.ok) {
            return showMessage(result.error || "We could not verify your payment yet. The order remains pending.", true);
        }
        if (result.paymentStatus === "paid") {
            return showMessage("Payment verified successfully. Your order is confirmed.");
        }
        if (result.paymentStatus === "failed") {
            return showMessage("Payment verification failed. Please try payment again.", true);
        }
        showMessage("Payment is still pending. We have not confirmed the order yet.", false, true);
    } catch {
        showMessage("We could not reach the payment verification service. Your order remains pending.", true);
    }
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
