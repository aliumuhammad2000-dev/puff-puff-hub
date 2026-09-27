import { loadProducts, products } from "../data/products.js";
import { loadCart, updateCartCombo } from "./cartcombo.js";


const goBackBtn = document.getElementById("go-back-btn");
goBackBtn.addEventListener("click", () => {
    window.location.href = "index.html";
});

const productsContainer = document.getElementById("products-container");

loadProducts()
    .then(() => loadCart())
    .then(() => renderProducts(products));

function renderProducts(productsToRender) {
    productsContainer.innerHTML = "";

    productsToRender.forEach(product => {
        productsContainer.innerHTML += `
        <article class="group relative flex min-h-[270px] flex-col overflow-hidden rounded-3xl border border-orange-100 bg-white p-3 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-orange-200 hover:shadow-xl sm:p-4">
            <div class="absolute right-3 top-3 rounded-full bg-orange-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-orange-600">
                ${product.category === "snack" ? "Snack" : "Drink"}
            </div>
            <div class="relative flex h-36 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50 to-orange-100 transition-transform duration-300 group-hover:scale-[1.03]">
                <img src="${product.image}" alt="${product.name}"
                    class="h-full w-full object-cover object-center drop-shadow-md transition-transform duration-500 group-hover:scale-110">
            </div>
            <div class="flex flex-1 flex-col pt-3">
                <h5 class="text-base font-bold text-gray-900 sm:text-lg">
                    ${product.name}
                </h5>
                <span class="mt-1 text-sm font-bold text-orange-600">
                    &#8358;${product.price}<span class="font-normal text-gray-500">${product.unit ? ` / ${product.unit}` : ""}</span>
                </span>
            </div>
            <div class="mt-3 flex items-center justify-between rounded-xl border border-orange-100 bg-orange-50/60 p-1">
                <button
                    type="button" aria-label="Decrease ${product.name} quantity"
                    class="decrease flex h-8 w-8 items-center justify-center rounded-lg text-lg font-medium text-orange-600 transition hover:bg-orange-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-300" data-id="${product.id}">
                    -
                </button>

                <span class="quantity min-w-10 text-center text-sm font-bold text-gray-800" data-id="${product.id}">
                    ${product.quantity || 0}
                </span>

                <button
                    type="button" aria-label="Increase ${product.name} quantity"
                    class="increase flex h-8 w-8 items-center justify-center rounded-lg border border-orange-500 bg-transparent text-lg font-medium text-orange-500 shadow-sm transition hover:bg-orange-500 hover:text-white active:bg-white active:text-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-300" data-id="${product.id}">
                    +
                </button>
            </div>
        </article>
        `;
    });
    updateQuantity();
}

document.querySelectorAll('.filter-btn').forEach(button => {
    button.addEventListener("click", () => {
        const category = button.dataset.category;

        if (category === "all") {
            renderProducts(products);
        }else {
            const filteredProducts = products.filter(product => product.category === category);
            renderProducts(filteredProducts);
        }
    })
})


function updateQuantity() {

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
}

