import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
export type TwingBlockReferenceNodeAttributes = TwingBaseNodeAttributes & {
    name: string;
};
export interface TwingBlockReferenceNode extends TwingBaseNode<"block_reference", TwingBlockReferenceNodeAttributes, {}> {
}
export declare const createBlockReferenceNode: (name: string, line: number, column: number, tag: string) => TwingBlockReferenceNode;
