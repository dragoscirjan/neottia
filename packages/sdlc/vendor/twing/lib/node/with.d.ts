import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
import { TwingBaseExpressionNode } from "./expression";
export type TwingWithNodeAttributes = TwingBaseNodeAttributes & {
    only: boolean;
};
export type TwingWithNodeChildren = {
    body: TwingBaseNode;
    variables?: TwingBaseExpressionNode;
};
export interface TwingWithNode extends TwingBaseNode<"with", TwingWithNodeAttributes, TwingWithNodeChildren> {
}
export declare const createWithNode: (body: TwingBaseNode, variables: TwingBaseExpressionNode | null, only: boolean, line: number, column: number, tag: string) => TwingWithNode;
