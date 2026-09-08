import { products } from "../data/products.js";

const cartCombo = [];
const cartId = localStorage.getItem("puffPuffCartId") || crypto.randomUUID();
localStorage.setItem("puffPuffCartId", cartId);

export async function loadCart() {
    const response = await fetch(`/api/cart/${cartId}`);
    if (!response.ok) throw new Error("Unable to load cart");
    cartCombo.splice(0, cartCombo.length, ...(await response.json()));
    cartCombo.forEach(item => {
        const product = products.find(product => product.id === item.id);
        if (product) product.quantity = item.quantity;
    });
    rendercartCombo();
    renderTotal();
}

async function persistCart() {
    await fetch(`/api/cart/${cartId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cartCombo })
    });
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
    await persistCart();
    rendercartCombo();
    renderTotal();
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
                            <i class="remove-cart fa-solid fa-xmark text-gray-400 hover:text-red-500"></i>
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
            persistCart();
            rendercartCombo();
            renderTotal();
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
    window.location.href = "checkout.html";
});

document.addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("products-container")) loadCart();
});
