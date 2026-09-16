import { TwingBaseBinaryNode } from "../binary";
export interface TwingPowerNode extends TwingBaseBinaryNode<"power"> {
}
export declare const createPowerNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingPowerNode;
