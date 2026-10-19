/// <reference types="@rbxts/testez/globals" />

import { Shop, ShopItem, ShopResult } from "..";

interface PlayerData {
	coins: number;
	gems: number;
	potions: number;
	cosmetics: string[];
	bought: Record<string, number>;
}

export = () => {
	let player: Player;
	let data: PlayerData;
	let loaded: boolean;
	let now: number;
	let errors: string[];
	let shop: Shop<PlayerData>;

	const items: ShopItem<PlayerData>[] = [
		{ id: "sword_skin", price: 500, currency: "coins", limit: 1, grant: (d) => d.cosmetics.push("sword_skin") },
		{
			id: "potion",
			price: 50,
			currency: "coins",
			maxQuantity: 10,
			grant: (d, quantity) => {
				d.potions += quantity;
			},
		},
		{ id: "crown", price: 20, currency: "gems", stock: 2, grant: (d) => d.cosmetics.push("crown") },
		{
			id: "winter_cape",
			price: 10,
			currency: "coins",
			availableFrom: 2000,
			availableUntil: 3000,
			grant: (d) => d.cosmetics.push("winter_cape"),
		},
		{
			id: "cursed_chest",
			price: 100,
			currency: "coins",
			grant: (d) => {
				d.potions += 5;
				d.cosmetics.push("half a chest");
				error("chest template missing");
			},
		},
	];

	function createShop(list: ShopItem<PlayerData>[]): Shop<PlayerData> {
		return new Shop<PlayerData>({
			items: list,
			getData: () => (loaded ? data : undefined),
			getBalance: (d, currency) => (currency === "gems" ? d.gems : d.coins),
			setBalance: (d, currency, amount) => {
				if (currency === "gems") {
					d.gems = amount;
				} else {
					d.coins = amount;
				}
			},
			getPurchaseCounts: (d) => d.bought,
			clock: () => now,
			onError: (message) => errors.push(message),
		});
	}

	function expectFailure(result: ShopResult, reason: string) {
		expect(result.success).to.equal(false);
		if (!result.success) {
			expect(result.reason).to.equal(reason);
		}
	}

	beforeEach(() => {
		player = {} as unknown as Player;
		data = { coins: 1000, gems: 100, potions: 0, cosmetics: [], bought: {} };
		loaded = true;
		now = 1000;
		errors = [];
		shop = createShop(items);
	});

	describe("purchases", () => {
		it("charges the catalog price and grants in one step", () => {
			const result = shop.purchase(player, "potion", 3);

			expect(result.success).to.equal(true);
			if (result.success) {
				expect(result.cost).to.equal(150);
				expect(result.quantity).to.equal(3);
			}
			expect(data.coins).to.equal(850);
			expect(data.potions).to.equal(3);
			expect(data.bought.potion).to.equal(3);
		});

		it("defaults to buying one", () => {
			expect(shop.purchase(player, "sword_skin").success).to.equal(true);
			expect(data.coins).to.equal(500);
		});

		it("charges the right currency", () => {
			shop.purchase(player, "crown");
			expect(data.gems).to.equal(80);
			expect(data.coins).to.equal(1000);
		});
	});

	describe("validation", () => {
		it("rejects unknown and malformed item ids", () => {
			expectFailure(shop.purchase(player, "dragon"), "UnknownItem");
			expectFailure(shop.purchase(player, 5), "UnknownItem");
			expectFailure(shop.purchase(player, undefined), "UnknownItem");
		});

		it("rejects quantities that aren't whole, positive and within the item's max", () => {
			for (const quantity of [0, -1, 1.5, 0 / 0, math.huge, 11, "3", true]) {
				expectFailure(shop.purchase(player, "potion", quantity), "InvalidQuantity");
			}
			expect(data.coins).to.equal(1000);
			expect(data.potions).to.equal(0);
		});

		it("only sells inside the availability window", () => {
			now = 1999;
			expectFailure(shop.purchase(player, "winter_cape"), "Unavailable");
			now = 2000;
			expect(shop.purchase(player, "winter_cape").success).to.equal(true);
			now = 3000;
			expectFailure(shop.purchase(player, "winter_cape"), "Unavailable");
			expect(shop.isAvailable("winter_cape")).to.equal(false);
			expect(shop.isAvailable("dragon")).to.equal(false);
		});

		it("waits for the player's data to load", () => {
			loaded = false;
			expectFailure(shop.purchase(player, "potion"), "NotLoaded");
		});

		it("rejects purchases the player can't afford without touching their data", () => {
			data.coins = 40;
			expectFailure(shop.purchase(player, "potion"), "InsufficientFunds");
			expect(data.coins).to.equal(40);
			expect(data.potions).to.equal(0);
			expect(data.bought.potion).never.to.be.ok();
		});

		it("enforces per player limits across purchases", () => {
			expect(shop.purchase(player, "sword_skin").success).to.equal(true);
			expectFailure(shop.purchase(player, "sword_skin"), "LimitReached");
			expect(data.coins).to.equal(500);
			expect(data.cosmetics.size()).to.equal(1);
		});
	});

	describe("stock", () => {
		it("sells out and can be restocked", () => {
			expect(shop.purchase(player, "crown").success).to.equal(true);
			expect(shop.purchase(player, "crown").success).to.equal(true);
			expectFailure(shop.purchase(player, "crown"), "OutOfStock");
			expect(shop.getStock("crown")).to.equal(0);

			shop.restock("crown", 1);
			expect(shop.purchase(player, "crown").success).to.equal(true);
			expect(data.gems).to.equal(40);
		});

		it("only tracks stock for items that have it", () => {
			expect(shop.getStock("potion")).never.to.be.ok();
			expect(() => shop.restock("potion", 5)).to.throw("doesn't track stock");
		});
	});

	describe("failed grants", () => {
		it("rolls the whole purchase back when the grant errors", () => {
			expectFailure(shop.purchase(player, "cursed_chest"), "GrantFailed");

			expect(data.coins).to.equal(1000);
			expect(data.potions).to.equal(0);
			expect(data.cosmetics.size()).to.equal(0);
			expect(data.bought.cursed_chest).never.to.be.ok();
			expect(errors.size()).to.equal(1);
		});

		it("keeps the same data table after a rollback", () => {
			const cosmetics = data.cosmetics;
			shop.purchase(player, "cursed_chest");
			expect(data.cosmetics).to.equal(cosmetics);
		});
	});

	describe("catalog", () => {
		it("refuses broken catalogs up front", () => {
			const grant = () => {};
			expect(() =>
				createShop([
					{ id: "a", price: 1, currency: "coins", grant },
					{ id: "a", price: 2, currency: "coins", grant },
				]),
			).to.throw("listed twice");
			expect(() => createShop([{ id: "b", price: -5, currency: "coins", grant }])).to.throw("invalid price");
			expect(() => createShop([{ id: "c", price: 0 / 0, currency: "coins", grant }])).to.throw("invalid price");
			expect(() => createShop([{ id: "d", price: 5, currency: "coins", maxQuantity: 0, grant }])).to.throw(
				"invalid maxQuantity",
			);
		});
	});
};
