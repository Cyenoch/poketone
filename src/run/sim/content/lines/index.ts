import { abilities, type FormAbilities } from "../abilities";
import type { ModifierDef } from "../effects";
import type { ItemId } from "../items";
import type { ElementType } from "../elements";
import type { MoveId } from "../moves";
import type { UltimateId } from "../ultimates";
import { bulbasaur } from "./bulbasaur";
import { charmander } from "./charmander";
import { pikachu } from "./pikachu";
import { squirtle } from "./squirtle";
import { gastly } from "./gastly";
import { dratini } from "./dratini";
import { machop } from "./machop";
import { abra } from "./abra";
import { geodude } from "./geodude";

/** Evolution stage: an index into `LineDef.stages`; 0 is the starting form. */
export type Stage = number;

/**
 * One form of a line. HP, speed and body radius come from the reference base stats (`pokemon.json`)
 * relative to the starting form, damped: HP × √(base HP ratio), speed × (base Spe ratio)^¼, contact
 * radius 0.36 × (height ratio)^¼ (derivation and calibration in docs/BALANCE.md).
 */
export interface FormDef<Id extends string = FormId> {
  abilities: FormAbilities;
  id: Id;
  name: string;
  types: readonly ElementType[];
  hp: number;
  speed: number;
  /** Contact radius: enemies touch you within their radius + this; hazards within this − 0.05. */
  radius: number;
  /** Body height: what enemy shots and beams must pass through to hit, and what the view sizes the model to. */
  height: number;
  ref: number;
}

/** A stage reached at level `at` that brings a new form. */
export interface EvolveStage<F extends string = FormId> {
  kind: "evolve";
  at: number;
  needs?: "thunder-stone" | "trade";
  form: FormDef<F>;
}
/** Maturity (成熟): the form stays, the passive and ultimate tier grow like an evolution. */
export interface MatureStage {
  kind: "mature";
  at: number;
}
export type LineStage<F extends string = FormId> = EvolveStage<F> | MatureStage;

export interface MegaDef<F extends string = MegaId> {
  stone: ItemId;
  form: FormDef<F>;
  /** The first move is offered once after mega evolution; all moves join the normal pool. */
  moves: readonly [MoveId, ...MoveId[]];
  modifiers: readonly ModifierDef<number>[];
}

/** An evolution line; its first stage's form is the one picked on the starter screen. */
export interface LineDef<
  Id extends string = StarterId,
  F extends string = FormId,
  M extends string = F,
> {
  id: Id;
  role: string;
  ultimate: UltimateId;
  /** Signature moves, offered from `SIGNATURE_GATES` (params/cards.ts); kit[0] is known from the start. */
  kit: readonly [MoveId, ...MoveId[]];
  /** One per later stage: [i] is offered from stage i + 1. */
  evolutionMoves: readonly MoveId[];
  megas?: readonly MegaDef<M>[];
  /** 1–3 stages in level order; stage 0 is at level 1 (openspec/specs/combat-builds/spec.md 进化线). */
  stages: readonly [EvolveStage<F> & { at: 1 }, ...LineStage<F>[]];
}

const linesTable = {
  charmander,
  bulbasaur,
  squirtle,
  pikachu,
  gastly,
  dratini,
  machop,
  abra,
  geodude,
};

export type StarterId = keyof typeof linesTable;
export type MegaId = Extract<
  (typeof linesTable)[StarterId],
  { megas: readonly unknown[] }
>["megas"][number]["form"]["id"];
export type FormId =
  | MegaId
  | Extract<(typeof linesTable)[StarterId]["stages"][number], { kind: "evolve" }>["form"]["id"];

export const starters: Record<StarterId, LineDef<StarterId, FormId, MegaId>> = linesTable;

const megaForms = Object.values(starters).flatMap((line) => line.megas ?? []);
export const megaDefs = Object.fromEntries(megaForms.map((mega) => [mega.form.id, mega])) as Record<
  MegaId,
  MegaDef
>;
export const megaStones: ReadonlySet<ItemId> = new Set(megaForms.map((mega) => mega.stone));

/** Each stage's form: a mature stage keeps the form before it. */
const formsByStage = {} as Record<StarterId, readonly FormDef[]>;
for (const line of Object.values(starters)) {
  if (line.evolutionMoves.length !== line.stages.length - 1)
    throw new Error(
      `${line.id}: ${line.stages.length} 个阶段需要 ${line.stages.length - 1} 个进化招式。`,
    );
  const forms: FormDef[] = [];
  line.stages.forEach((stage, i) => {
    if (i > 0 && stage.at <= line.stages[i - 1]!.at)
      throw new Error(`${line.id}: 第 ${i} 阶段的等级 ${stage.at} 不高于上一阶段。`);
    const form: FormDef = stage.kind === "evolve" ? stage.form : forms[i - 1]!;
    forms.push(form);
  });
  function checkAbilities(form: FormDef, i: number): void {
    const { normal, hidden } = form.abilities;
    for (const id of hidden ? [...normal, hidden] : normal) {
      const { modifiers, triggers } = abilities[id].effect;
      const values = [
        ...modifiers.map((m) => m.value),
        ...triggers.flatMap((t) => Object.values(t).filter(Array.isArray)),
      ];
      if (values.some((table) => table.length <= i))
        throw new Error(`${line.id}/${form.id}: 特性 ${id} 缺少第 ${i + 1} 阶段数值。`);
    }
  }
  forms.forEach(checkAbilities);
  for (const mega of line.megas ?? []) checkAbilities(mega.form, forms.length - 1);
  formsByStage[line.id] = forms;
}

export function stageForm(line: StarterId, stage: Stage): FormDef {
  return formsByStage[line][stage]!;
}

/** The line's distinct forms in stage order. */
export function lineForms(line: StarterId): readonly FormDef[] {
  const def = starters[line];
  return [
    ...def.stages.flatMap((stage) => (stage.kind === "evolve" ? [stage.form] : [])),
    ...(def.megas ?? []).map((mega) => mega.form),
  ];
}

/** Every playable form by id. */
export const formDefs = Object.fromEntries(
  Object.values(starters).flatMap((line) => lineForms(line.id).map((form) => [form.id, form])),
) as Record<FormId, FormDef>;

export const starterOrder: readonly StarterId[] = [
  "charmander",
  "bulbasaur",
  "squirtle",
  "pikachu",
  "gastly",
  "dratini",
  "machop",
  "abra",
  "geodude",
];
