const slides = [
    {
        image: 'images/puff-puff1.png',
        subtitle: 'HOT. FRESH. DELICIOUS.',
        title: 'Puff-Puff',
        loveMessage: 'Made With Love',
        description: 'Golden crisp on the outside, fluffy on the inside, our puff-puff are a delightful treat for everyone. Order now and enjoy the taste you love!'
    },
    {
        image: 'images/buns.png',
        subtitle: 'CRUNCHY. SOFT. TASTY.',
        title: 'Buns',
        loveMessage: 'Made With Love',
        description: 'Our buns are baked to perfection, offering a soft and fluffy texture that melts in your mouth. Perfect for any occasion, grab a pack today!'
    },
    {
        image: 'images/eggroll.png',
        subtitle: 'CRISPY. SAVORY. DELICIOUS.',
        title: 'Eggrolls',
        loveMessage: 'Made With Love',
        description: 'Crispy on the outside, savory on the inside, our eggrolls are a delicious choice for any meal. Order now and satisfy your cravings!'
    },
    {
        image: 'images/akara.png',
        subtitle: 'SPICY. FLAVORFUL. TRADITIONAL.',
        title: 'Akara',
        loveMessage: 'Made With Love',
        description: 'Our akara is a traditional favorite, packed with flavor and spice. Enjoy the authentic taste of this beloved dish, perfect for any time of day!'
    }
];

let current = 0;

const heroImage = document.querySelector(".hero-image");
const heroSubtitle = document.getElementById("subTitle");
const heroTitle = document.getElementById("title");
const heroLoveMessage = document.getElementById("love-message");
const heroDescription = document.getElementById("description");

function showSlides() {

    heroImage.classList.add("opacity-0");
    heroSubtitle.classList.add("opacity-0");
    heroTitle.classList.add("opacity-0");
    heroLoveMessage.classList.add("opacity-0");
    heroDescription.classList.add("opacity-0");

    setTimeout(() => {

        current++; 
        if(current >= slides.length){ current = 0; }

        heroImage.src = slides[current].image;
        heroSubtitle.textContent = slides[current].subtitle;
        heroTitle.textContent = slides[current].title;
        heroLoveMessage.innerHTML = `${slides[current].loveMessage} <i class="fa-regular fa-heart"></i>`;
        heroDescription.textContent = slides[current].description;

        // Fade IN together
        heroImage.classList.remove("opacity-0");
        heroSubtitle.classList.remove("opacity-0");
        heroTitle.classList.remove("opacity-0");
        heroLoveMessage.classList.remove("opacity-0");
        heroDescription.classList.remove("opacity-0");

    }, 500);
}

heroImage.src = slides[0].image;
heroSubtitle.textContent = slides[0].subtitle;
heroTitle.textContent = slides[0].title;
heroLoveMessage.innerHTML = `${slides[0].loveMessage} <i class="fa-regular fa-heart"></i>`;
heroDescription.textContent = slides[0].description;

setInterval(showSlides, 5000);