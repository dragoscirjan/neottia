import { TwingBaseExpressionNode, TwingBaseExpressionNodeAttributes, TwingExpressionNode } from "../expression";
export type TwingAttributeAccessorCallType = "any" | "array" | "method";
export type TwingAttributeAccessorNodeAttributes = TwingBaseExpressionNodeAttributes & {
    isOptimizable: boolean;
    type: TwingAttributeAccessorCallType;
    shouldIgnoreStrictCheck?: boolean;
    shouldTestExistence: boolean;
};
export type TwingAttributeAccessorNodeChildren = {
    target: TwingExpressionNode;
    attribute: TwingExpressionNode;
    arguments: TwingExpressionNode;
};
export interface TwingAttributeAccessorNode extends TwingBaseExpressionNode<"attribute_accessor", TwingAttributeAccessorNodeAttributes, TwingAttributeAccessorNodeChildren> {
}
export declare const createAttributeAccessorNode: (target: TwingExpressionNode, attribute: TwingExpressionNode, methodArguments: TwingExpressionNode, type: TwingAttributeAccessorCallType, line: number, column: number) => TwingAttributeAccessorNode;
export declare const cloneGetAttributeNode: (attributeAccessorNode: TwingAttributeAccessorNode) => TwingAttributeAccessorNode;
