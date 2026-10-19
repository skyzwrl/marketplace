/// <reference types="@rbxts/testez/globals" />

import { ReceiptProcessor } from "..";

interface PlayerData {
	gems: number;
	items: string[];
	purchaseIds: string[];
}

const GEMS = 1001;
const STARTER_PACK = 1002;
const BROKEN_PACK = 1003;

const GRANTED = Enum.ProductPurchaseDecision.PurchaseGranted;
const NOT_PROCESSED = Enum.ProductPurchaseDecision.NotProcessedYet;

export = () => {
	let player: Player;
	let data: PlayerData;
	let inServer: boolean;
	let loaded: boolean;
	let saves: number;
	let saveResults: boolean[];
	let slowSaves: boolean;
	let errors: string[];
	let processor: ReceiptProcessor<PlayerData>;

	function receipt(purchaseId: string, productId: number): ReceiptInfo {
		return {
			PlayerId: 1,
			PlaceIdWherePurchased: 0,
			PurchaseId: purchaseId,
			ProductId: productId,
			CurrencyType: Enum.CurrencyType.Robux,
			CurrencySpent: 25,
		};
	}

	function createProcessor(historySize?: number): ReceiptProcessor<PlayerData> {
		const created = new ReceiptProcessor<PlayerData>({
			getData: () => (loaded ? data : undefined),
			getHistory: (profile) => profile.purchaseIds,
			save: () => {
				saves += 1;
				if (slowSaves) {
					task.wait();
				}
				return saveResults.shift() ?? true;
			},
			historySize,
			getPlayer: (userId) => (inServer && userId === 1 ? player : undefined),
			onError: (message) => errors.push(message),
		});

		created.handle(GEMS, (profile) => {
			profile.gems += 100;
		});
		created.handle(STARTER_PACK, (profile) => {
			profile.gems += 50;
			profile.items.push("sword");
		});
		created.handle(BROKEN_PACK, (profile) => {
			profile.gems += 999;
			profile.items.push("half a pack");
			error("inventory full");
		});
		return created;
	}

	beforeEach(() => {
		player = {} as unknown as Player;
		data = { gems: 0, items: [], purchaseIds: [] };
		inServer = true;
		loaded = true;
		saves = 0;
		saveResults = [];
		slowSaves = false;
		errors = [];
		processor = createProcessor();
	});

	describe("granting", () => {
		it("grants a purchase, records its id and saves", () => {
			expect(processor.process(receipt("a", GEMS))).to.equal(GRANTED);
			expect(data.gems).to.equal(100);
			expect(data.purchaseIds.join(",")).to.equal("a");
			expect(saves).to.equal(1);
		});

		it("acknowledges a repeated receipt without granting it again", () => {
			processor.process(receipt("a", GEMS));
			expect(processor.process(receipt("a", GEMS))).to.equal(GRANTED);
			expect(data.gems).to.equal(100);
			expect(saves).to.equal(1);
		});

		it("treats purchase ids loaded with the data as already saved", () => {
			data.purchaseIds.push("from an earlier session");

			expect(processor.process(receipt("from an earlier session", GEMS))).to.equal(GRANTED);
			expect(data.gems).to.equal(0);
			expect(saves).to.equal(0);
		});

		it("keeps the history bounded, dropping the oldest ids", () => {
			processor = createProcessor(3);
			for (const id of ["a", "b", "c", "d", "e"]) {
				processor.process(receipt(id, GEMS));
			}

			expect(data.purchaseIds.join(",")).to.equal("c,d,e");
			expect(data.gems).to.equal(500);
		});

		it("refuses a second handler for the same product", () => {
			expect(() => processor.handle(GEMS, () => {})).to.throw("already has a handler");
		});
	});

	describe("waiting", () => {
		it("waits while the player isn't in this server", () => {
			inServer = false;
			expect(processor.process(receipt("a", GEMS))).to.equal(NOT_PROCESSED);
			expect(data.gems).to.equal(0);

			inServer = true;
			expect(processor.process(receipt("a", GEMS))).to.equal(GRANTED);
			expect(data.gems).to.equal(100);
		});

		it("waits while the data is still loading", () => {
			loaded = false;
			expect(processor.process(receipt("a", GEMS))).to.equal(NOT_PROCESSED);
			expect(saves).to.equal(0);
		});

		it("waits on products nobody registered and reports them", () => {
			expect(processor.process(receipt("a", 4040))).to.equal(NOT_PROCESSED);
			expect(errors.size()).to.equal(1);
		});
	});

	describe("failures", () => {
		it("rolls back a handler that errors part way through", () => {
			expect(processor.process(receipt("a", BROKEN_PACK))).to.equal(NOT_PROCESSED);

			expect(data.gems).to.equal(0);
			expect(data.items.size()).to.equal(0);
			expect(data.purchaseIds.size()).to.equal(0);
			expect(saves).to.equal(0);
			expect(errors.size()).to.equal(1);
			expect(string.find(errors[0], "inventory full", 1, true)[0] !== undefined).to.equal(true);
		});

		it("doesn't grant twice when the save after a grant fails", () => {
			saveResults = [false];
			expect(processor.process(receipt("a", STARTER_PACK))).to.equal(NOT_PROCESSED);

			expect(processor.process(receipt("a", STARTER_PACK))).to.equal(GRANTED);
			expect(data.gems).to.equal(50);
			expect(data.items.size()).to.equal(1);
			expect(saves).to.equal(2);
		});

		it("treats a save that throws as a failed write", () => {
			processor = new ReceiptProcessor<PlayerData>({
				getData: () => data,
				getHistory: (profile) => profile.purchaseIds,
				save: () => error("DataStore request was rejected"),
				getPlayer: () => player,
				onError: (message) => errors.push(message),
			});
			processor.handle(GEMS, (profile) => {
				profile.gems += 100;
			});

			expect(processor.process(receipt("a", GEMS))).to.equal(NOT_PROCESSED);
			expect(data.gems).to.equal(100);
			expect(errors.size()).to.equal(1);
		});
	});

	describe("concurrency", () => {
		it("turns away a receipt that is already being processed", () => {
			slowSaves = true;
			let first: Enum.ProductPurchaseDecision | undefined;
			task.spawn(() => {
				first = processor.process(receipt("a", GEMS));
			});

			expect(processor.process(receipt("a", GEMS))).to.equal(NOT_PROCESSED);

			task.wait();
			task.wait();
			expect(first).to.equal(GRANTED);
			expect(data.gems).to.equal(100);
		});

		it("only marks grants made before a save started as saved", () => {
			slowSaves = true;
			saveResults = [true, false];
			let first: Enum.ProductPurchaseDecision | undefined;
			let second: Enum.ProductPurchaseDecision | undefined;

			task.spawn(() => {
				first = processor.process(receipt("a", GEMS));
			});
			task.spawn(() => {
				second = processor.process(receipt("b", GEMS));
			});
			task.wait();
			task.wait();

			expect(first).to.equal(GRANTED);
			expect(second).to.equal(NOT_PROCESSED);

			// "b" was granted while the first save was already in flight, so it still needs a save
			expect(processor.process(receipt("b", GEMS))).to.equal(GRANTED);
			expect(saves).to.equal(3);
			expect(data.gems).to.equal(200);
		});
	});
};
