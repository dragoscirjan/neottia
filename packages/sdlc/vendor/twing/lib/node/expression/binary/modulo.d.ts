import { TwingBaseBinaryNode } from "../binary";
export interface TwingModuloNode extends TwingBaseBinaryNode<"modulo"> {
}
export declare const createModuloNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingModuloNode;
