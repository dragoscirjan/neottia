import type { TwingBaseNode } from "./node";
import type { TwingExecutionContext } from "./execution-context";
import { TwingSynchronousExecutionContext } from "./execution-context";
export type TwingNodeExecutor<Node extends TwingBaseNode = TwingBaseNode> = (node: Node, executionContext: TwingExecutionContext) => Promise<any>;
export type TwingSynchronousNodeExecutor<Node extends TwingBaseNode = TwingBaseNode> = (node: Node, executionContext: TwingSynchronousExecutionContext) => any;
/**
 * Execute the passed node against the passed execution context.
 *
 * @param node The node to execute
 * @param executionContext The context the node is executed against
 */
export declare const executeNode: TwingNodeExecutor;
export declare const executeNodeSynchronously: TwingSynchronousNodeExecutor;
