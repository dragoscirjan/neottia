import type { TwingNodeExecutor, TwingSynchronousNodeExecutor } from "../../node-executor";
import type { TwingBlockFunctionNode } from "../../node/expression/block-function";
export declare const executeBlockFunction: TwingNodeExecutor<TwingBlockFunctionNode>;
export declare const executeSynchronousBlockFunction: TwingSynchronousNodeExecutor<TwingBlockFunctionNode>;
