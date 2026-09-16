import { TwingBaseBinaryNode } from "../binary";
export interface TwingHasSomeNode extends TwingBaseBinaryNode<"has_some"> {
}
export declare const createHasSomeNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingHasSomeNode;
