import { TwingCallableWrapper, TwingCallable, TwingCallableArgument, TwingCallableWrapperOptions, TwingSynchronousCallableWrapper, TwingSynchronousCallable } from "./callable-wrapper";
export interface TwingTest extends TwingCallableWrapper {
}
export interface TwingSynchronousTest extends TwingSynchronousCallableWrapper {
}
/**
 * Creates a template test.
 *
 * @param {string} name Name of the test
 * @param {TwingCallable<boolean>} callable A callable implementing the test. If null, you need to overwrite the "node_class" option to customize compilation.
 * @param {TwingCallableArgument[]} acceptedArguments
 * @param {TwingCallableWrapperOptions} options Options
 */
export declare const createTest: <Callable extends TwingCallable<any, boolean>>(name: string, callable: Callable, acceptedArguments: TwingCallableArgument[], options?: TwingCallableWrapperOptions) => TwingTest;
/**
 * Creates a synchronous template test.
 *
 * @param name Name of the test
 * @param callable A callable implementing the test. If null, you need to overwrite the "node_class" option to customize compilation.
 * @param acceptedArguments
 * @param options Options
 */
export declare const createSynchronousTest: <Callable extends TwingSynchronousCallable<any, boolean>>(name: string, callable: Callable, acceptedArguments: TwingCallableArgument[], options?: TwingCallableWrapperOptions) => TwingSynchronousTest;
