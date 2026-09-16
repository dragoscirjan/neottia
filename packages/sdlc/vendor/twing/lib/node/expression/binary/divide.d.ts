import { TwingBaseBinaryNode } from "../binary";
export interface TwingDivideNode extends TwingBaseBinaryNode<"divide"> {
}
export declare const createDivideNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingDivideNode;
