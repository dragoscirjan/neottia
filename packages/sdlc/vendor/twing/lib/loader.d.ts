import type { TwingSource } from "./source";
export interface TwingLoader {
    /**
     * Returns the source for a given template logical name.
     *
     * @param {string} name The template logical name
     * @param {TwingSource} from The source that initiated the template loading
     *
     * @returns {Promise<TwingSource | string>}
     */
    getSource: (name: string, from: string | null) => Promise<TwingSource | null>;
    /**
     * Resolve a template FQN from its name and the name of the template that initiated the loading.
     *
     * @param {string} name The name of the template to load
     * @param {TwingSource} from The source that initiated the template loading
     *
     * @returns {Promise<string | null>} The cache key
     */
    resolve: (name: string, from: string | null) => Promise<string | null>;
    /**
     * Returns true if the template is still fresh.
     *
     * @param {string} name The template name
     * @param {number} time Timestamp of the last modification time of the cached template
     * @param {TwingSource} from The source that initiated the template loading
     *
     * @returns {Promise<boolean | null>} true if the template is fresh, false otherwise; null if it does not exist
     *
     * @throws TwingErrorLoader When name is not found
     */
    isFresh: (name: string, time: number, from: string | null) => Promise<boolean | null>;
    /**
     * Check if we have the source code of a template, given its name.
     *
     * @param {string} name The name of the template to check if we can load
     * @param {TwingSource} from The source that initiated the template loading
     *
     * @returns {Promise<boolean>} If the template source code is handled by this loader or not
     */
    exists: (name: string, from: string | null) => Promise<boolean>;
}
export interface TwingSynchronousLoader {
    /**
     * Returns the source for a given template logical name.
     *
     * @param {string} name The template logical name
     * @param {TwingSource} from The source that initiated the template loading
     */
    getSource: (name: string, from: string | null) => TwingSource | null;
    /**
     * Resolve a template FQN from its name and the name of the template that initiated the loading.
     *
     * @param {string} name The name of the template to load
     * @param {TwingSource} from The source that initiated the template loading
     *
     * @returns The cache key
     */
    resolve: (name: string, from: string | null) => string | null;
    /**
     * Returns true if the template is still fresh.
     *
     * @param {string} name The template name
     * @param {number} time Timestamp of the last modification time of the cached template
     * @param {TwingSource} from The source that initiated the template loading
     *
     * @returns true if the template is fresh, false otherwise; null if it does not exist
     *
     * @throws TwingErrorLoader When name is not found
     */
    isFresh: (name: string, time: number, from: string | null) => boolean | null;
    /**
     * Check if we have the source code of a template, given its name.
     *
     * @param {string} name The name of the template to check if we can load
     * @param {TwingSource} from The source that initiated the template loading
     *
     * @returns If the template source code is handled by this loader or not
     */
    exists: (name: string, from: string | null) => boolean;
}
