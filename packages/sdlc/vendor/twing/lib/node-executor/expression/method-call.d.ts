import type { TwingNodeExecutor, TwingSynchronousNodeExecutor } from "../../node-executor";
import type { TwingMethodCallNode } from "../../node/expression/method-call";
export declare const executeMethodCall: TwingNodeExecutor<TwingMethodCallNode>;
export declare const executeMethodCallSynchronously: TwingSynchronousNodeExecutor<TwingMethodCallNode>;
