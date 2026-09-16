import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
export interface TwingSandboxNode extends TwingBaseNode<"sandbox", TwingBaseNodeAttributes, {
    body: TwingBaseNode;
}> {
}
export declare const createSandboxNode: (body: TwingBaseNode, line: number, column: number, tag: string) => TwingSandboxNode;
