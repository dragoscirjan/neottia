import { TwingTagHandler } from "./tag-handler";
import { TwingNodeVisitor } from "./node-visitor";
import { TwingOperator } from "./operator";
import type { TwingExtension, TwingSynchronousExtension } from "./extension";
export interface TwingExtensionSet<Extension extends TwingExtension | TwingSynchronousExtension> {
    readonly binaryOperators: Array<TwingOperator>;
    readonly filters: Map<string, Extension["filters"][number]>;
    readonly functions: Map<string, Extension["functions"][number]>;
    readonly nodeVisitors: Array<TwingNodeVisitor>;
    readonly tagHandlers: Array<TwingTagHandler>;
    readonly tests: Map<string, Extension["tests"][number]>;
    readonly unaryOperators: Array<TwingOperator>;
    addExtension(extension: Extension): void;
    addFilter(filter: Extension["filters"][number]): void;
    addFunction(twingFunction: Extension["functions"][number]): void;
    addNodeVisitor(visitor: TwingNodeVisitor): void;
    addOperator(operator: TwingOperator): void;
    addTagHandler(tagHandler: TwingTagHandler): void;
    addTest(test: Extension["tests"][number]): void;
}
export declare const createExtensionSet: <Extension extends TwingExtension | TwingSynchronousExtension>() => TwingExtensionSet<Extension>;
