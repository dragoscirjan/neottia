import { TwingBaseIncludeNode, TwingBaseIncludeNodeAttributes, TwingBaseIncludeNodeChildren } from "../include";
import { TwingBaseExpressionNode } from "../expression";
export type TwingIncludeNodeChildren = TwingBaseIncludeNodeChildren & {
    expression: TwingBaseExpressionNode;
};
export interface TwingIncludeNode extends TwingBaseIncludeNode<"include", TwingBaseIncludeNodeAttributes, TwingIncludeNodeChildren> {
}
export declare const createIncludeNode: (attributes: TwingBaseIncludeNodeAttributes, children: TwingIncludeNodeChildren, line: number, column: number, tag: string) => TwingIncludeNode;
