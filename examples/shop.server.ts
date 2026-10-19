import { ReplicatedStorage } from "@rbxts/services";
import { Shop } from "@skyzwrl/marketplace";
import { PlayerData, profiles } from "./data";

const shop = new Shop<PlayerData>({
	items: [
		{
			id: "potion",
			price: 50,
			currency: "coins",
			maxQuantity: 25,
			grant: (data, quantity) => {
				data.potions += quantity;
			},
		},
		{
			id: "golden_sword",
			price: 15000,
			currency: "coins",
			limit: 1,
			grant: (data) => data.cosmetics.push("golden_sword"),
		},
		{
			id: "crown",
			price: 250,
			currency: "gems",
			stock: 10,
			grant: (data) => data.cosmetics.push("crown"),
		},
		{
			id: "pumpkin_hat",
			price: 400,
			currency: "coins",
			availableFrom: DateTime.fromUniversalTime(2026, 10, 24).UnixTimestamp,
			availableUntil: DateTime.fromUniversalTime(2026, 11, 2).UnixTimestamp,
			grant: (data) => data.cosmetics.push("pumpkin_hat"),
		},
	],
	getData: (player) => profiles.get(player)?.data,
	getBalance: (data, currency) => (currency === "gems" ? data.gems : data.coins),
	setBalance: (data, currency, amount) => {
		if (currency === "gems") {
			data.gems = amount;
		} else {
			data.coins = amount;
		}
	},
	getPurchaseCounts: (data) => data.shopPurchases,
});

// client -> server invoke is fine, the client just gets the result back
const purchase = new Instance("RemoteFunction");
purchase.Name = "PurchaseShopItem";
purchase.OnServerInvoke = (player, itemId, quantity) => shop.purchase(player, itemId, quantity);
purchase.Parent = ReplicatedStorage;
