import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
export type TwingForLoopNodeAttributes = TwingBaseNodeAttributes & {
    hasAnIf: boolean;
    hasAnElse: boolean;
};
export interface TwingForLoopNode extends TwingBaseNode<"for_loop", TwingForLoopNodeAttributes> {
}
export declare const createForLoopNode: (line: number, column: number, tag: string) => TwingForLoopNode;
