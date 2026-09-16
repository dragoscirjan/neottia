import { TwingBaseNode } from "../node";
export interface TwingFlushNode extends TwingBaseNode<"flush"> {
}
export declare const createFlushNode: (line: number, column: number, tag?: string) => TwingFlushNode;
