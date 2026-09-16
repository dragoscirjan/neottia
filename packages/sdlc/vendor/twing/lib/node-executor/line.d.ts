import type { TwingNodeExecutor, TwingSynchronousNodeExecutor } from "../node-executor";
import type { TwingLineNode } from "../node/line";
export declare const executeLineNode: TwingNodeExecutor<TwingLineNode>;
export declare const executeLineNodeSynchronously: TwingSynchronousNodeExecutor<TwingLineNode>;
