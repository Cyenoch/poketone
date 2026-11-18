import { isWeatherMove } from "../content/moves";
import { castWeather } from "../weather";
import type { ArchetypeDef } from "./kit";

export const weather: ArchetypeDef = {
  heavy: true,
  cast(ctx, player, def) {
    if (!isWeatherMove(def.id)) throw new Error(`没有为招式 ${def.id} 登记天气。`);
    if (ctx.report) ctx.report({ t: "weather-cast", move: def.id, at: ctx.world.time });
    else castWeather(ctx.world, player, def.id, ctx.world.time);
    return true;
  },
};
