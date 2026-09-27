const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { after, before, describe, it } = require("node:test");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
let child;
let port;
let tempDir;

function request(rawPath, options = {}) {
    const { body, ...requestOptions } = options;
    return new Promise((resolve, reject) => {
        const request = http.request({ host: "127.0.0.1", port, path: rawPath, ...requestOptions }, response => {
            const chunks = [];
            response.on("data", chunk => chunks.push(chunk));
            response.on("end", () => resolve({
                status: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks)
            }));
        });
        request.on("error", reject);
        request.end(body);
    });
}

function jsonRequest(rawPath, payload, method = "POST") {
    return request(rawPath, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
}

before(async () => {
    port = 5800 + Math.floor(Math.random() * 200);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "puff-puff-hub-pricing-"));
    const env = { ...process.env, PORT: String(port), DATA_DIR: tempDir };
    delete env.PAYSTACK_SECRET_KEY;
    delete env.FLW_SECRET_KEY;
    child = spawn(process.execPath, ["server.js"], {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"]
    });
    await once(child.stdout, "data");
});

after(() => {
    child.kill();
    fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("server-validated product pricing", () => {
    it("serves the authoritative product catalog", async () => {
        const result = await request("/api/products");
        assert.equal(result.status, 200);

        const catalog = JSON.parse(result.body.toString());
        assert.equal(catalog.length, 10);
        assert.deepEqual(catalog.find(product => product.id === "maltina"), {
            id: "maltina",
            name: "Maltina",
            image: "./images/maltina.png",
            price: 600,
            unit: "1 bottle",
            category: "drink"
        });
    });

    it("stores selections by ID and returns canonical product details", async () => {
        const result = await jsonRequest("/api/cart/normal-cart", {
            items: [
                { id: "puff-puff", quantity: 2 },
                { id: "maltina", quantity: 3 }
            ]
        }, "PUT");

        assert.equal(result.status, 200);
        assert.deepEqual(JSON.parse(result.body.toString()), [
            {
                id: "puff-puff",
                name: "Puff-Puff",
                image: "./images/dough.png",
                price: 50,
                unit: "1pcs",
                category: "snack",
                quantity: 2
            },
            {
                id: "maltina",
                name: "Maltina",
                image: "./images/maltina.png",
                price: 600,
                unit: "1 bottle",
                category: "drink",
                quantity: 3
            }
        ]);

        const stored = JSON.parse(fs.readFileSync(path.join(tempDir, "carts.json"), "utf8"));
        assert.deepEqual(stored["normal-cart"], [
            { id: "puff-puff", quantity: 2 },
            { id: "maltina", quantity: 3 }
        ]);
    });

    it("ignores manipulated client prices and names", async () => {
        const result = await jsonRequest("/api/cart/manipulated-cart", {
            items: [{ id: "maltina", name: "Free Maltina", price: 1, quantity: 2 }]
        }, "PUT");

        assert.equal(result.status, 200);
        const item = JSON.parse(result.body.toString())[0];
        assert.equal(item.name, "Maltina");
        assert.equal(item.price, 600);

        const stored = JSON.parse(fs.readFileSync(path.join(tempDir, "carts.json"), "utf8"));
        assert.deepEqual(stored["manipulated-cart"], [{ id: "maltina", quantity: 2 }]);
    });

    it("rejects unknown, duplicate, invalid, negative, excessive and odd snack quantities", async () => {
        const invalidCases = [
            [{ id: "not-a-product", quantity: 1 }],
            [{ id: "maltina", quantity: 1 }, { id: "maltina", quantity: 2 }],
            [{ id: "maltina", quantity: 1.5 }],
            [{ id: "maltina", quantity: -1 }],
            [{ id: "maltina", quantity: 1001 }],
            [{ id: "puff-puff", quantity: 3 }]
        ];

        for (const [index, items] of invalidCases.entries()) {
            const result = await jsonRequest(`/api/cart/invalid-${index}`, { items }, "PUT");
            assert.equal(result.status, 400);
            assert.ok(JSON.parse(result.body.toString()).error);
        }
    });

    it("canonicalizes tampered stored carts and calculates checkout totals server-side", async () => {
        fs.writeFileSync(path.join(tempDir, "carts.json"), JSON.stringify({
            "tampered-cart": [{
                id: "maltina",
                name: "Fake product",
                image: "fake.png",
                price: 1,
                quantity: 2
            }]
        }));

        const cartResult = await request("/api/cart/tampered-cart");
        assert.equal(cartResult.status, 200);
        const cartItem = JSON.parse(cartResult.body.toString())[0];
        assert.equal(cartItem.name, "Maltina");
        assert.equal(cartItem.price, 600);

        const checkoutResult = await jsonRequest("/api/checkout", {
            cartId: "tampered-cart",
            customer: { name: "Test Customer", email: "test@example.com", phone: "08000000000" },
            deliveryLocation: "Oyingbo",
            provider: "paystack"
        });

        assert.equal(checkoutResult.status, 200);
        const result = JSON.parse(checkoutResult.body.toString());
        assert.equal(result.order.subtotal, 1200);
        assert.equal(result.order.deliveryFee, 500);
        assert.equal(result.order.total, 1700);
        assert.equal(result.order.items[0].price, 600);
        assert.equal(result.mock, true);
    });
});
