import type { TwingTest } from "../test";
import { TwingSynchronousTest } from "../test";
/**
 * Gets a test by name.
 *
 * @param {string} name The test name
 * @returns {TwingTest} A MyTest instance or null if the test does not exist
 */
export declare const getTest: <Test extends TwingTest | TwingSynchronousTest>(tests: Map<string, Test>, name: string) => Test | null;
