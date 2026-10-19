import { MarketplaceService } from "@rbxts/services";

export interface PassConnection {
	Disconnect(): void;
}

export interface GamePassSource {
	owns: (player: Player, gamePassId: number) => boolean;
	onPurchaseFinished: (callback: (player: Player, gamePassId: number, purchased: boolean) => void) => PassConnection;
}

export const robloxGamePasses: GamePassSource = {
	owns: (player, gamePassId) => MarketplaceService.UserOwnsGamePassAsync(player.User, gamePassId),
	onPurchaseFinished: (callback) => MarketplaceService.PromptGamePassPurchaseFinished.Connect(callback),
};

export interface GamePassOptions {
	source?: GamePassSource;
	attempts?: number;
	retryDelay?: number;
	sleep?: (seconds: number) => void;
	onError?: (message: string) => void;
}

export class GamePassOwnership {
	private readonly tracked = new Set<Player>();
	private readonly ownership = new Map<Player, Map<number, boolean>>();
	private readonly granted = new Map<Player, Set<number>>();
	private readonly grants = new Map<number, (player: Player) => void>();
	private readonly source: GamePassSource;
	private readonly attempts: number;
	private readonly retryDelay: number;
	private readonly sleep: (seconds: number) => void;
	private readonly onError: (message: string) => void;
	private connection?: PassConnection;

	public constructor(options: GamePassOptions = {}) {
		this.source = options.source ?? robloxGamePasses;
		this.attempts = options.attempts ?? 3;
		this.retryDelay = options.retryDelay ?? 1;
		this.sleep = options.sleep ?? ((seconds) => task.wait(seconds));
		this.onError = options.onError ?? ((message) => task.spawn(error, message, 0));
	}

	// runs once per player per server, on join if they already own it or right after they buy it
	public whenOwned(gamePassId: number, grant: (player: Player) => void): void {
		if (this.grants.has(gamePassId)) {
			error(`Game pass ${gamePassId} already has a grant`, 2);
		}
		this.grants.set(gamePassId, grant);

		for (const player of this.tracked) {
			if (this.ownership.get(player)?.get(gamePassId) === true) {
				this.grant(player, gamePassId);
			}
		}
	}

	public start(): void {
		this.connection ??= this.source.onPurchaseFinished((player, gamePassId, purchased) => {
			if (!purchased || !this.tracked.has(player)) {
				return;
			}
			// lookups are cached by the engine and can still say false right after a purchase,
			// so the prompt result is what gets trusted here
			this.remember(player, gamePassId, true);
			this.grant(player, gamePassId);
		});
	}

	public stop(): void {
		this.connection?.Disconnect();
		this.connection = undefined;
	}

	public track(player: Player): void {
		this.tracked.add(player);
		for (const [gamePassId] of this.grants) {
			if (this.owns(player, gamePassId)) {
				this.grant(player, gamePassId);
			}
		}
	}

	public untrack(player: Player): void {
		this.tracked.delete(player);
		this.ownership.delete(player);
		this.granted.delete(player);
	}

	public owns(player: Player, gamePassId: number): boolean {
		const known = this.ownership.get(player)?.get(gamePassId);
		if (known !== undefined) {
			return known;
		}

		for (let attempt = 1; attempt <= this.attempts; attempt++) {
			const [ok, result] = pcall(this.source.owns, player, gamePassId);
			if (ok) {
				return this.remember(player, gamePassId, result);
			}
			if (attempt < this.attempts) {
				this.sleep(this.retryDelay * attempt);
			} else {
				this.onError(`Ownership lookup for game pass ${gamePassId} failed: ${result}`);
			}
		}

		// not cached, so the next call looks it up again
		return false;
	}

	private remember(player: Player, gamePassId: number, owned: boolean): boolean {
		if (!this.tracked.has(player)) {
			return owned;
		}

		let passes = this.ownership.get(player);
		if (passes === undefined) {
			passes = new Map();
			this.ownership.set(player, passes);
		}
		// a lookup that started before an in-game purchase can come back false after it, and
		// ownership doesn't go away mid session
		const result = owned || passes.get(gamePassId) === true;
		passes.set(gamePassId, result);
		return result;
	}

	private grant(player: Player, gamePassId: number): void {
		const grant = this.grants.get(gamePassId);
		if (grant === undefined || !this.tracked.has(player)) {
			return;
		}

		let granted = this.granted.get(player);
		if (granted === undefined) {
			granted = new Set();
			this.granted.set(player, granted);
		}
		if (granted.has(gamePassId)) {
			return;
		}

		granted.add(gamePassId);
		const [ok, err] = pcall(grant, player);
		if (!ok) {
			granted.delete(gamePassId);
			this.onError(`Grant for game pass ${gamePassId} failed: ${err}`);
		}
	}
}
