import { TwingTagHandler } from "./tag-handler";
import { TwingNodeVisitor } from "./node-visitor";
import { TwingFilter, TwingSynchronousFilter } from "./filter";
import { TwingFunction, TwingSynchronousFunction } from "./function";
import { TwingSynchronousTest, TwingTest } from "./test";
import { TwingOperator } from "./operator";
export interface TwingExtension {
    /**
     * Returns a list of filters to add to the existing list.
     *
     * @return Array<TwingFilter>
     */
    readonly filters: Array<TwingFilter>;
    /**
     * Returns a list of functions to add to the existing list.
     *
     * @return Array<TwingFunction>
     */
    readonly functions: Array<TwingFunction>;
    /**
     * Returns the node visitor instances to add to the existing list.
     *
     * @return Array<TwingNodeVisitor>
     */
    readonly nodeVisitors: Array<TwingNodeVisitor>;
    /**
     * Returns a list of operators to add to the existing list.
     *
     * @return TwingOperator[]
     */
    readonly operators: Array<TwingOperator>;
    /**
     * Returns the token parser instances to add to the existing list.
     *
     * @return Array<TwingTagHandler>
     */
    readonly tagHandlers: Array<TwingTagHandler>;
    /**
     * Returns a list of tests to add to the existing list.
     *
     * @returns Array<TwingTest>
     */
    readonly tests: Array<TwingTest>;
}
export interface TwingSynchronousExtension {
    /**
     * Returns a list of filters to add to the existing list.
     *
     * @return Array<TwingSynchronousFilter>
     */
    readonly filters: Array<TwingSynchronousFilter>;
    /**
     * Returns a list of functions to add to the existing list.
     *
     * @return Array<TwingSynchronousFunction>
     */
    readonly functions: Array<TwingSynchronousFunction>;
    /**
     * Returns the node visitor instances to add to the existing list.
     *
     * @return Array<TwingNodeVisitor>
     */
    readonly nodeVisitors: Array<TwingNodeVisitor>;
    /**
     * Returns a list of operators to add to the existing list.
     *
     * @return TwingOperator[]
     */
    readonly operators: Array<TwingOperator>;
    /**
     * Returns the token parser instances to add to the existing list.
     *
     * @return Array<TwingTagHandler>
     */
    readonly tagHandlers: Array<TwingTagHandler>;
    /**
     * Returns a list of tests to add to the existing list.
     *
     * @returns Array<TwingTest>
     */
    readonly tests: Array<TwingSynchronousTest>;
}
