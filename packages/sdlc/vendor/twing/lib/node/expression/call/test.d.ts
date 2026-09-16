import { TwingBaseCallNode } from "../call";
import type { TwingBaseNode } from "../../../node";
import type { TwingArrayNode } from "../array";
export interface TwingTestNode extends TwingBaseCallNode<"test"> {
}
export declare const createTestNode: (operand: TwingBaseNode, testName: string, testArguments: TwingArrayNode, line: number, column: number) => TwingTestNode;
