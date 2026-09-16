import { TwingBaseIncludeNode } from "../node/include";
import { TwingExecutionContext, TwingSynchronousExecutionContext } from "../execution-context";
import { TwingSynchronousTemplate, TwingTemplate } from "../template";
export declare const executeBaseIncludeNode: (node: TwingBaseIncludeNode<any>, executionContext: TwingExecutionContext, getTemplate: (executionContext: TwingExecutionContext) => Promise<TwingTemplate | null | Array<TwingTemplate | null>>) => Promise<void>;
export declare const executeBaseIncludeNodeSynchronously: (node: TwingBaseIncludeNode<any>, executionContext: TwingSynchronousExecutionContext, getTemplate: (executionContext: TwingSynchronousExecutionContext) => TwingSynchronousTemplate | null | Array<TwingSynchronousTemplate | null>) => void;
