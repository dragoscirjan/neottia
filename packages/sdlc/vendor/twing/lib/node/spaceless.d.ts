import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
export interface TwingSpacelessNode extends TwingBaseNode<"spaceless", TwingBaseNodeAttributes, {
    body: TwingBaseNode;
}> {
}
export declare const createSpacelessNode: (body: TwingBaseNode, line: number, column: number, tag: string) => TwingSpacelessNode;
