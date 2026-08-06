import { products } from "../data/products.js";

const cartCombo = [];


export function updateCartCombo(id, quantity) {
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
            rendercartCombo();
            renderTotal();
            });
    });
}

function renderTotal() {
    const subtotal = cartCombo.reduce((total, item) => {
        return total + (item.price * item.quantity);
    }, 0);

    const deliveryFee = subtotal > 0 ? 500 : 0;
    const total = subtotal + deliveryFee;

    document.getElementById("subtotal").textContent = `${subtotal}`;
    document.getElementById("delivery-fee").textContent = `${deliveryFee}`;
    document.getElementById("total").textContent = `${total}`;
}

document.addEventListener("DOMContentLoaded", () => {
    rendercartCombo();
    renderTotal();
});