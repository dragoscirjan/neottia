import type { TwingBaseBinaryNode } from "../binary";
export interface TwingDivideAndFloorNode extends TwingBaseBinaryNode<"divide_and_floor"> {
}
export declare const createDivideAndFloorNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingDivideAndFloorNode;
