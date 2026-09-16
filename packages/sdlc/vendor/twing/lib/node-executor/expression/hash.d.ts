import type { TwingNodeExecutor, TwingSynchronousNodeExecutor } from "../../node-executor";
import type { TwingHashNode } from "../../node/expression/hash";
export declare const executeHashNode: TwingNodeExecutor<TwingHashNode>;
export declare const executeHashNodeSynchronously: TwingSynchronousNodeExecutor<TwingHashNode>;
