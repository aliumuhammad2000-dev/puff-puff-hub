const cartId = localStorage.getItem("puffPuffCartId");
const form = document.getElementById("checkout-form");
const message = document.getElementById("checkout-message");
let items = [];

function showMessage(text, error = false) {
    message.textContent = text;
    message.className = `mt-4 rounded-lg p-4 ${error ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`;
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
    if (!cartId) return showMessage("Your cart is empty. Return to the combo page to add items.", true);
    const response = await fetch(`/api/cart/${cartId}`);
    const saved = await response.json();
    if (!saved.length) return showMessage("Your cart is empty. Return to the combo page to add items.", true);
    render(saved);
}

form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const response = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cartId, customer: { name: data.name, email: data.email, phone: data.phone }, deliveryLocation: data.deliveryLocation, provider: data.provider }) });
    const result = await response.json();
    if (!response.ok) return showMessage(result.error || "Unable to start checkout.", true);
    render(items, result.order.deliveryFee);
    if (result.checkoutUrl) return window.location.href = result.checkoutUrl;
    showMessage(`Order ${result.order.id} saved. Payment is in mock mode until payment credentials are configured.`);
});

load().catch(() => showMessage("Unable to load your saved cart. Start the backend with npm start.", true));
