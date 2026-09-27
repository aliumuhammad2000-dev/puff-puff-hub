import { products } from "../data/products.js";

const cartCombo = [];
const cartId = localStorage.getItem("puffPuffCartId") || crypto.randomUUID();
localStorage.setItem("puffPuffCartId", cartId);
let lastSavedCart = [];
let desiredCart = [];
let desiredRevision = 0;
let savedRevision = 0;
let saveError = null;
let savePromise = null;

function cloneCart(items) {
    return items.map(item => ({ ...item }));
}

function applyCart(items) {
    if (!Array.isArray(items)) throw new Error("The server returned an invalid cart.");

    cartCombo.splice(0, cartCombo.length, ...cloneCart(items));
    products.forEach(product => { product.quantity = 0; });
    cartCombo.forEach(item => {
        const product = products.find(product => product.id === item.id);
        if (product) product.quantity = item.quantity;
    });
    document.querySelectorAll("#products-container .quantity[data-id]").forEach(quantityElement => {
        const product = products.find(product => product.id === quantityElement.dataset.id);
        quantityElement.textContent = product?.quantity || 0;
    });
    rendercartCombo();
    renderTotal();
}

function showCartError(text) {
    let message = document.getElementById("cart-message");
    if (!message) {
        message = document.createElement("p");
        message.id = "cart-message";
        message.className = "mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700";
        const cart = document.getElementById("combo-cart-item");
        cart.parentElement.insertBefore(message, cart);
    }
    message.textContent = text;
    message.classList.remove("hidden");
}

function clearCartError() {
    document.getElementById("cart-message")?.classList.add("hidden");
}

export async function loadCart() {
    const response = await fetch(`/api/cart/${cartId}`);
    if (!response.ok) throw new Error("Unable to load cart");
    applyCart(await response.json());
    lastSavedCart = cloneCart(cartCombo);
    desiredCart = cloneCart(cartCombo);
    desiredRevision = 0;
    savedRevision = 0;
    saveError = null;
    clearCartError();
}

async function reloadSavedCart(expectedRevision) {
    const response = await fetch(`/api/cart/${cartId}`);
    if (!response.ok) throw new Error("Unable to reload the saved cart.");
    const canonicalCart = await response.json();
    if (!Array.isArray(canonicalCart)) throw new Error("The server returned an invalid cart.");
    lastSavedCart = cloneCart(canonicalCart);
    if (expectedRevision !== desiredRevision) return false;

    applyCart(canonicalCart);
    desiredCart = cloneCart(cartCombo);
    savedRevision = expectedRevision;
    return true;
}

