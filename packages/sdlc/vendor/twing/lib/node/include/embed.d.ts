import { TwingBaseIncludeNode, TwingBaseIncludeNodeAttributes, TwingBaseIncludeNodeChildren } from "../include";
export type TwingEmbedNodeAttributes = TwingBaseIncludeNodeAttributes & {
    index: number;
};
export interface TwingEmbedNode extends TwingBaseIncludeNode<"embed", TwingEmbedNodeAttributes> {
}
export declare const createEmbedNode: (attributes: TwingEmbedNodeAttributes, children: Omit<TwingBaseIncludeNodeChildren, "expression">, line: number, column: number, tag: string) => TwingEmbedNode;
