import { TwingBaseExpressionNode } from "./expression";
import { TwingBaseNode } from "../node";
export interface TwingPrintNode extends TwingBaseNode<"print", {}, {
    expression: TwingBaseExpressionNode;
}> {
}
export declare const createPrintNode: (expression: TwingBaseExpressionNode, line: number, column: number) => TwingPrintNode;
