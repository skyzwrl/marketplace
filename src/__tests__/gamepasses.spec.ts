/// <reference types="@rbxts/testez/globals" />

import { GamePassOwnership, GamePassSource } from "..";

const VIP = 50;
const DOUBLE_COINS = 51;

export = () => {
	let player: Player;
	let owned: Set<number>;
	let lookups: number;
	let failuresLeft: number;
	let slowLookups: boolean;
	let sleeps: number[];
	let errors: string[];
	let purchaseFinished: ((player: Player, gamePassId: number, purchased: boolean) => void) | undefined;
	let passes: GamePassOwnership;

	const source: GamePassSource = {
		owns: (_, gamePassId) => {
			lookups += 1;
			if (failuresLeft > 0) {
				failuresLeft -= 1;
				error("HTTP 503 (Service Unavailable)");
			}
			const result = owned.has(gamePassId);
			if (slowLookups) {
				task.wait();
			}
			return result;
		},
		onPurchaseFinished: (callback) => {
			purchaseFinished = callback;
			return {
				Disconnect() {
					purchaseFinished = undefined;
				},
			};
		},
	};

	beforeEach(() => {
		player = {} as unknown as Player;
		owned = new Set();
		lookups = 0;
		failuresLeft = 0;
		slowLookups = false;
		sleeps = [];
		errors = [];
		purchaseFinished = undefined;
		passes = new GamePassOwnership({
			source,
			sleep: (seconds) => sleeps.push(seconds),
			onError: (message) => errors.push(message),
		});
	});

	describe("ownership", () => {
		it("caches a tracked player's ownership after the first lookup", () => {
			owned.add(VIP);
			passes.track(player);

			expect(passes.owns(player, VIP)).to.equal(true);
			expect(passes.owns(player, VIP)).to.equal(true);
			expect(passes.owns(player, DOUBLE_COINS)).to.equal(false);
			expect(passes.owns(player, DOUBLE_COINS)).to.equal(false);
			expect(lookups).to.equal(2);
		});

		it("retries failed lookups with a growing delay", () => {
			owned.add(VIP);
			failuresLeft = 2;

			expect(passes.owns(player, VIP)).to.equal(true);
			expect(lookups).to.equal(3);
			expect(sleeps.join(",")).to.equal("1,2");
			expect(errors.size()).to.equal(0);
		});

		it("reports and doesn't cache when every attempt fails", () => {
			owned.add(VIP);
			passes.track(player);
			failuresLeft = 3;

			expect(passes.owns(player, VIP)).to.equal(false);
			expect(errors.size()).to.equal(1);

			expect(passes.owns(player, VIP)).to.equal(true);
			expect(lookups).to.equal(4);
		});

		it("keeps a purchase that lands while an older lookup is still running", () => {
			passes.whenOwned(VIP, () => {});
			passes.start();
			passes.track(player);
			slowLookups = true;

			let lookedUp: boolean | undefined;
			task.spawn(() => {
				lookedUp = passes.owns(player, DOUBLE_COINS);
			});
			purchaseFinished!(player, DOUBLE_COINS, true);
			task.wait();
			task.wait();

			expect(lookedUp).to.equal(true);
			expect(passes.owns(player, DOUBLE_COINS)).to.equal(true);
		});
	});

	describe("grants", () => {
		it("grants owned passes once when a player is tracked", () => {
			let grants = 0;
			passes.whenOwned(VIP, () => grants++);
			owned.add(VIP);

			passes.track(player);
			passes.track(player);

			expect(grants).to.equal(1);
		});

		it("skips passes the player doesn't own", () => {
			let grants = 0;
			passes.whenOwned(VIP, () => grants++);

			passes.track(player);

			expect(grants).to.equal(0);
		});

		it("grants right after an in-game purchase even if lookups still say no", () => {
			let grants = 0;
			passes.whenOwned(VIP, () => grants++);
			passes.start();
			passes.track(player);

			purchaseFinished!(player, VIP, true);
			purchaseFinished!(player, VIP, true);

			expect(grants).to.equal(1);
			expect(passes.owns(player, VIP)).to.equal(true);
			expect(lookups).to.equal(1);
		});

		it("ignores closed prompts and players who aren't tracked", () => {
			let grants = 0;
			passes.whenOwned(VIP, () => grants++);
			passes.start();

			purchaseFinished!(player, VIP, true);
			passes.track(player);
			purchaseFinished!(player, VIP, false);

			expect(grants).to.equal(0);
		});

		it("starts over for the next session after untrack", () => {
			let grants = 0;
			passes.whenOwned(VIP, () => grants++);
			owned.add(VIP);

			passes.track(player);
			passes.untrack(player);
			passes.track(player);

			expect(grants).to.equal(2);
			expect(lookups).to.equal(2);
		});

		it("tries a grant again after it errors", () => {
			let calls = 0;
			passes.whenOwned(VIP, () => {
				calls++;
				if (calls === 1) {
					error("tool template missing");
				}
			});
			owned.add(VIP);

			passes.track(player);
			passes.track(player);
			passes.track(player);

			expect(calls).to.equal(2);
			expect(errors.size()).to.equal(1);
		});

		it("applies a grant registered late to players already known to own the pass", () => {
			owned.add(DOUBLE_COINS);
			passes.track(player);
			passes.owns(player, DOUBLE_COINS);

			let grants = 0;
			passes.whenOwned(DOUBLE_COINS, () => grants++);

			expect(grants).to.equal(1);
		});

		it("refuses a second grant for the same pass", () => {
			passes.whenOwned(VIP, () => {});
			expect(() => passes.whenOwned(VIP, () => {})).to.throw("already has a grant");
		});

		it("stops listening for purchases after stop", () => {
			passes.start();
			expect(purchaseFinished).to.be.ok();
			passes.stop();
			expect(purchaseFinished).never.to.be.ok();
		});
	});
};
