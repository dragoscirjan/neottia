import { TwingBaseNode, TwingBaseNodeAttributes } from "../node";
import { TwingEscapingStrategy } from "../escaping-strategy";
export type TwingAutoEscapeNodeAttributes = TwingBaseNodeAttributes & {
    strategy: TwingEscapingStrategy | string | false;
};
export interface TwingAutoEscapeNode extends TwingBaseNode<"auto_escape", TwingAutoEscapeNodeAttributes, {
    body: TwingBaseNode;
}> {
}
export declare const createAutoEscapeNode: (strategy: TwingEscapingStrategy | string | false, body: TwingBaseNode, line: number, column: number, tag?: string) => TwingAutoEscapeNode;
