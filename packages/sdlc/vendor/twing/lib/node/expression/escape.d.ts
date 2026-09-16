import { TwingBaseNodeAttributes, TwingBaseNode } from "../../node";
import { TwingBaseExpressionNode } from "../expression";
export interface TwingEscapeNodeAttributes extends TwingBaseNodeAttributes {
    strategy: string;
}
export interface TwingEscapeNode extends TwingBaseExpressionNode<"escape", TwingEscapeNodeAttributes, {
    body: TwingBaseNode;
}> {
}
export declare const createEscapeNode: (body: TwingBaseNode, strategy: string) => TwingEscapeNode;
