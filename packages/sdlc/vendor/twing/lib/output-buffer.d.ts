interface Writable {
    write(chunk: string): void;
}
export interface TwingOutputBuffer {
    readonly outputStream: Writable & {
        pipe(writable: Writable): void;
    };
    echo(string: any): string | void;
    /**
     * Clean (erase) the output buffer
     *
     * In human terms: empties the top-most buffer
     *
     * ┌─────────┐    ┌─────────┐
     * │   oof   │    │         │
     * ├─────────┤    ├─────────┤
     * │   bar   │ => │   bar   │
     * ├─────────┤    ├─────────┤
     * │   foo   │    │   foo   │ => true
     * └─────────┘    └─────────┘
     *
     */
    clean(): boolean;
    /**
     * Clean the output buffer, and delete active output buffer
     *
     * In human terms: removes the top-most buffer
     *
     * ```text
     * ┌─────────┐
     * │   oof   │
     * ├─────────┤    ┌─────────┐
     * │   bar   │ -> │   bar   │
     * ├─────────┤    ├─────────┤
     * │   foo   │    │   foo   │ => true
     * └─────────┘    └─────────┘
     * ```
     *
     * @returns {boolean}
     */
    endAndClean(): boolean;
    /**
     * Flush (send) the output buffer, and delete current output buffer
     *
     * In human terms: appends the top-most buffer to the second-top-most buffer and removes the top-most buffer
     *
     * ```text
     * ┌─────────┐
     * │   oof   │
     * ├─────────┤    ┌─────────┐
     * │   bar   │ -> │  baroof │
     * ├─────────┤    ├─────────┤
     * │   foo   │    │   foo   │ => true
     * └─────────┘    └─────────┘
     * ```
     *
     * @returns {boolean}
     */
    endAndFlush(): boolean;
    /**
     * Flush (send) contents of the output buffer. The last buffer content is sent to next buffer
     *
     * In human terms: appends the top-most buffer to the second-top-most buffer and empties the top-most buffer
     *
     * ```text
     * ┌─────────┐    ┌─────────┐
     * │   oof   │    │         │
     * ├─────────┤    ├─────────┤
     * │   bar   │ => │  baroof │
     * ├─────────┤    ├─────────┤
     * │   foo   │    │   foo   │ => true
     * └─────────┘    └─────────┘
     * ```
     */
    flush(): boolean;
    /**
     * Get active buffer contents and delete active output buffer
     *
     * In human terms: removes the top-most buffer and returns its content
     *
     * ```text
     * ┌─────────┐
     * │   oof   │
     * ├─────────┤    ┌─────────┐
     * │   bar   │ -> │   bar   │
     * ├─────────┤    ├─────────┤
     * │   foo   │    │   foo   │ => "oof"
     * └─────────┘    └─────────┘
     * ```
     *
     * @returns {string}
     */
    getAndClean(): string;
    /**
     * Get active buffer contents, flush (send) the output buffer, and delete active output buffer
     *
     * In human terms: appends the top-most buffer to the second-top-most buffer, removes the top-most buffer and returns its content
     *
     * ```text
     * ┌─────────┐
     * │   oof   │
     * ├─────────┤    ┌─────────┐
     * │   bar   │ -> │  baroof │
     * ├─────────┤    ├─────────┤
     * │   foo   │    │   foo   │ => oof
     * └─────────┘    └─────────┘
     * ```
     *
     * @returns {string}
     */
    getAndFlush(): string;
    /**
     * Gets the contents of the output buffer without clearing it.
     *
     * In human terms: returns the content of the top-most buffer
     *
     * ```text
     * ┌─────────┐
     * │   oof   │
     * ├─────────┤
     * │   bar   │
     * ├─────────┤
     * │   foo   │ => "oof"
     * └─────────┘
     * ```
     *
     * @returns {string}
     */
    getContents(): string;
    /**
     * Return the nesting level of the output buffering mechanism
     *
     * @returns {number}
     */
    getLevel(): number;
    /**
     * Turn on Output Buffering (specifying an optional output handler).
     *
     * @returns {boolean}
     */
    start(): boolean;
}
export declare const createOutputBuffer: () => TwingOutputBuffer;
export {};
