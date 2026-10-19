/// <reference types="@rbxts/testez/globals" />

import { copyDeep, restoreInto } from "../snapshot";

interface Profile {
	coins: number;
	title?: string;
	items: string[];
	stats: { kills: number; deaths: number; extra?: number };
}

export = () => {
	it("copies nested tables instead of sharing them", () => {
		const original: Profile = { coins: 5, items: ["a"], stats: { kills: 1, deaths: 2 } };
		const copy = copyDeep(original);

		copy.items.push("b");
		copy.stats.kills = 10;

		expect(copy).never.to.equal(original);
		expect(original.items.size()).to.equal(1);
		expect(original.stats.kills).to.equal(1);
	});

	it("restores values, removes added keys and brings back removed ones", () => {
		const profile: Profile = { coins: 5, items: ["a", "b"], stats: { kills: 1, deaths: 2, extra: 3 } };
		const snapshot = copyDeep(profile);

		profile.coins = 999;
		profile.title = "cheater";
		profile.items.push("c");
		profile.stats.extra = undefined;
		profile.stats.kills = 50;

		restoreInto(profile, snapshot);

		expect(profile.coins).to.equal(5);
		expect(profile.title).never.to.be.ok();
		expect(profile.items.join(",")).to.equal("a,b");
		expect(profile.stats.kills).to.equal(1);
		expect(profile.stats.extra).to.equal(3);
	});

	it("keeps the identity of nested tables while restoring them", () => {
		const profile: Profile = { coins: 5, items: ["a"], stats: { kills: 1, deaths: 2 } };
		const items = profile.items;
		const stats = profile.stats;
		const snapshot = copyDeep(profile);

		items.clear();
		stats.deaths = 40;
		restoreInto(profile, snapshot);

		expect(profile.items).to.equal(items);
		expect(profile.stats).to.equal(stats);
		expect(items.join(",")).to.equal("a");
		expect(stats.deaths).to.equal(2);
	});

	it("puts back a table the grant replaced", () => {
		const profile: Profile = { coins: 5, items: ["a"], stats: { kills: 1, deaths: 2 } };
		const snapshot = copyDeep(profile);

		profile.items = [];
		restoreInto(profile, snapshot);

		expect(profile.items.join(",")).to.equal("a");
	});
};
