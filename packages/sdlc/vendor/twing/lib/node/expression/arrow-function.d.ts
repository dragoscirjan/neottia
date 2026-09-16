import type { TwingBaseExpressionNode, TwingBaseExpressionNodeAttributes } from "../expression";
import type { TwingBaseNode } from "../../node";
import type { TwingAssignmentNode } from "./assignment";
export interface TwingArrowFunctionNode extends TwingBaseExpressionNode<"arrow_function", TwingBaseExpressionNodeAttributes, {
    body: TwingBaseExpressionNode;
    names: TwingBaseNode<any, any, Record<string, TwingAssignmentNode>>;
}> {
}
export declare const createArrowFunctionNode: (body: TwingBaseExpressionNode, names: TwingBaseNode<any, any, Record<any, TwingAssignmentNode>>, line: number, column: number) => TwingArrowFunctionNode;
