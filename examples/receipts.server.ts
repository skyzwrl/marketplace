import { ReceiptProcessor } from "@skyzwrl/marketplace";
import { PlayerData, profiles } from "./data";

const GEM_PACK = 1784530211;
const STARTER_BUNDLE = 1784530412;

const receipts = new ReceiptProcessor<PlayerData>({
	getData: (player) => profiles.get(player)?.data,
	getHistory: (data) => data.purchaseIds,
	save: (player) => profiles.get(player)?.save() ?? false,
});

receipts.handle(GEM_PACK, (data) => {
	data.gems += 500;
});

receipts.handle(STARTER_BUNDLE, (data) => {
	data.coins += 2500;
	data.potions += 5;
	data.cosmetics.push("starter_cape");
});

receipts.bind();
