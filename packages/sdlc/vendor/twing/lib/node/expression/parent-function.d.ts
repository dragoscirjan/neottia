import { TwingBaseExpressionNode, TwingBaseExpressionNodeAttributes } from "../expression";
export type ParentNodeAttributes = TwingBaseExpressionNodeAttributes & {
    name: string;
};
export interface TwingParentFunctionNode extends TwingBaseExpressionNode<"parent_function", ParentNodeAttributes> {
}
export declare const createParentFunctionNode: (name: string, line: number, column: number) => TwingParentFunctionNode;
