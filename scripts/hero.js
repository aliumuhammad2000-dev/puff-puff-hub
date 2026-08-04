import { slides } from "../data/herodata.js";

let current = 0;

const heroImage = document.querySelector(".hero-image");
const heroSubtitle = document.getElementById("subTitle");
const heroTitle = document.getElementById("title");
const heroLoveMessage = document.getElementById("love-message");
const heroDescription = document.getElementById("description");

const heroSlider = document.getElementById("hero-slider");
const orderNowBtn = document.getElementById("order-now-btn");

const elements = [
    heroImage,
    heroSubtitle,
    heroTitle,
    heroLoveMessage,
    heroDescription
];

slides.forEach(slide => {
    const img = new Image();
    img.src = slide.image;
});

function updateSlide(index) {
    heroImage.src = slides[index].image;
    heroSubtitle.textContent = slides[index].subtitle;
    heroTitle.textContent = slides[index].title;
    heroLoveMessage.innerHTML =
        `${slides[index].loveMessage} <i class="fa-regular fa-heart"></i>`;
    heroDescription.textContent = slides[index].description;
}
updateSlide(0);

function showSlides() {
    elements.forEach(element => {
        element.classList.add("opacity-0");
    });

    setTimeout(() => {
        current = (current + 1) % slides.length;
        updateSlide(current);
        elements.forEach(element => {
            element.classList.remove("opacity-0");
        });

    }, 500);
}

let slideInterval;

function startSlider() {
    clearInterval(slideInterval);
    slideInterval = setInterval(showSlides, 5000);
}

function stopSlider() {
    clearInterval(slideInterval);
}

if (heroSlider) {
    heroSlider.addEventListener("mouseenter", stopSlider);
    heroSlider.addEventListener("mouseleave", startSlider);
    startSlider();
}

if (orderNowBtn) {
    orderNowBtn.addEventListener("click", () => {
        window.location.href = "./combo.html";
    });
}