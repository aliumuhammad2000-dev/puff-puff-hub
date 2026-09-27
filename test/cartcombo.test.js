const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { describe, it } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "cartcombo.js"), "utf8")
    .replace(/^import .*\r?\n/, "")
    .replace("export async function loadCart", "async function loadCart")
    .replace("export async function updateCartCombo", "async function updateCartCombo");

function createHarness(fetchImplementation) {
    const elements = new Map();
    const listeners = new Map();

    function createElement(id) {
        const element = {
            id,
            innerHTML: "",
            textContent: "",
            dataset: {},
            className: "",
            classList: {
                add() {},
                remove() {},
                contains() { return false; }
            },
            parentElement: { insertBefore() {} },
            addEventListener(type, listener) {
                listeners.set(`${id}:${type}`, listener);
            }
        };
        elements.set(id, element);
        return element;
    }

    ["combo-cart-item", "cart-icon", "combo-cart", "close-cart", "add-combo-to-cart", "subtotal", "delivery-fee", "total"].forEach(createElement);
    const productQuantity = { dataset: { id: "maltina" }, textContent: "0" };
    const products = [{
        id: "maltina",
        name: "Maltina",
        image: "./images/maltina.png",
        price: 600,
        unit: "1 bottle",
        category: "drink",
        quantity: 0
    }];
    const context = {
        products,
        fetch: fetchImplementation,
        localStorage: {
            getItem() { return "test-cart"; },
            setItem() {}
        },
        crypto: { randomUUID() { return "test-cart"; } },
        alert() {},
        window: { addEventListener() {}, location: {} },
        document: {
            getElementById(id) {
                return elements.get(id) || null;
            },
            createElement() {
                return createElement("cart-message");
            },
            querySelectorAll(selector) {
                return selector === "#products-container .quantity[data-id]" ? [productQuantity] : [];
            },
            addEventListener() {}
        },
        __listeners: listeners,
        __elements: elements,
        __productQuantity: productQuantity,
        console
    };

    vm.createContext(context);
    vm.runInContext(`${source}\nthis.testApi = { loadCart, updateCartCombo, listeners: this.__listeners, elements: this.__elements, productQuantity: this.__productQuantity, window: this.window };`, context);
    return context.testApi;
}

function response(payload, ok = true) {
    return { ok, async json() { return payload; } };
}

describe("cart save synchronization", () => {
    it("saves rapid edits in order without applying an older response", async () => {
        const pendingPuts = [];
        const calls = [];
        const fetchMock = async (url, options = {}) => {
            calls.push({ url, options });
            if (!options.method) return response([{ id: "maltina", name: "Maltina", image: "./images/maltina.png", price: 600, unit: "1 bottle", category: "drink", quantity: 2 }]);
            return new Promise(resolve => pendingPuts.push(resolve));
        };
        const api = createHarness(fetchMock);
        await api.loadCart();
        assert.equal(api.productQuantity.textContent, 2);

        const first = api.updateCartCombo("maltina", 4);
        const second = api.updateCartCombo("maltina", 6);
        api.listeners.get("add-combo-to-cart:click")();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(pendingPuts.length, 1);

        pendingPuts.shift()(response([{ id: "maltina", name: "Maltina", image: "./images/maltina.png", price: 600, unit: "1 bottle", category: "drink", quantity: 4 }]));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(pendingPuts.length, 1);
        pendingPuts.shift()(response([{ id: "maltina", name: "Maltina", image: "./images/maltina.png", price: 600, unit: "1 bottle", category: "drink", quantity: 6 }]));

        await Promise.all([first, second]);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(api.elements.get("combo-cart-item").innerHTML.includes("6"), true);
        assert.equal(api.productQuantity.textContent, 6);
        assert.equal(api.window.location.href, "checkout.html");
        assert.deepEqual(calls.slice(1).map(call => JSON.parse(call.options.body).items[0].quantity), [4, 6]);
    });

    it("restores the saved cart and blocks checkout after a failed save", async () => {
        let offline = true;
        const fetchMock = async (url, options = {}) => {
            if (!options.method) return response([{ id: "maltina", name: "Maltina", image: "./images/maltina.png", price: 600, unit: "1 bottle", category: "drink", quantity: 2 }]);
            if (offline) throw new Error("offline");
            return response([{ id: "maltina", name: "Maltina", image: "./images/maltina.png", price: 600, unit: "1 bottle", category: "drink", quantity: 4 }]);
        };
        const api = createHarness(fetchMock);
        await api.loadCart();

        const saved = await api.updateCartCombo("maltina", 4);
        assert.equal(saved, false);
        assert.equal(api.elements.get("combo-cart-item").innerHTML.includes("2"), true);
        assert.equal(api.productQuantity.textContent, 2);
        assert.equal(api.elements.get("cart-message").textContent.includes("could not be saved"), true);

        api.listeners.get("add-combo-to-cart:click")();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(api.window.location.href, undefined);

        offline = false;
        const savedAfterReconnect = await api.updateCartCombo("maltina", 4);
        assert.equal(savedAfterReconnect, true);
        assert.equal(api.productQuantity.textContent, 4);
        api.listeners.get("add-combo-to-cart:click")();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(api.window.location.href, "checkout.html");
    });
});
