import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
export type TwingIfNodeChildren = {
    tests: TwingBaseNode;
    else?: TwingBaseNode;
};
export interface TwingIfNode extends TwingBaseNode<'if', TwingBaseNodeAttributes, TwingIfNodeChildren> {
}
export declare const createIfNode: (testNode: TwingBaseNode, elseNode: TwingBaseNode | null, line: number, column: number, tag?: string | null) => TwingIfNode;
