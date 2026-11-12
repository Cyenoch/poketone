# Game UI finish review

2026-10-31 · code-led refinement of the existing coastal game UI.

## Scope

Main menu, component workshop, model-preview commands, shared buttons/options/dialogs/messages and responsive composition. User explicitly requested game-scene design rather than Web/dashboard, then confirmed the current game direction and requested further refinement plus a design specification.

## Disposition

Independent reviewer: **ship** against the supplied direction contract and current game world. No material fixes identified in the full review. There was no pixel-approved comp or selected catalog QUALITY BAR card; the review does not claim pixel fidelity to prior generated proposals.

## Evidence

Reviewed captures: desktop and portrait menu; workshop desktop, portrait, compact and short landscape; completed charge; confirmation dialog; model preview at 1440×900, 390×844, 320×568 and 844×390 CSS pixels. Screenshots in `.impeccable/review/` are local verification artifacts, not runtime assets.

Actual browser interaction covered command arrows/Enter/Escape, modal focus cycling/restoration, charging/reset/options/native range arrows, model clip/static selection, local GLB import, invalid-file recovery retaining current model, tools collapse/expand and camera reset. System and local reduced-motion settings exercised. Production preview additionally exercised coarse-pointer/touch hints and action selection with zero browser errors recorded.

Changed-source detector returned `[]`. Production build and TypeScript passed; scoped UI lint and edited-file formatting passed. Whole-repository checks were blocked during this work by the separately edited model-preparation script; the UI task did not change that script. Existing entry chunk warning remains.

## Keep

Coastal scenery around compact navy/ice/gold game windows; clear selected cursor and keyboard feedback; readable local Chinese type; honest neutral-grid model inspection; no invented gameplay or dashboard card layouts.

## Final correction

A production screenshot exposed a wrapped short “归零” label at phone width. Reduced its reserved icon/padding footprint and kept it on one line; measured one line at 390px and 320px with no document overflow. This correction receives a focused verdict pass, separate from the full review above.

Focused correction verdict: **ship**. Reviewer confirmed “归零” is centered on one line without clipping/overflow; completed charge and adjacent controls remain intact. This verdict scores that correction only and does not expand the full review's scope.

## Homepage restoration and landscape-only correction

This correction supersedes the homepage and mobile layout portions above. The user asked to retain the earlier pale diagonal field, mountain mark, large wordmark and lightweight vertical menu, then limited phone support to landscape. The navy/gold homepage frame and compass were removed; functional windows retain their existing treatment. Earlier independent ship verdicts predate this feedback and do not approve the rejected homepage.

Current browser checks covered the restored homepage at 1440×900, 844×390 and 568×320 without document overflow. Phone portrait at 390×844 shows only the native modal rotation notice; Escape cannot dismiss it. Returning to landscape preserves the active model animation, completed charge and existing settings/confirmation modal. Menu ArrowUp/Down, Home/End, Enter, Escape and focus restoration were exercised, including reduced motion. CDP touch emulation reported five touch points and coarse pointer; an actual touchscreen tap collapsed preview commands and touch hints were visible. These are browser checks, not physical-device certification.

At 568×320, workshop charge actions use one column and both labels measure one line; the category list remains vertical and can scroll in short landscapes. DESIGN.md, PRODUCT.md, README.md, the registered surface and design sidecar describe the restored homepage and landscape-only phone scope. All ten standalone samples rendered without overflow, and their token references resolved. A full pnpm check passed formatting, lint, TypeScript and production build before concurrent trainer integration; the existing large entry-chunk warning remains. A later whole-repository check stopped at formatting in seven trainer asset/source files; those unrelated files were left intact. Source detection found zero anti-patterns and 41 advisory notes about existing literal values/type steps; it does not prove rendered contrast. The reused dev log includes aborted model requests and a transient unresolved TrainerScreen import during concurrent integration; this correction does not claim an error-free browser session. Production preview confirmed the settled model canvas and complete tool collapse at 568×320.

After the concurrent trainer entry appeared, the integrated four-command homepage was rechecked at 1440×900, 844×390 and 568×320: every command remains visible with no horizontal overflow. The 568×320 menu spans y=20..270; its subtitle is hidden only in this short-landscape density. The integrated portrait notice still blocks Escape and returns to all four commands. A subsequent pnpm build passed TypeScript and Vite against the integrated source (51 modules, 923.75 kB entry chunk); the earlier formatting failure remains a separate whole-repository check result.

Independent follow-up PriorUIReview: **ship within assigned homepage/orientation scope**, one P2 clipping fix resolved. The reviewer found the four-row menu clipped at640×360 and844×360; the homepage compact query now starts at410px height. Five reviewed captures (menu-reviewed-640x360,844x360,844x390,568x320,1440x900) retain the approved pale diagonal composition. At both360px heights menu/mountain top is40, menu bottom290 and footer top328. The reviewer independently inspected captures and confirmed no concrete findings remain in scope; prior live Safari selected-command and stacked-settings focus restoration passed. New components, physical-device safe areas and all focus-race timings were outside that verdict. Production smoke corroborated the same640×360 geometry.

