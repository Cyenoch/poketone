import type { SiteKind } from "../state/field";
import type { StageId } from "./stages/index";
import { SITE } from "./params/sites";

export const SITE_POOLS: Record<StageId, readonly SiteKind[]> = {
  forest: ["honey-tree", "item-ball", "snorlax", "raid-den", "spring", "egg", "glint"],
  desert: ["item-ball", "fossil", "raid-den", "spring", "egg", "glint"],
  coast: ["honey-tree", "item-ball", "fishing", "raid-den", "spring", "egg", "glint"],
  glacier: ["item-ball", "snorlax", "raid-den", "spring", "egg", "glint"],
  volcano: ["item-ball", "raid-den", "spring", "egg", "glint"],
  tower: ["ghost", "silph-scope", "spring", "glint"],
};

export interface SiteDef {
  id: SiteKind;
  name: string;
  interact: "instant" | "pickup" | { channel: number };
  stages: readonly StageId[];
  rule: SiteKind;
}

function site(id: SiteKind, name: string, interact: SiteDef["interact"]): SiteDef {
  return {
    id,
    name,
    interact,
    rule: id,
    stages: (Object.keys(SITE_POOLS) as StageId[]).filter((stage) =>
      SITE_POOLS[stage].includes(id),
    ),
  };
}

export const sites: Record<SiteKind, SiteDef> = {
  "honey-tree": site("honey-tree", "甜甜蜜树", "instant"),
  "item-ball": site("item-ball", "道具球", "pickup"),
  snorlax: site("snorlax", "睡着的卡比兽", "instant"),
  fishing: site("fishing", "钓鱼点", { channel: SITE.fishing.channel }),
  fossil: site("fossil", "化石挖掘点", { channel: SITE.fossilChannel }),
  "raid-den": site("raid-den", "团体战巢穴", "instant"),
  spring: site("spring", "治愈之泉", "instant"),
  egg: site("egg", "宝可梦蛋", "instant"),
  glint: site("glint", "闪光点", "pickup"),
  ghost: site("ghost", "未识破的幽灵", "instant"),
  "silph-scope": site("silph-scope", "西尔佛检视镜", "pickup"),
  "gengar-deal": {
    ...site("gengar-deal", "耿鬼的交易", "instant"),
    stages: ["glacier", "volcano", "tower"],
  },
};
