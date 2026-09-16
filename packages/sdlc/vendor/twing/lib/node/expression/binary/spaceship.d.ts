import type { TwingBaseBinaryNode } from "../binary";
export interface TwingSpaceshipNode extends TwingBaseBinaryNode<"spaceship"> {
}
export declare const createSpaceshipNode: (operands: [import("../../expression").TwingBaseExpressionNode, import("../../expression").TwingBaseExpressionNode], line: number, column: number) => TwingSpaceshipNode;
