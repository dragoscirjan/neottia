import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
export type TwingLineNodeAttributes = TwingBaseNodeAttributes & {
    data: number;
};
export interface TwingLineNode extends TwingBaseNode<"line", TwingLineNodeAttributes> {
}
export declare const createLineNode: (data: number, line: number, column: number, tag: string) => TwingLineNode;
