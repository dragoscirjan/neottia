import { TwingBaseBinaryNode } from "../binary";
export interface TwingRangeNode extends TwingBaseBinaryNode<"range"> {
}
export declare const createRangeNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingRangeNode;
