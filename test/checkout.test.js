const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { describe, it } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "checkout.js"), "utf8");

function response(payload, ok = true) {
    return { ok, async json() { return payload; } };
}

function createHarness(checkoutResult, search = "") {
    const elements = new Map();
    const listeners = new Map();
    const calls = [];
    const controls = [{ disabled: false }, { disabled: false }];

    function createElement(id) {
        const element = {
            id,
            innerHTML: "",
            textContent: "",
            className: "",
            disabled: false,
            attributes: {},
            setAttribute(name, value) { this.attributes[name] = value; },
            querySelectorAll() { return controls; },
            addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); }
        };
        elements.set(id, element);
        return element;
    }

    ["checkout-form", "checkout-message", "checkout-items", "subtotal", "delivery-fee", "total"].forEach(createElement);
    const context = {
        URLSearchParams,
        FormData: class MockFormData {
            constructor() {
                this.values = { name: "Test Customer", email: "test@example.com", phone: "08000000000", deliveryLocation: "Oyingbo", provider: "paystack" };
            }
            [Symbol.iterator]() { return Object.entries(this.values)[Symbol.iterator](); }
        },
        localStorage: { getItem() { return "test-cart"; } },
        window: { location: { search, href: undefined } },
        document: { getElementById(id) { return elements.get(id) || null; } },
        fetch: async (url, options = {}) => {
            calls.push({ url, options });
            if (options.method === "POST") return response(checkoutResult);
            return response([{ id: "maltina", name: "Maltina", price: 600, quantity: 2 }]);
        },
        console
    };

    vm.createContext(context);
    vm.runInContext(`${source}\nthis.testApi = { elements: this.__elements, listeners: this.__listeners, calls: this.__calls, window: this.window, controls: this.__controls };`, Object.assign(context, { __elements: elements, __listeners: listeners, __calls: calls, __controls: controls }));
    return context.testApi;
}

async function ready(api) {
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    return api;
}

async function submit(api) {
    await api.listeners.get("checkout-form:submit")({ preventDefault() {} });
}

describe("checkout payment state handling", () => {
    it("confirms a paid order instead of redirecting when checkoutUrl exists", async () => {
        const api = await ready(createHarness({ order: { id: "paid-url", paymentStatus: "paid", deliveryFee: 500 }, checkoutUrl: "https://provider.example/pay" }));
        await submit(api);
        assert.match(api.elements.get("checkout-message").textContent, /Payment confirmed/);
        assert.equal(api.window.location.href, undefined);
    });

    it("confirms a paid order without treating a missing checkoutUrl as mock mode", async () => {
        const api = await ready(createHarness({ order: { id: "paid-no-url", paymentStatus: "paid", deliveryFee: 500 } }));
        await submit(api);
        assert.match(api.elements.get("checkout-message").textContent, /Payment confirmed/);
        assert.doesNotMatch(api.elements.get("checkout-message").textContent, /mock/i);
    });

    it("shows mock mode only when the response explicitly says mock", async () => {
        const api = await ready(createHarness({ order: { id: "mock-order", paymentStatus: "pending", deliveryFee: 500 }, mock: true }));
        await submit(api);
        assert.match(api.elements.get("checkout-message").textContent, /mock mode/i);
    });

    it("redirects an unpaid order with a valid checkoutUrl", async () => {
        const api = await ready(createHarness({ order: { id: "unpaid", paymentStatus: "pending", deliveryFee: 500 }, checkoutUrl: "https://provider.example/pay" }));
        await submit(api);
        assert.equal(api.window.location.href, "https://provider.example/pay");
    });

    it("disables and blocks checkout submission while verifying an existing order", async () => {
        const api = await ready(createHarness({ paymentStatus: "pending" }, "?order=existing&token=token"));
        assert.equal(api.controls.every(control => control.disabled), true);
        const postCount = api.calls.filter(call => call.options.method === "POST").length;
        await submit(api);
        assert.equal(api.calls.filter(call => call.options.method === "POST").length, postCount);
    });
});
