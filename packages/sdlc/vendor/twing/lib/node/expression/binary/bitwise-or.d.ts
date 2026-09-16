import type { TwingBaseBinaryNode } from "../binary";
export interface TwingBitwiseOrNode extends TwingBaseBinaryNode<"bitwise_or"> {
}
export declare const createBitwiseOrNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingBitwiseOrNode;
