import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
export type TwingCommentNodeAttributes = TwingBaseNodeAttributes & {
    data: string;
};
export interface TwingCommentNode extends TwingBaseNode<"comment", TwingCommentNodeAttributes> {
}
export declare const createCommentNode: (data: string, line: number, column: number) => TwingCommentNode;
