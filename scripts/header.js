const menuBar = document.querySelector("#menu-bar");
const navBar = document.querySelector("#nav-bar1");
const closeBtn = document.querySelectorAll(".close-btn");
const menuLink = document.querySelector("#menu-link");
const dropdown = document.querySelector("#dropdown");
const arrow = document.querySelector("#arrow");

menuBar?.addEventListener("click", () => {
    navBar.classList.remove("translate-x-full");
});

menuLink?.addEventListener("click", () => {
    arrow.classList.add("rotate-180");

    if (dropdown.classList.contains("max-h-0")) {
        dropdown.classList.remove("max-h-0");
        dropdown.classList.add("max-h-60");
    } else {
        dropdown.classList.remove("max-h-60");
        dropdown.classList.add("max-h-0");
    }
});

closeBtn.forEach((btn) => {
    btn.addEventListener("click", () => {
        navBar.classList.add("translate-x-full");
    })
});

