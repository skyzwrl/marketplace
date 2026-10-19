import { Players } from "@rbxts/services";
import { GamePassOwnership } from "@skyzwrl/marketplace";

const VIP = 948201557;
const DOUBLE_COINS = 948201912;

const passes = new GamePassOwnership();

passes.whenOwned(VIP, (player) => player.SetAttribute("Vip", true));
passes.whenOwned(DOUBLE_COINS, (player) => player.SetAttribute("CoinMultiplier", 2));
passes.start();

Players.PlayerAdded.Connect((player) => passes.track(player));
Players.PlayerRemoving.Connect((player) => passes.untrack(player));

for (const player of Players.GetPlayers()) {
	task.spawn(() => passes.track(player));
}
