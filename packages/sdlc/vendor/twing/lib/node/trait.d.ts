import type { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
import type { TwingConstantNode } from "./expression/constant";
export interface TwingTraitNode extends TwingBaseNode<"trait", TwingBaseNodeAttributes, {
    template: TwingConstantNode;
    targets: TwingBaseNode;
}> {
}
export declare const createTraitNode: (template: TwingTraitNode["children"]["template"], targets: TwingTraitNode["children"]["targets"], line: number, column: number) => TwingTraitNode;