## Reusable component expansion

Added TextField, Select, Stepper, SegmentedControl, Slider and ProgressBar under src/ui. Workshop has an interactive input category; charge color, range and progress now reuse shared controls. Existing homepage and landscape-only phone policy are preserved. Four categories scroll within the available directory height; inputs retain native keyboard semantics.

Observed browser behavior: whitespace name errors associate text and focus; fractional quantity aligns on commit; empty draft Escape restores the current value; min/max disable decrement/increment; native radio arrows skip disabled entries; native range arrows change values and charging disables the range; completion reaches100 and reset returns0. Lock disables controls, touch tap toggles it, form state survives orientation changes, and confirmed workshop reset restores all input defaults. Desktop1440×900 and landscape844×390/568×320 have no document or form horizontal overflow. Input text contrast measured12.11:1; mounted controls have unique IDs and two independent radio names. Production preview exercised quantity clamping, matching icon counts, messaging and complete charging without recorded browser errors in that production session.

ComponentBehaviorReview independently reviewed all six controls and consumers: disposition **ship** after one P2 fix. Stepper now clamps nonaligned upper bounds to the last valid step. Actual React browser probes verified min1/max4/step2 produces3, and min0.1/max0.45/step0.1 produces0.4, with no native step mismatch. The reviewer reported no remaining actionable findings at that scope.

ComponentVisualReview independently reviewed desktop, landscape, compact, error, disabled and bottom-scroll captures: disposition **ship**, one P2 fix scored1/1 resolved. Enabled text/select/number input boundaries now use blue, improving boundary contrast from1.88:1 to5.43:1. Error and disabled states remain distinct. The same six captures were refreshed; source and screenshot review did not include physical-device or screen-reader testing.

Affected-file formatting, full lint, TypeScript and production build passed after the numeric correction. Whole-repository pnpm check stopped earlier on seven unrelated trainer-art task/review files' formatting; those files were not modified. The existing entry-chunk size warning remains. Source detector on changed components/Workshop found no failures and14 advisory notes in existing Workshop literals. Fourteen independent sidecar samples rendered at844/568 widths without overflow and referenced valid primitives. Captures are in .impeccable/review/components-*.png; touch emulation and browser checks do not certify physical devices.

## Ten additional game components

The user explicitly asked for ten more components, separate from the six inputs above. Added independently exported ResourceMeter, CurrencyCounter, StatusEffects, PartyList, ItemSlot, Hotbar, CooldownButton, HintPopover, QuestTracker and DialogueBox. Workshop adds three sample groups: party/resources, inventory/hotbar, and quests/dialogue. Samples retain state between categories and confirmed reset remounts all three groups; trainer storage is untouched.

Actual browser probes covered party arrow selection, zero/low/recovered health, energy and currency changes, effect removal/turn expiration/empty state, item assignment/quantity consumption/empty slots, hotbar selection, cooldown blocking and re-enabling, both dialogue branches and focus handoff, quest completion/reporting, native hint Escape, orientation state retention, touch tap and confirmed reset. A disposable React probe additionally exercised triple synchronous cooldown clicks (one callback), zero-duration activation, active cooldown unmount/remount, disabled party/hotbar arrow skipping, and empty party/status/quest states. Probe files were removed. Production preview exercised item use and dialogue branch with no recorded errors in that session.

Twelve clear captures in .impeccable/review/ten-*.png cover each group at1440×900,844×390,568×320 plus bottom scroll at568×320. Initial reset-toast-obscured captures were replaced before review. All nine initial layouts have zero document/panel horizontal overflow; narrow panels scroll internally. Native meters have associated names and actual values, mounted IDs are unique. There is no physical-device or screen-reader certification.

GameBehaviorReview independently reviewed all ten components and consumers: disposition **ship**, no material findings. The reviewer verified source contracts for cooldown lifecycle, native groups, shared quantities, explicit dialogue flow and reset; runtime probe evidence was provided by the parent.

GameVisualReview independently read all twelve clear baseline captures plus cooldown/completion states and the new styles/markup: disposition **ship**, no material visual/accessibility findings. The reviewer confirmed the ten are additional to the earlier six, native state cues and at least44px interactive targets, expected internal scrolling and reachable bottom sections, reduced-motion routes and explicit disabled palette fallbacks. That verdict excludes homepage/trainer, physical-device and screen-reader testing.

Affected-file formatting, full lint, TypeScript and production build passed (69 modules). Whole-repository format check still reports17 separately edited trainer-art task/review files; these unrelated files were not modified. Existing large-entry warning remains. One source detector run returned no failures and3 font-size advisories (12px slot indexes,18px headings). DESIGN.md now includes all ten contracts/primitives;24 independent sidecar samples rendered at844/568 widths without overflow and referenced valid tokens.
