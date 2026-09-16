import type { TwingBaseBinaryNode } from "../binary";
export interface TwingBitwiseXorNode extends TwingBaseBinaryNode<"bitwise_xor"> {
}
export declare const createBitwiseXorNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingBitwiseXorNode;
