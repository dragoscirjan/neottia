import type { TwingNodeExecutor, TwingSynchronousNodeExecutor } from "../../node-executor";
import type { TwingParentFunctionNode } from "../../node/expression/parent-function";
export declare const executeParentFunction: TwingNodeExecutor<TwingParentFunctionNode>;
export declare const executeParentFunctionSynchronously: TwingSynchronousNodeExecutor<TwingParentFunctionNode>;
