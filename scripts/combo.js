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
