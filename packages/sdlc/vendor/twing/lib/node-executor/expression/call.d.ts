import type { TwingNodeExecutor, TwingSynchronousNodeExecutor } from "../../node-executor";
import type { TwingBaseCallNode } from "../../node/expression/call";
export declare const executeCallNode: TwingNodeExecutor<TwingBaseCallNode<any>>;
export declare const executeCallNodeSynchronously: TwingSynchronousNodeExecutor<TwingBaseCallNode<any>>;
