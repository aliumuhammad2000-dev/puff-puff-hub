const menuBar = document.querySelector("#menu-bar");
const navBar = document.querySelector("#nav-bar1");
const closeMenu = document.querySelector("#close-menu");

menuBar.addEventListener("click", () => {
    navBar.classList.remove("translate-x-full");
});

closeMenu.addEventListener("click", () => {    
    navBar.classList.add("translate-x-full");
});