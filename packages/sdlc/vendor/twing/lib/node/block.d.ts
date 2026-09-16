import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
export type TwingBlockNodeAttributes = TwingBaseNodeAttributes & {
    name: string;
};
export interface TwingBlockNode extends TwingBaseNode<"block", TwingBlockNodeAttributes, {
    body: TwingBaseNode;
}> {
}
export declare const createBlockNode: (name: string, body: TwingBaseNode, line: number, column: number, tag?: string | null) => TwingBlockNode;