async function saveLatestCart() {
    while (savedRevision < desiredRevision && !saveError) {
        const revision = desiredRevision;
        const snapshot = cloneCart(desiredCart);

        try {
            const response = await fetch(`/api/cart/${cartId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items: snapshot.map(item => ({ id: item.id, quantity: item.quantity }))
                })
            });
            if (!response.ok) {
                let reason = "The server rejected the cart.";
                try { reason = (await response.json()).error || reason; } catch {}
                throw new Error(reason);
            }

            const canonicalCart = await response.json();
            if (!Array.isArray(canonicalCart)) throw new Error("The server returned an invalid cart.");
            lastSavedCart = cloneCart(canonicalCart);
            savedRevision = revision;

            // A newer edit may already be displayed. Never replace it with an
            // older response; the loop will save the newest desired snapshot.
            if (revision === desiredRevision) {
                applyCart(canonicalCart);
                desiredCart = cloneCart(cartCombo);
                clearCartError();
            }
        } catch (error) {
            // An older request can fail while a newer edit is still waiting.
            // Let the newest snapshot continue through the loop.
            if (revision !== desiredRevision) continue;

            try {
                const restored = await reloadSavedCart(revision);
                if (!restored) continue;
            } catch {
                if (revision !== desiredRevision) continue;
                applyCart(lastSavedCart);
                desiredCart = cloneCart(cartCombo);
                savedRevision = desiredRevision;
            }
            saveError = error;
            showCartError(`Your cart could not be saved. ${error.message} Your last saved cart has been restored.`);
        }
    }

    return !saveError && savedRevision === desiredRevision;
}

function startSaveLoop() {
    if (!savePromise) {
        savePromise = saveLatestCart().finally(() => {
            savePromise = null;
            if (savedRevision < desiredRevision && !saveError) startSaveLoop();
        });
    }
    return savePromise;
}

function queueCartSave() {
    desiredRevision += 1;
    saveError = null;
    clearCartError();
    return startSaveLoop();
}


export async function updateCartCombo(id, quantity) {
    const existingItem = cartCombo.find(item => item.id === id);
    if (quantity === 0) {
        const index = cartCombo.findIndex(item => item.id === id);
        if (index > -1) {
            cartCombo.splice(index, 1);
        }
    }else if (existingItem) {
        existingItem.quantity = quantity;
    }else {
        const product = products.find(product => product.id === id);

        cartCombo.push({
            ...product, quantity
        });
    }
    const product = products.find(product => product.id === id);
    if (product) product.quantity = quantity;
    applyCart(cartCombo);
    desiredCart = cloneCart(cartCombo);
    return queueCartSave();
}

function rendercartCombo() {
    const cart = document.getElementById('combo-cart-item');
    cart.innerHTML = "";
    cartCombo.forEach(item => {
        cart.innerHTML += `
        <div class="rounded-2xl border border-orange-200 p-3">
            <div class="flex items-start gap-3">
                <img src="${item.image}"
                    class="w-16 h-16 rounded-full object-contain"
                    alt="">
                <div class="flex-1">
                    <div class="flex justify-between items-center">
                        <h5 class="font-semibold text-sm">
                            ${item.name}
                        </h5>
                        <button class="remove-cart" data-id="${item.id}">
                            <i class="fa-solid fa-xmark text-gray-400 hover:text-red-500"></i>
                        </button>
                    </div>
                    <p class="text-sm text-gray-500">
                        ${item.price} / ${item.unit}
                    </p>
                    <div class="flex justify-between items-center mt-3">
                        <div class="flex items-center border rounded-lg overflow-hidden">
                            <span class="quantity w-10 text-center font-semibold" data-id="${item.id}">
                                ${item.quantity}
                            </span>
                        </div>
                        <span class="font-bold">
                            &#8358;${item.price * item.quantity} 
                        </span>
                    </div>
                </div>
            </div>
        </div>
        `;
    })

    document.querySelectorAll('.remove-cart').forEach(button => {
        button.addEventListener('click', () => {
            const id = button.dataset.id;

            const index = cartCombo.findIndex(item => item.id === id);
            if (index !== -1) {
                cartCombo.splice(index, 1);
            }
            const quantityElement = document.querySelector(
            `.quantity[data-id="${id}"]`
            );

            if (quantityElement) {
                quantityElement.textContent = 0;
            }
            applyCart(cartCombo);
            desiredCart = cloneCart(cartCombo);
            queueCartSave();
            });
    });
}

function renderTotal() {
    const subtotal = cartCombo.reduce((total, item) => {
        return total + (item.price * item.quantity);
    }, 0);

    const deliveryFee = 0;
    const total = subtotal + deliveryFee;

    document.getElementById("subtotal").textContent = `${subtotal}`;
    document.getElementById("delivery-fee").textContent = `${deliveryFee}`;
    document.getElementById("total").textContent = `${total}`;
}

const cartIcon = document.getElementById("cart-icon");
const comboCart = document.getElementById("combo-cart");
const closeCart = document.getElementById("close-cart");
const addToCart = document.getElementById("add-combo-to-cart");


cartIcon.addEventListener("click", () => {
    comboCart.classList.remove("translate-x-full");
});

closeCart.addEventListener("click", closeComboCart);
function closeComboCart() {
    comboCart.classList.add("translate-x-full");
}

window.addEventListener("scroll", () => {
    comboCart.classList.add("translate-x-full");
});

addToCart.addEventListener("click", () => {
    if (cartCombo.length === 0) {
        alert("Your combo cart is empty. Please add items to the cart before proceeding.");
        return;
    }
    ensureCartSaved().then(saved => {
        if (saved) window.location.href = "checkout.html";
    });
});

async function ensureCartSaved() {
    if (saveError) return false;
    if (savePromise) await savePromise;
    if (savedRevision < desiredRevision) await startSaveLoop();
    return !saveError && savedRevision === desiredRevision;
}

document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("products-container")) loadCart();
});
