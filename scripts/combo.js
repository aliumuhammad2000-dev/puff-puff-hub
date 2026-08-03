const comboCart = document.querySelector('.combo-cart');
const comboCartIcon = document.querySelector('.combo-cart-icon');

comboCartIcon.addEventListener('click', () => {
    comboCart.classList.toggle('hidden');
});


const decreaseBtn = document.querySelectorAll('.decrease');
const increaseBtn = document.querySelectorAll('.increase');
const quantityText = document.querySelectorAll('.quantity');

let quantity = 10;

increaseBtn.forEach((btn, index) => {
    btn.addEventListener('click', () => {
        quantity += 2;
        quantityText[index].textContent = quantity;
    });
});

decreaseBtn.forEach((btn, index) => {
    btn.addEventListener('click', () => {
        if (quantity > 10) {
            quantity -= 2;
            quantityText[index].textContent = quantity;
        }
    });
});


const goBackBtn = document.getElementById("go-back-btn");
goBackBtn.addEventListener("click", () => {
    window.location.href = "index.html";
});