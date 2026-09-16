import { TwingBaseExpressionNode } from "../node/expression";
import { TwingTagHandler } from "../tag-handler";
import { TwingParser } from "../parser";
import { TwingTokenStream } from "../token-stream";
export declare const createIncludeTagHandler: () => TwingTagHandler;
export declare const parseArguments: (parser: TwingParser, stream: TwingTokenStream, line: number, column: number) => {
    variables: TwingBaseExpressionNode;
    only: boolean;
    ignoreMissing: boolean;
};
