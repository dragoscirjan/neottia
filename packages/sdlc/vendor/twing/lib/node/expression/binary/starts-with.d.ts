import { TwingBaseBinaryNode } from "../binary";
export interface TwingStartsWithNode extends TwingBaseBinaryNode<"starts_with"> {
}
export declare const createStartsWithNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingStartsWithNode;
