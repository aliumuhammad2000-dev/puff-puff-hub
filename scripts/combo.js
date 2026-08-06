import { products } from "../data/products.js";
import { updateCartCombo } from "./cartcombo.js";


const goBackBtn = document.getElementById("go-back-btn");
goBackBtn.addEventListener("click", () => {
    window.location.href = "index.html";
});

const productsContainer = document.getElementById("products-container");

products.forEach((product) => {
    productsContainer.innerHTML += `
    <div class="bg-white rounded-2xl p-3 sm:p-4 flex flex-col items-center shadow-sm">
            <img src="${product.image}" alt="${product.name}"
                class="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 object-contain rounded-full">
            <h5 class="text-sm sm:text-base md:text-lg font-semibold mt-2">
                ${product.name}
            </h5>
            <span class="text-xs sm:text-sm md:text-base font-bold">
                &#8358;${product.price}${product.unit ? ` / ${product.unit}` : ""}
            </span>
            <div class="flex items-center rounded-lg mt-3 border border-gray-300 overflow-hidden">
                <button
                    class="decrease w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center border-r border-gray-300 text-orange-500 hover:bg-orange-500 hover:text-white transition" data-id="${product.id}">
                    -
                </button>

                <span class="quantity w-10 sm:w-12 h-7 sm:h-8 flex items-center justify-center font-semibold text-sm" data-id="${product.id}">
                    ${product.quantity || 0}
                </span>

                <button
                    class="increase w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center border-l border-gray-300 text-orange-500 hover:bg-orange-500 hover:text-white transition" data-id="${product.id}">
                    +
                </button>
            </div>
        </div>
        `;
        
    }
);


document.querySelectorAll('.increase').forEach((button) => {
    button.addEventListener('click', () => {
        const id = button.dataset.id;
        const quantityElement = document.querySelector(`.quantity[data-id="${id}"]`
        );

        const product = products.find(product => product.id === id)

        let quantity = Number(quantityElement.textContent);
        if (product.category === "snack") {
            quantity += 2
        }else {
            quantity += 1
        }

        quantityElement.textContent = quantity;
        updateCartCombo(id, quantity);
    });
});

document.querySelectorAll('.decrease').forEach((button) => {
    button.addEventListener('click', () => {
        const id = button.dataset.id;
        const quantityElement = document.querySelector(`.quantity[data-id="${id}"]`
        );

        const product = products.find(product => product.id === id);

        let quantity = Number(quantityElement.textContent);
        if (product.category === "snack") {
            quantity = Math.max(0, quantity - 2)
        }else {
            quantity = Math.max(0, quantity - 1)
        }

        quantityElement.textContent = quantity;
        updateCartCombo(id, quantity);
    });
});

