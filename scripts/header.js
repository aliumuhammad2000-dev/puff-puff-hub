const menuBar = document.querySelector("#menu-bar");
const navBar = document.querySelector("#nav-bar1");
const closeBtn = document.querySelectorAll(".close-btn");
const cartButton = document.querySelector("#cart-button");
const cart = document.querySelector("#cart");

menuBar.addEventListener("click", () => {
    navBar.classList.remove("translate-x-full");
});

cartButton.addEventListener("click", () => {
    cart.classList.remove("translate-x-full");
});

closeBtn.forEach((btn) => {
    btn.addEventListener("click", () => {
        navBar.classList.add("translate-x-full");
        cart.classList.add("translate-x-full");
    })
});