import { TwingBaseBinaryNode } from "../binary";
export interface TwingMatchesNode extends TwingBaseBinaryNode<"matches"> {
}
export declare const createMatchesNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingMatchesNode;
