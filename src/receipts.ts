import { MarketplaceService, Players } from "@rbxts/services";
import { copyDeep, restoreInto } from "./snapshot";

export type ProductHandler<TData> = (data: TData, receipt: ReceiptInfo, player: Player) => void;

export interface ReceiptOptions<TData extends object> {
	/** the player's loaded data, undefined while it's loading or after it's released */
	getData: (player: Player) => TData | undefined;
	/** purchase id list kept inside the data, so it's saved in the same write as the grant */
	getHistory: (data: TData) => string[];
	/** yields until the data is written, false if the write failed */
	save: (player: Player) => boolean;
	historySize?: number;
	getPlayer?: (userId: number) => Player | undefined;
	onError?: (message: string) => void;
}

const GRANTED = Enum.ProductPurchaseDecision.PurchaseGranted;
const NOT_PROCESSED = Enum.ProductPurchaseDecision.NotProcessedYet;

export class ReceiptProcessor<TData extends object> {
	private readonly handlers = new Map<number, ProductHandler<TData>>();
	private readonly processing = new Set<string>();
	// grants made by this server that haven't been confirmed written yet
	private readonly unsaved = new Map<Player, Set<string>>();
	private readonly getData: (player: Player) => TData | undefined;
	private readonly getHistory: (data: TData) => string[];
	private readonly save: (player: Player) => boolean;
	private readonly historySize: number;
	private readonly getPlayer: (userId: number) => Player | undefined;
	private readonly onError: (message: string) => void;
	private removingConnection?: RBXScriptConnection;

	public constructor(options: ReceiptOptions<TData>) {
		this.getData = options.getData;
		this.getHistory = options.getHistory;
		this.save = options.save;
		this.historySize = options.historySize ?? 100;
		this.getPlayer = options.getPlayer ?? ((userId) => Players.GetPlayerByUserId(userId));
		this.onError = options.onError ?? ((message) => task.spawn(error, message, 0));
	}

	public handle(productId: number, handler: ProductHandler<TData>): void {
		if (this.handlers.has(productId)) {
			error(`Developer product ${productId} already has a handler`, 2);
		}
		this.handlers.set(productId, handler);
	}

	public bind(): void {
		MarketplaceService.ProcessReceipt = (receipt) => this.process(receipt);
		this.removingConnection ??= Players.PlayerRemoving.Connect((player) => this.unsaved.delete(player));
	}

	public process(receipt: ReceiptInfo): Enum.ProductPurchaseDecision {
		const handler = this.handlers.get(receipt.ProductId);
		if (handler === undefined) {
			this.onError(`No handler for developer product ${receipt.ProductId}`);
			return NOT_PROCESSED;
		}

		// roblox calls again the next time they join a server
		const player = this.getPlayer(receipt.PlayerId);
		if (player === undefined) {
			return NOT_PROCESSED;
		}
		const data = this.getData(player);
		if (data === undefined) {
			return NOT_PROCESSED;
		}

		const purchaseId = receipt.PurchaseId;
		if (this.processing.has(purchaseId)) {
			return NOT_PROCESSED;
		}

		this.processing.add(purchaseId);
		try {
			return this.settle(player, data, handler, receipt);
		} finally {
			this.processing.delete(purchaseId);
		}
	}

	private settle(
		player: Player,
		data: TData,
		handler: ProductHandler<TData>,
		receipt: ReceiptInfo,
	): Enum.ProductPurchaseDecision {
		const purchaseId = receipt.PurchaseId;
		const history = this.getHistory(data);

		if (!history.includes(purchaseId)) {
			const snapshot = copyDeep(data);
			const [granted, err] = pcall(handler, data, receipt, player);
			if (!granted) {
				restoreInto(data, snapshot);
				this.onError(`Developer product ${receipt.ProductId} handler failed: ${err}`);
				return NOT_PROCESSED;
			}

			history.push(purchaseId);
			while (history.size() > this.historySize) {
				history.shift();
			}

			this.pendingFor(player).add(purchaseId);
		}

		// ids that came in with the loaded data are already on disk
		const pending = this.unsaved.get(player);
		if (pending === undefined || !pending.has(purchaseId)) {
			return GRANTED;
		}

		// only grants made before the write started are guaranteed to be in it
		const covered = [...pending];
		const [ok, saved] = pcall(this.save, player);
		if (!ok) {
			this.onError(`Saving after developer product ${receipt.ProductId} failed: ${saved}`);
		}
		if (!ok || !saved) {
			return NOT_PROCESSED;
		}
		for (const id of covered) {
			pending.delete(id);
		}
		return GRANTED;
	}

	private pendingFor(player: Player): Set<string> {
		let pending = this.unsaved.get(player);
		if (pending === undefined) {
			pending = new Set();
			this.unsaved.set(player, pending);
		}
		return pending;
	}
}
